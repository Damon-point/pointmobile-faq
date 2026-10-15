/**
 * 이슈 통계 — **전부 journal 에서 유도한다**(closed_on 은 결측 · 역전이 많아 쓰지 않는다).
 * 대푯값은 평균, 화면에서 중앙값도 함께 보여 준다. 소요시간은 업무일(workdays.ts).
 * 날짜 경계(월 · 30일)는 예전 앱과 같게 UTC 로 자른다.
 */
import { sql } from "../db";
import { ACTION_KINDS, ACTION_ORDER, Naming, timings } from "./events";
import { journalsFor, withJournals, type IssueRow } from "./store";
import { businessDays, calendarDays } from "./workdays";

const TAG = /\[([^\]]{1,24})\]/g;
export const OPEN_STATUSES = ["Open", "ReOpen", "InProgress", "Monitoring", "Holding"];

const DURATION_BINS: [number, number, string][] = [
  [0, 1, "1일 이내"],
  [1, 3, "1~3일"],
  [3, 5, "3~5일"],
  [5, 10, "1~2주"],
  [10, 20, "2~4주"],
  [20, 60, "1~3개월"],
  [60, Infinity, "3개월 이상"],
];

export const GROUP_BASES: Record<string, string> = { target: "대상(제목 두 번째 태그)", category: "카테고리" };
//: 대상 태그를 묶을 때 자르는 구분자. '-' 는 자르지 않는다(PMDM-ENT · L-POS).
const SPLIT = /[ _,+/]+/;

export type IssueStat = {
  id: number;
  subject: string;
  status: string;
  assignee: string;
  category: string;
  created_at: Date | null;
  resolved_at: Date | null;
  lead_days: number | null;
  lead_cal_days: number | null;
  first_action_days: number | null;
  first_action_kind: string;
  first_action_by: string;
  first_comment_days: number | null;
  reopened: number;
  comments: number;
  participants: number;
  is_open: boolean;
  tags: string[];
  target: string;
};

function tagsOf(subject: string): string[] {
  return [...subject.matchAll(TAG)].map((m) => m[1].trim()).filter(Boolean);
}

/** 제목의 두 번째 태그 = 무엇에 대한 건인가. OS 버전 표기가 붙은 것(PM85_A9)은 첫 토큰만 남겨 묶는다. */
function targetOf(tags: string[]): string {
  const rest = tags.filter((t) => t.toLowerCase() !== "issue");
  if (!rest.length) return "(태그 없음)";
  const head = rest[0].trim().split(SPLIT)[0];
  return head ? head.toUpperCase() : rest[0];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** 이슈별 지표 한 벌. [Test] 이슈는 항상 뺀다. */
export async function collect(includeExcluded = false): Promise<IssueStat[]> {
  const naming = await Naming.load();
  const issues = includeExcluded
    ? await sql<IssueRow[]>`SELECT * FROM sb.rm_issues WHERE NOT is_test`
    : await sql<IssueRow[]>`SELECT * FROM sb.rm_issues WHERE NOT is_test AND NOT excluded`;
  const full = withJournals([...issues], await journalsFor(null));
  return full.map((issue) => {
    const t = timings(issue, naming);
    const subject = issue.subject || "";
    const tags = tagsOf(subject);
    const status = issue.status || "";
    return {
      id: issue.id,
      subject,
      status,
      assignee: issue.assigned_to_name || "(미지정)",
      category: issue.category || "(없음)",
      created_at: issue.created_on,
      resolved_at: t.last_resolved_at,
      lead_days: businessDays(issue.created_on, t.resolved_at),
      lead_cal_days: calendarDays(issue.created_on, t.resolved_at),
      first_action_days: t.first_action_workdays,
      first_action_kind: t.first_action_kind,
      first_action_by: t.first_action_by,
      first_comment_days: t.first_response_workdays,
      reopened: t.reopened,
      comments: t.comment_count,
      participants: t.participants.length,
      is_open: OPEN_STATUSES.includes(status),
      tags,
      target: targetOf(tags),
    };
  });
}

function vals(rows: IssueStat[], f: "lead_days" | "first_action_days"): number[] {
  return rows.map((r) => r[f]).filter((v): v is number => v !== null && v >= 0);
}

const ym = (d: Date) => d.toISOString().slice(0, 7);

export function summary(rows: IssueStat[]) {
  const now = new Date();
  const monthAgo = new Date(now.getTime() - 30 * 86400e3);
  const lead = vals(rows, "lead_days");
  const action = vals(rows, "first_action_days");
  const openNow = rows.filter((r) => r.is_open);
  const aging = openNow
    .filter((r) => r.created_at)
    .map((r) => [Math.floor((now.getTime() - r.created_at!.getTime()) / 86400e3), r] as [number, IssueStat])
    .sort((a, b) => b[0] - a[0])
    .slice(0, 10);
  return {
    total: rows.length,
    open: openNow.length,
    new_30d: rows.filter((r) => r.created_at && r.created_at >= monthAgo).length,
    resolved_30d: rows.filter((r) => r.resolved_at && r.resolved_at >= monthAgo).length,
    mean_lead: mean(lead),
    median_lead: median(lead),
    mean_first: mean(action),
    median_first: median(action),
    reopen_rate: rows.length ? (rows.filter((r) => r.reopened).length / rows.length) * 100 : 0,
    lead_measured: lead.length,
    action_measured: action.length,
    aging,
  };
}

export function monthKeys(months: number): string[] {
  const now = new Date();
  let y = now.getUTCFullYear(), m = now.getUTCMonth();
  const keys: string[] = [];
  for (let i = 0; i < months; i++) {
    keys.push(`${y}-${String(m + 1).padStart(2, "0")}`);
    m--;
    if (m < 0) {
      m = 11;
      y--;
    }
  }
  return keys.reverse();
}

/** 개수 세기 — 처음 나온 순서를 지킨다(동률이면 먼저 나온 것이 앞, Python Counter 와 같다). */
function counter<T>(xs: T[]): Map<T, number> {
  const c = new Map<T, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  return c;
}
function mostCommon<T>(c: Map<T, number>, n?: number): [T, number][] {
  const a = [...c.entries()].sort((x, y) => y[1] - x[1]);
  return n === undefined ? a : a.slice(0, n);
}

export function monthly(rows: IssueStat[], months = 24) {
  const keys = monthKeys(months);
  const created = counter(rows.filter((r) => r.created_at).map((r) => ym(r.created_at!)));
  const resolved = counter(rows.filter((r) => r.resolved_at).map((r) => ym(r.resolved_at!)));
  return { labels: keys, created: keys.map((k) => created.get(k) ?? 0), resolved: keys.map((k) => resolved.get(k) ?? 0) };
}

export function durationHist(rows: IssueStat[], f: "lead_days" | "first_action_days" = "lead_days") {
  const v = vals(rows, f);
  return {
    labels: DURATION_BINS.map((b) => b[2]),
    counts: DURATION_BINS.map(([lo, hi]) => v.filter((x) => lo <= x && x < hi).length),
    n: v.length,
  };
}

export function byAssignee(rows: IssueStat[], top = 15) {
  const agg = new Map<string, { name: string; total: number; open: number; resolved: number; _lead: number[]; _act: number[] }>();
  for (const r of rows) {
    let a = agg.get(r.assignee);
    if (!a) agg.set(r.assignee, (a = { name: r.assignee, total: 0, open: 0, resolved: 0, _lead: [], _act: [] }));
    a.total++;
    if (r.is_open) a.open++;
    if (r.resolved_at) a.resolved++;
    if (r.lead_days !== null && r.lead_days >= 0) a._lead.push(r.lead_days);
    if (r.first_action_days !== null && r.first_action_days >= 0) a._act.push(r.first_action_days);
  }
  return [...agg.values()]
    .map(({ _lead, _act, ...a }) => ({ ...a, mean_lead: mean(_lead), mean_action: mean(_act) }))
    .sort((x, y) => y.total - x.total)
    .slice(0, top);
}

export function byStatus(rows: IssueStat[]) {
  return mostCommon(counter(rows.map((r) => r.status || "(없음)"))).map(([name, value]) => ({ name, value }));
}

/** 제목 앞머리 태그 분포. 대소문자를 무시하고 묶고, 표시는 가장 많이 쓰인 표기. */
export function byTag(rows: IssueStat[], top = 20) {
  const total = new Map<string, number>();
  const spelling = new Map<string, Map<string, number>>();
  for (const r of rows)
    for (const t of r.tags) {
      const k = t.toLowerCase();
      total.set(k, (total.get(k) ?? 0) + 1);
      let s = spelling.get(k);
      if (!s) spelling.set(k, (s = new Map()));
      s.set(t, (s.get(t) ?? 0) + 1);
    }
  return mostCommon(total, top).map(([k, v]) => ({ name: mostCommon(spelling.get(k)!, 1)[0][0], value: v }));
}

export type Composition = {
  labels: string[];
  groups: string[];
  series: Record<string, number[]>;
  totals: [string, number][];
  n: number;
  members: Record<string, IssueStat[]>;
};

/** [Issue] 태그가 붙은 건이 달마다 어떤 형태였는지. 많이 나온 top 개만 남기고 나머지는 '기타'. */
export function composition(rows: IssueStat[], basis = "target", months = 24, top = 10): Composition {
  const src = rows.filter((r) => r.tags.some((t) => t.toLowerCase() === "issue"));
  const keys = monthKeys(months);
  const keySet = new Set(keys);
  const inRange = src.filter((r) => r.created_at && keySet.has(ym(r.created_at)));
  const keyOf = (r: IssueStat) => (basis === "category" ? r.category : r.target);
  const counts = counter(inRange.map(keyOf));
  const head = mostCommon(counts, top).map(([k]) => k);
  const headSet = new Set(head);
  const groups = [...head, ...(counts.size > head.length ? ["기타"] : [])];
  const series: Record<string, number[]> = Object.fromEntries(groups.map((g) => [g, keys.map(() => 0)]));
  const members: Record<string, IssueStat[]> = Object.fromEntries(groups.map((g) => [g, []]));
  const idx = new Map(keys.map((k, i) => [k, i]));
  for (const r of inRange) {
    const g = headSet.has(keyOf(r)) ? keyOf(r) : "기타";
    series[g][idx.get(ym(r.created_at!))!]++;
    members[g].push(r);
  }
  return {
    labels: keys,
    groups,
    series,
    totals: groups.map((g) => [g, series[g].reduce((a, b) => a + b, 0)]),
    n: inRange.length,
    members,
  };
}

/** 첫 반응이 무엇이었는지, 유형마다 얼마나 걸렸는지. */
export function byFirstAction(rows: IssueStat[]) {
  const agg = new Map<string, { key: string; name: string; value: number; _d: number[] }>();
  for (const r of rows) {
    if (!r.first_action_kind) continue;
    let a = agg.get(r.first_action_kind);
    if (!a)
      agg.set(r.first_action_kind, (a = { key: r.first_action_kind, name: ACTION_KINDS[r.first_action_kind] ?? r.first_action_kind, value: 0, _d: [] }));
    a.value++;
    if (r.first_action_days !== null && r.first_action_days >= 0) a._d.push(r.first_action_days);
  }
  const out = [];
  for (const k of ACTION_ORDER) {
    const a = agg.get(k);
    if (!a) continue;
    const { _d, ...rest } = a;
    out.push({ ...rest, mean_days: mean(_d), median_days: median(_d) });
  }
  return out;
}

/** 작성자 말고는 아무도 손대지 않은 이슈. */
export function noAction(rows: IssueStat[]): IssueStat[] {
  return rows.filter((r) => !r.first_action_kind);
}
