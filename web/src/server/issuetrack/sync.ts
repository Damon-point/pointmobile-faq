/**
 * Redmine → sb.rm_* 수집. 전수 백필 + 증분 폴링. Redmine 에는 아무것도 쓰지 않는다.
 *
 * - 백필: 목록 API 로 이슈 골격을 전부 넣고(빠름), 이슈별 상세를 받아 journals 를 채운다.
 *   상세는 이슈당 1콜이라 1,600여 건이면 4~5분 — 서버리스 한 번의 실행 시간을 넘으므로 **시간 예산 안에서만**
 *   받고 멈춘다. detail_fetched 표시가 DB 에 남아 다음 실행(5분 뒤 cron)이 이어서 받는다.
 * - 폴링: updated_on >= (본 것 중 가장 최신 − OVERLAP) 로 목록을 받아 updated_on 이 달라진 이슈만 상세를 다시
 *   받는다. 한 번에 POLL_DETAIL_CAP 건까지 — 남은 것은 stale 표시로 다음에 받는다.
 * - 이슈 상세를 다시 받을 때는 그 이슈의 journal 을 지우고 다시 넣는다(코멘트 수정 · 삭제가 있어 교체가 정확).
 *
 * 동시에 두 번 돌지 않게 하는 잠금은 부르는 쪽(tick · 수동 수집)이 locks.ts 로 잡는다.
 */
import { sql, type Tx } from "../db";
import { RedmineClient, RedmineError, PROJECT, parseDt, parseStateDt, type Json } from "./client";
import { excludeList, loadSbSettings } from "./settings";

const POLL_OVERLAP_MS = Number(process.env.TW_REDMINE_POLL_OVERLAP_MIN || 15) * 60_000;
const POLL_DETAIL_CAP = Number(process.env.TW_REDMINE_POLL_DETAIL_CAP || 80);

export const K_LAST_SEEN = "last_seen_updated_on";
export const K_BACKFILL = "backfill_state"; // none | running | done
export const K_LAST_POLL = "last_poll_at";
export const K_LAST_ERROR = "last_error";
export const SYNC_LOCK = "redmine_sb";

// ── 상태 ────────────────────────────────────────────────────────────────────

export async function getState(key: string): Promise<string | null> {
  const [r] = await sql<{ value: string | null }[]>`SELECT value FROM sb.rm_sync_state WHERE key = ${key}`;
  return r?.value ?? null;
}

export async function setState(key: string, value: string | null): Promise<void> {
  await sql`
    INSERT INTO sb.rm_sync_state (key, value, updated_at) VALUES (${key}, ${value}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

/** 이슈 데이터의 '판번호' — (이슈 수, 이벤트 수, 최대 journal id). 화면이 바뀐 때만 다시 그리려고 쓴다. */
export async function dataVersion(): Promise<[number, number, number]> {
  try {
    const [r] = await sql<{ ni: number; nj: number; mj: number }[]>`
      SELECT (SELECT count(*) FROM sb.rm_issues)::int8 AS ni,
             (SELECT count(*) FROM sb.rm_journals)::int8 AS nj,
             (SELECT COALESCE(max(id), 0) FROM sb.rm_journals)::int8 AS mj`;
    return [r.ni, r.nj, r.mj];
  } catch {
    return [-1, -1, -1];
  }
}

export async function status() {
  const [r] = await sql<{ issues: number; pending: number; journals: number }[]>`
    SELECT (SELECT count(*) FROM sb.rm_issues)::int8 AS issues,
           (SELECT count(*) FROM sb.rm_issues WHERE NOT detail_fetched AND NOT excluded)::int8 AS pending,
           (SELECT count(*) FROM sb.rm_journals)::int8 AS journals`;
  const st = Object.fromEntries(
    (await sql<{ key: string; value: string | null }[]>`
      SELECT key, value FROM sb.rm_sync_state WHERE key IN (${K_BACKFILL}, ${K_LAST_SEEN}, ${K_LAST_POLL}, ${K_LAST_ERROR})`).map(
      (x) => [x.key, x.value],
    ),
  );
  return {
    issues: r.issues,
    detail_pending: r.pending,
    journals: r.journals,
    backfill: st[K_BACKFILL] ?? "none",
    last_seen: st[K_LAST_SEEN] ?? null,
    last_poll: st[K_LAST_POLL] ?? null,
    last_error: st[K_LAST_ERROR] ?? null,
  };
}

// ── 규칙 ────────────────────────────────────────────────────────────────────

/** 제목이 [Test] 로 시작하면 기능 검증용 — 통계에서만 뺀다. */
export function isTestSubject(subject: string | null): boolean {
  return (subject || "").trimStart().toLowerCase().startsWith("[test]");
}

export function exclusionFor(subject: string | null, keywords: string[]): string | null {
  const s = (subject || "").toLowerCase();
  for (const kw of keywords) if (s.includes(kw)) return `제외 키워드: ${kw}`;
  return null;
}

// ── 반영 ────────────────────────────────────────────────────────────────────

const name = (o: unknown): string | null =>
  o && typeof o === "object" && "name" in o ? ((o as Json).name ?? null) : null;
const rid = (o: unknown): number | null =>
  o && typeof o === "object" && (o as Json).id != null ? Number((o as Json).id) : null;

type Ctx = { keywords: string[]; cf: Map<number, string> };

/** 목록 · 상세 공통 필드 → 이슈 행 값. description · custom_fields 는 값이 올 때만(null 이면 기존 값 유지). */
function summaryValues(src: Json, ctx: Ctx) {
  const subject = String(src.subject || "").slice(0, 500);
  const cf: Json[] | undefined = src.custom_fields;
  if (cf && cf.length) for (const f of cf) if (f.id != null && f.name) if (!ctx.cf.has(Number(f.id))) ctx.cf.set(Number(f.id), String(f.name));
  const reason = exclusionFor(subject, ctx.keywords);
  return {
    id: Number(src.id),
    project_id: rid(src.project),
    project_name: name(src.project),
    tracker: name(src.tracker),
    status: name(src.status),
    status_id: rid(src.status),
    priority: name(src.priority),
    priority_id: rid(src.priority),
    category: name(src.category),
    author_id: rid(src.author),
    author_name: name(src.author),
    assigned_to_id: rid(src.assigned_to),
    assigned_to_name: name(src.assigned_to),
    subject,
    description: src.description ?? null,
    done_ratio: src.done_ratio ?? null,
    start_date: src.start_date ?? null,
    due_date: src.due_date ?? null,
    created_on: parseDt(src.created_on),
    updated_on: parseDt(src.updated_on),
    closed_on: parseDt(src.closed_on),
    custom_fields_json: cf && cf.length ? JSON.stringify(cf) : null,
    excluded: reason !== null,
    excluded_reason: reason,
    is_test: isTestSubject(subject),
    synced_at: new Date(),
  };
}

const COLS = [
  "id", "project_id", "project_name", "tracker", "status", "status_id", "priority", "priority_id", "category",
  "author_id", "author_name", "assigned_to_id", "assigned_to_name", "subject", "description", "done_ratio",
  "start_date", "due_date", "created_on", "updated_on", "closed_on", "custom_fields_json", "excluded",
  "excluded_reason", "is_test", "synced_at",
] as const;

/** 목록 한 페이지를 반영. 상세를 다시 받아야 하는 이슈 수를 돌려준다. */
async function upsertSummaries(db: Tx | typeof sql, srcs: Json[], ctx: Ctx): Promise<number> {
  if (!srcs.length) return 0;
  const rows = srcs.map((s) => summaryValues(s, ctx));
  const res = await db<{ stale: boolean }[]>`
    INSERT INTO sb.rm_issues ${db(rows, ...COLS)}
    ON CONFLICT (id) DO UPDATE SET
      project_id = EXCLUDED.project_id, project_name = EXCLUDED.project_name, tracker = EXCLUDED.tracker,
      status = EXCLUDED.status, status_id = EXCLUDED.status_id, priority = EXCLUDED.priority,
      priority_id = EXCLUDED.priority_id, category = EXCLUDED.category, author_id = EXCLUDED.author_id,
      author_name = EXCLUDED.author_name, assigned_to_id = EXCLUDED.assigned_to_id,
      assigned_to_name = EXCLUDED.assigned_to_name, subject = EXCLUDED.subject,
      description = COALESCE(EXCLUDED.description, sb.rm_issues.description),
      done_ratio = EXCLUDED.done_ratio, start_date = EXCLUDED.start_date, due_date = EXCLUDED.due_date,
      created_on = EXCLUDED.created_on, updated_on = EXCLUDED.updated_on, closed_on = EXCLUDED.closed_on,
      custom_fields_json = COALESCE(EXCLUDED.custom_fields_json, sb.rm_issues.custom_fields_json),
      excluded = EXCLUDED.excluded, excluded_reason = EXCLUDED.excluded_reason, is_test = EXCLUDED.is_test,
      synced_at = EXCLUDED.synced_at
    RETURNING ((xmax = 0) OR NOT detail_fetched
               OR detail_synced_updated_on IS DISTINCT FROM updated_on) AS stale`;
  return res.filter((r) => r.stale).length;
}

/** 이슈 상세를 받아 journals · attachments 까지 교체. 저장한 journal 수. */
async function fetchDetail(client: RedmineClient, issueId: number, ctx: Ctx): Promise<number> {
  const src = await client.issueDetail(issueId);
  if (!src || !src.id) return 0;
  const journals: Json[] = src.journals || [];
  const atts: Json[] = src.attachments || [];
  await sql.begin(async (tx) => {
    await upsertSummaries(tx, [src], ctx);
    await tx`DELETE FROM sb.rm_journals WHERE issue_id = ${issueId}`;
    await tx`DELETE FROM sb.rm_attachments WHERE issue_id = ${issueId}`;
    if (journals.length) {
      const jr = journals.map((j) => ({
        id: Number(j.id),
        issue_id: issueId,
        user_id: rid(j.user),
        user_name: name(j.user),
        created_on: parseDt(j.created_on),
        notes: j.notes || null,
        private_notes: Boolean(j.private_notes),
      }));
      await tx`INSERT INTO sb.rm_journals ${tx(jr, "id", "issue_id", "user_id", "user_name", "created_on", "notes", "private_notes")}`;
      type Dr = { journal_id: number; seq: number; property: string | null; name: string | null; old_value: string | null; new_value: string | null };
      const dr: Dr[] = journals.flatMap((j) =>
        ((j.details || []) as Json[]).map((d, seq): Dr => ({
          journal_id: Number(j.id),
          seq,
          property: d.property ?? null,
          name: d.name ?? null,
          old_value: d.old_value ?? null,
          new_value: d.new_value ?? null,
        })),
      );
      for (let i = 0; i < dr.length; i += 500) {
        const chunk = dr.slice(i, i + 500);
        await tx`INSERT INTO sb.rm_journal_details ${tx(chunk, "journal_id", "seq", "property", "name", "old_value", "new_value")}`;
      }
    }
    if (atts.length) {
      const ar = atts.map((a) => ({
        id: Number(a.id),
        issue_id: issueId,
        filename: String(a.filename || "").slice(0, 300),
        filesize: a.filesize ?? null,
        content_type: String(a.content_type || "").slice(0, 120) || null,
        author_name: name(a.author),
        created_on: parseDt(a.created_on),
      }));
      await tx`INSERT INTO sb.rm_attachments ${tx(ar, "id", "issue_id", "filename", "filesize", "content_type", "author_name", "created_on")}
               ON CONFLICT (id) DO NOTHING`;
    }
    await tx`UPDATE sb.rm_issues SET detail_fetched = true, detail_synced_updated_on = updated_on WHERE id = ${issueId}`;
  });
  return journals.length;
}

/** id→이름 매핑 갱신(상태 · 우선순위 · 트래커 · 사용자). */
async function syncLookups(client: RedmineClient): Promise<void> {
  const pairs: { kind: string; ref_id: number; name: string }[] = [];
  for (const [kind, rows] of Object.entries(await client.enumerations()))
    for (const r of rows) if (r.id != null && r.name) pairs.push({ kind, ref_id: Number(r.id), name: String(r.name) });
  for (const m of await client.memberships()) {
    const u = m.user || {};
    if (u.id && u.name) pairs.push({ kind: "user", ref_id: Number(u.id), name: String(u.name) });
  }
  if (!pairs.length) return;
  const uniq = [...new Map(pairs.map((p) => [`${p.kind}:${p.ref_id}`, p])).values()];
  await sql`
    INSERT INTO sb.rm_lookups ${sql(uniq, "kind", "ref_id", "name")}
    ON CONFLICT (kind, ref_id) DO UPDATE SET name = EXCLUDED.name`;
}

/** 수집 중에 주워담은 커스텀 필드 이름을 Lookup 에(이미 있는 것은 그대로). */
async function flushCfLookups(ctx: Ctx): Promise<void> {
  if (!ctx.cf.size) return;
  const rows = [...ctx.cf].map(([ref_id, name]) => ({ kind: "cf", ref_id, name }));
  await sql`INSERT INTO sb.rm_lookups ${sql(rows, "kind", "ref_id", "name")} ON CONFLICT (kind, ref_id) DO NOTHING`;
}

async function newCtx(): Promise<Ctx> {
  return { keywords: excludeList(await loadSbSettings()), cf: new Map() };
}

const staleWhere = () => sql`NOT excluded AND (NOT detail_fetched OR detail_synced_updated_on IS DISTINCT FROM updated_on)`;

export type PollResult = {
  error?: string;
  listed?: number; // 백필일 때만
  partial?: boolean; // 백필이 시간 예산에 걸려 다음으로 이어짐
  scanned?: number;
  changed?: number;
  detail_done?: number;
  detail_failed?: number;
  journals?: number;
  deferred?: number;
};

/**
 * 전수 수집. 이미 받은 이슈는 건너뛰므로 여러 번 불러도 안전(이어받기).
 * deadline(ms 시각)을 넘기면 상세 받기를 멈추고 partial 로 돌려준다 — 상태는 running 으로 남는다.
 */
export async function backfill(deadline: number, project = PROJECT): Promise<PollResult> {
  try {
    const client = await RedmineClient.create();
    await setState(K_BACKFILL, "running");
    await setState(K_LAST_ERROR, null);
    await syncLookups(client);
    const ctx = await newCtx();

    // 1단계 — 목록으로 골격 채우기(이어받기 때도 다시 훑는다: 100건씩 16번 남짓이라 짧다)
    let listed = 0;
    let newest: Date | null = null;
    for await (const page of client.iterIssues({ project })) {
      await upsertSummaries(sql, page, ctx);
      for (const s of page) {
        const u = parseDt(s.updated_on);
        if (u && (!newest || u > newest)) newest = u;
      }
      listed += page.length;
    }

    // 2단계 — 상세(journals). 제외 대상은 건너뛴다. 시간 예산 안에서만.
    const todo = (await sql<{ id: number }[]>`SELECT id FROM sb.rm_issues WHERE ${staleWhere()} ORDER BY id`).map((r) => r.id);
    let done = 0, journals = 0, failed = 0;
    for (const iid of todo) {
      if (Date.now() > deadline) break;
      try {
        journals += await fetchDetail(client, iid, ctx);
      } catch (e) {
        if (!(e instanceof RedmineError)) throw e;
        failed++;
        console.warn(`이슈 #${iid} 상세 수집 실패: ${e.message}`);
      }
      done++;
    }
    await flushCfLookups(ctx);
    const partial = done < todo.length;
    if (!partial) {
      if (newest) await setState(K_LAST_SEEN, newest.toISOString());
      await setState(K_BACKFILL, "done");
    }
    await setState(K_LAST_POLL, new Date().toISOString());
    return { listed, detail_done: done, detail_failed: failed, journals, ...(partial ? { partial: true, deferred: todo.length - done } : {}) };
  } catch (e) {
    if (!(e instanceof RedmineError)) throw e;
    await setState(K_BACKFILL, "none");
    await setState(K_LAST_ERROR, e.message);
    return { error: e.message };
  }
}

/** 증분 수집. 백필이 끝나지 않았으면 백필로 넘긴다. */
export async function poll(deadline: number, project = PROJECT): Promise<PollResult> {
  if ((await getState(K_BACKFILL)) !== "done") return backfill(deadline, project);
  try {
    const client = await RedmineClient.create();
    const ctx = await newCtx();
    const lastSeen = parseStateDt(await getState(K_LAST_SEEN));
    const since = lastSeen ? new Date(lastSeen.getTime() - POLL_OVERLAP_MS) : null;

    let changed = 0, seen = 0;
    let newest = lastSeen;
    for await (const page of client.iterIssues({ project, updatedSince: since })) {
      changed += await upsertSummaries(sql, page, ctx);
      seen += page.length;
      for (const s of page) {
        const u = parseDt(s.updated_on);
        if (u && (!newest || u > newest)) newest = u;
      }
    }

    // 상세 대상은 방금 훑은 목록이 아니라 **DB 의 stale 표시**에서 뽑는다 — 상한에 걸려 밀린 이슈가
    // 다음 폴링의 시간창을 벗어나 영영 누락되는 걸 막는다.
    const [{ n: totalStale }] = await sql<{ n: number }[]>`SELECT count(*)::int8 AS n FROM sb.rm_issues WHERE ${staleWhere()}`;
    const todo = (
      await sql<{ id: number }[]>`
        SELECT id FROM sb.rm_issues WHERE ${staleWhere()} ORDER BY updated_on DESC NULLS LAST LIMIT ${POLL_DETAIL_CAP}`
    ).map((r) => r.id);

    let done = 0, journals = 0, failed = 0;
    for (const iid of todo) {
      if (Date.now() > deadline) break;
      try {
        journals += await fetchDetail(client, iid, ctx);
      } catch (e) {
        if (!(e instanceof RedmineError)) throw e;
        failed++;
        console.warn(`이슈 #${iid} 상세 수집 실패: ${e.message}`);
      }
      done++;
    }
    const deferred = Math.max(0, totalStale - done);

    await flushCfLookups(ctx);
    if (newest) await setState(K_LAST_SEEN, newest.toISOString());
    await setState(K_LAST_POLL, new Date().toISOString());
    await setState(K_LAST_ERROR, null);
    const result: PollResult = { scanned: seen, changed, detail_done: done, detail_failed: failed, journals };
    if (deferred) result.deferred = deferred;
    return result;
  } catch (e) {
    if (!(e instanceof RedmineError)) throw e;
    await setState(K_LAST_ERROR, e.message);
    return { error: e.message };
  }
}
