/**
 * /api/issues/* 공용 — 응답 모양을 예전 FastAPI(api/routers/issues.py)와 똑같이 맞춘다.
 *   · SB 문서는 **내 담당 건만** 보이고 고칠 수 있다(관리자는 전체).
 *   · 시각은 KST ISO(+09:00) 로 내보낸다.
 */
import { sql } from "../db";
import { bad } from "../http";
import { isAdmin, type SessionUser } from "../session";
import { kstIso } from "../time";
import { issueUrlMaker } from "./client";
import * as SB from "./sb";
import { getState, setState } from "./sync";

export const ISSUE_PAGE = 50;
export const SB_PAGE = 30;

/** SB 상태 → 한글 이름. 화면 색은 web 쪽에서 정한다. */
export const SB_STATES: Record<string, string> = {
  backlog: "소급 대기",
  not_needed: "소급 불필요",
  not_target: "SB 대상 아님",
  queued: "생성 대기",
  draft: "초안",
  notified: "검토 요청됨",
  approved: "확정",
  discarded: "폐기",
  error: "생성 실패",
};
/** 기본으로 보여 줄 상태 — 사람이 할 일이 남은 것들. */
export const SB_ACTIVE = ["queued", "draft", "notified", "error"];
/** 칩으로 만들지 않는 상태(감시 시작 때 한 번 정리하고 끝난 소급분). */
export const SB_HIDDEN = ["backlog", "not_needed", "not_target"];

export const ACTION_WHAT: Record<string, string> = {
  resolve: "상태를 Resolved · Closed · Rejected 로 바꿨다 (첫 손길이 곧 종결)",
  analyze: "상태를 InProgress 로 바꿨다 (분석 착수)",
  status: "그 밖의 상태 변경 (ReOpen 등)",
  comment: "코멘트를 남겼다",
  assign: "담당자만 지정했다",
  attach: "첨부만 올렸다",
  field: "진행률·기한·우선순위·연관 이슈 등 필드만 고쳤다",
  empty: "코멘트도 변경 내역도 없는 이벤트",
};

type DocJoin = SB.SbDocRow & { subject: string | null; issue_status: string | null };

export function docDict(d: DocJoin, url: (id: number) => string) {
  let partners: string[] = [];
  try {
    partners = JSON.parse(d.partners_json || "[]");
  } catch {
    partners = [];
  }
  return {
    id: d.id,
    issue_id: d.issue_id,
    revision: d.revision,
    state: d.state,
    state_label: SB_STATES[d.state] ?? d.state,
    origin: d.origin,
    superseded: Boolean(d.superseded),
    title: d.title || "",
    disclosure: d.disclosure,
    reason: d.disclosure_reason || "",
    applies_to: d.applies_to || "",
    description_html: d.description_html || "",
    partners,
    assignee: d.assignee_name || "",
    email: d.assignee_email || "",
    error: d.error || "",
    resolved_at: kstIso(d.source_resolved_at),
    generated_at: kstIso(d.generated_at),
    notified_at: kstIso(d.notified_at),
    decided_at: kstIso(d.decided_at),
    decided_by: d.decided_by || "",
    in_tok: d.input_tokens || 0,
    out_tok: d.output_tokens || 0,
    subject: d.subject || "",
    issue_status: d.issue_status || "",
    issue_url: url(d.issue_id),
    generating: SB.isGenerating(d),
    // 예전에는 생성 스레드의 결과를 메모리에 두었다. 지금은 실패가 문서 상태(error)로 남으므로 거기서 읽는다.
    gen_result: d.state === "error" ? { ok: false, error: d.error || "" } : null,
  };
}

export type DocDict = ReturnType<typeof docDict>;

/** 본인 담당(관리자는 전체) 문서만 다룬다. */
export async function loadDocFor(u: SessionUser, docId: number): Promise<DocDict> {
  const [row] = await sql<DocJoin[]>`
    SELECT d.*, i.subject, i.status AS issue_status
    FROM sb.rm_sb_docs d JOIN sb.rm_issues i ON i.id = d.issue_id WHERE d.id = ${docId}`;
  if (!row) bad("문서가 없습니다", 404);
  const d = docDict(row, await issueUrlMaker());
  if (!isAdmin(u) && d.assignee !== (u.username || "")) bad("본인 담당 문서만 다룰 수 있습니다", 403);
  return d;
}

export type DraftIn = { title: string; disclosure: string; applies_to: string; description_html: string; partners: string[] };

export function draftOf(b: Partial<DraftIn>): DraftIn {
  return {
    title: typeof b.title === "string" ? b.title : "",
    disclosure: typeof b.disclosure === "string" ? b.disclosure : "internal",
    applies_to: typeof b.applies_to === "string" ? b.applies_to : "",
    description_html: typeof b.description_html === "string" ? b.description_html : "",
    partners: Array.isArray(b.partners) ? b.partners.map(String) : [],
  };
}

export async function saveDraft(docId: number, b: DraftIn): Promise<void> {
  const res = await SB.updateDraft(docId, b);
  if (!res.ok) bad(res.error || "저장 실패", 409);
}

// ── 수동 수집 결과(예전에는 프로세스 메모리) ───────────────────────────────────

const K_MANUAL = "manual_sync_result";

export async function saveSyncResult(r: Record<string, unknown>): Promise<void> {
  await setState(K_MANUAL, JSON.stringify({ ...r, at: Date.now() / 1000 }));
}

export async function syncResult(): Promise<{ ok?: boolean; message?: string; at?: number }> {
  const raw = await getState(K_MANUAL);
  if (!raw) return {};
  let r: Record<string, unknown>;
  try {
    r = JSON.parse(raw);
  } catch {
    return {};
  }
  let msg: string, ok: boolean;
  if (r.error) [msg, ok] = [`동기화 실패: ${r.error}`, false];
  else if (r.skipped) [msg, ok] = [String(r.reason || "이미 동기화가 진행 중입니다"), true];
  else if (r.detail_done) [msg, ok] = [`이슈 ${r.detail_done}건 갱신 (이벤트 ${r.journals ?? 0}건)`, true];
  else [msg, ok] = ["새 이벤트가 없습니다", true];
  return { ok, message: msg, at: Number(r.at) || 0 };
}

/** sync 상태 값(UTC ISO 문자열) → KST ISO. 예전 앱이 남긴 값은 시간대 표시가 없다. */
export function isoKst(s: string | null | undefined): string {
  if (!s) return "";
  const d = new Date(/(Z|[+-]\d{2}:?\d{2})$/i.test(s) ? s : s + "Z");
  return Number.isNaN(d.getTime()) ? "" : kstIso(d);
}

export const r2 = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v * 100) / 100);
