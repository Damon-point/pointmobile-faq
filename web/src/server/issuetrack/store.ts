/**
 * 저장된 Redmine 이슈 · 이벤트를 읽는 곳. 표는 db/schema.sql 의 sb.rm_*.
 * 이벤트(journal)는 상세(detail)까지 한 번에 붙여 돌려준다 — 타임라인 · 소요시간 계산이 둘 다 필요하다.
 */
import { sql } from "../db";

export type IssueRow = {
  id: number;
  project_id: number | null;
  project_name: string | null;
  tracker: string | null;
  status: string | null;
  status_id: number | null;
  priority: string | null;
  priority_id: number | null;
  category: string | null;
  author_id: number | null;
  author_name: string | null;
  assigned_to_id: number | null;
  assigned_to_name: string | null;
  subject: string;
  description: string | null;
  done_ratio: number | null;
  start_date: string | null;
  due_date: string | null;
  created_on: Date | null;
  updated_on: Date | null;
  closed_on: Date | null;
  custom_fields_json: string | null;
  excluded: boolean;
  excluded_reason: string | null;
  is_test: boolean;
  detail_fetched: boolean;
  detail_synced_updated_on: Date | null;
  synced_at: Date | null;
};

export type DetailRow = {
  journal_id: number;
  seq: number;
  property: string | null;
  name: string | null;
  old_value: string | null;
  new_value: string | null;
};

export type JournalRow = {
  id: number;
  issue_id: number;
  user_id: number | null;
  user_name: string | null;
  created_on: Date | null;
  notes: string | null;
  private_notes: boolean;
  details: DetailRow[];
};

export type IssueWithJournals = IssueRow & { journals: JournalRow[] };

/** 이슈들의 이벤트를 상세까지 붙여 이슈 id 별로. ids 를 안 주면 전부. */
export async function journalsFor(ids: number[] | null): Promise<Map<number, JournalRow[]>> {
  const out = new Map<number, JournalRow[]>();
  if (ids && !ids.length) return out;
  const js = ids
    ? await sql<Omit<JournalRow, "details">[]>`
        SELECT id, issue_id, user_id, user_name, created_on, notes, private_notes
        FROM sb.rm_journals WHERE issue_id = ANY(${ids}::int[])`
    : await sql<Omit<JournalRow, "details">[]>`
        SELECT id, issue_id, user_id, user_name, created_on, notes, private_notes FROM sb.rm_journals`;
  const ds = ids
    ? await sql<DetailRow[]>`
        SELECT d.journal_id, d.seq, d.property, d.name, d.old_value, d.new_value
        FROM sb.rm_journal_details d JOIN sb.rm_journals j ON j.id = d.journal_id
        WHERE j.issue_id = ANY(${ids}::int[])`
    : await sql<DetailRow[]>`
        SELECT journal_id, seq, property, name, old_value, new_value FROM sb.rm_journal_details`;
  const byJ = new Map<number, DetailRow[]>();
  for (const d of ds) {
    const a = byJ.get(d.journal_id);
    if (a) a.push(d);
    else byJ.set(d.journal_id, [d]);
  }
  for (const j of js) {
    const row: JournalRow = { ...j, details: (byJ.get(j.id) ?? []).sort((a, b) => a.seq - b.seq) };
    const a = out.get(j.issue_id);
    if (a) a.push(row);
    else out.set(j.issue_id, [row]);
  }
  return out;
}

export function withJournals(issues: IssueRow[], js: Map<number, JournalRow[]>): IssueWithJournals[] {
  return issues.map((i) => ({ ...i, journals: js.get(i.id) ?? [] }));
}

export async function issueWithJournals(id: number): Promise<IssueWithJournals | null> {
  const [i] = await sql<IssueRow[]>`SELECT * FROM sb.rm_issues WHERE id = ${id}`;
  if (!i) return null;
  return withJournals([i], await journalsFor([id]))[0];
}

/** {'207': '박다몬'} — journal detail 값이 문자열이라 키도 문자열. */
export async function lookupMaps(): Promise<Record<string, Record<string, string>>> {
  const rows = await sql<{ kind: string; ref_id: number; name: string }[]>`SELECT kind, ref_id, name FROM sb.rm_lookups`;
  const out: Record<string, Record<string, string>> = { status: {}, priority: {}, tracker: {}, user: {}, cf: {} };
  for (const r of rows) (out[r.kind] ??= {})[String(r.ref_id)] = r.name;
  return out;
}

/** 시간순 정렬 — (created_on 또는 아주 옛날, id). */
export function byTime(a: JournalRow, b: JournalRow): number {
  const ta = a.created_on ? a.created_on.getTime() : -8.64e15;
  const tb = b.created_on ? b.created_on.getTime() : -8.64e15;
  return ta - tb || a.id - b.id;
}

/** Python datetime 의 str() 과 같은 'YYYY-MM-DD HH:MM:SS'(UTC). 프롬프트 문구를 예전과 맞추려고. */
export function pyDt(d: Date | null | undefined): string {
  if (!d) return "None";
  return d.toISOString().slice(0, 19).replace("T", " ");
}
