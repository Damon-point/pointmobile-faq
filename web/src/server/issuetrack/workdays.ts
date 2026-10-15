/**
 * 업무일 계산 — 주말과 한국 공휴일을 뺀다(사용자 확정 2026-08-11).
 *
 * 공휴일은 krHolidays.ts 의 표(예전 앱이 쓰던 Python holidays KR 자료 — 대체 · 임시공휴일 · 선거일 포함)를 쓴다.
 *
 * 하루를 [00:00, 24:00) 한 칸으로 보고 시작일과 종료일은 걸친 만큼만 센다. 날짜 경계는 예전 앱과
 * 같게 **UTC** 로 자른다(저장값이 UTC 라 예전 숫자와 맞추려고).
 */
import { KR_HOLIDAYS } from "./krHolidays";

const FIRST_YEAR = 2015;
const LAST_YEAR = 2035;
const DAY = 86400_000;

let cum: Map<number, number> | null = null; // 날짜(UTC 자정 ms) → 그 날까지(포함) 업무일 누적
let hol: Set<string> = new Set(); // 'YYYY-MM-DD'
let first = 0;
let last = 0;

function key(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function load(): void {
  if (cum) return;
  const set = new Set<string>();
  for (const [y, days] of Object.entries(KR_HOLIDAYS)) for (const md of days) set.add(`${y}-${md}`);
  hol = set;
  first = Date.UTC(FIRST_YEAR, 0, 1);
  last = Date.UTC(LAST_YEAR, 11, 31);
  const m = new Map<number, number>();
  let n = 0;
  for (let t = first; t <= last; t += DAY) {
    if (isBizMs(t)) n++;
    m.set(t, n);
  }
  cum = m;
}

function isBizMs(dayMs: number): boolean {
  const wd = new Date(dayMs).getUTCDay(); // 0=일 6=토
  return wd !== 0 && wd !== 6 && !hol.has(key(dayMs));
}

function dayOf(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function isBusinessDay(dayMs: number): boolean {
  load();
  return isBizMs(dayMs);
}

/** (a, b] 구간의 업무일 수(날짜 ms). a 는 빼고 b 는 넣는다. */
function countDays(a: number, b: number): number {
  load();
  if (b <= a) return 0;
  const lo = Math.max(a, first);
  const hi = Math.min(b, last);
  if (hi <= lo) return 0;
  return (cum!.get(hi) ?? 0) - (cum!.get(lo) ?? 0);
}

function frac(t: Date): number {
  return (t.getUTCHours() * 3600 + t.getUTCMinutes() * 60 + t.getUTCSeconds()) / 86400;
}

/** a → b 사이의 업무일. 값이 없거나 뒤집힌 구간은 null. 주말 · 공휴일에만 걸친 구간은 0. */
export function businessDays(a: Date | null | undefined, b: Date | null | undefined): number | null {
  if (!a || !b || b < a) return null;
  load();
  const da = dayOf(a), db = dayOf(b);
  if (da === db) {
    if (!isBizMs(da)) return 0;
    return (b.getTime() - a.getTime()) / DAY;
  }
  let total = 0;
  if (isBizMs(da)) total += 1 - frac(a);
  if (isBizMs(db)) total += frac(b);
  total += countDays(da, db - DAY); // 사이에 낀 온전한 날들
  return total;
}

/** 달력일. */
export function calendarDays(a: Date | null | undefined, b: Date | null | undefined): number | null {
  if (!a || !b || b < a) return null;
  return (b.getTime() - a.getTime()) / DAY;
}

/** 확인용 — 그 해 평일 공휴일 목록. */
export function holidaysOf(year: number): string[] {
  load();
  return [...hol].filter((d) => d.startsWith(String(year))).sort();
}
