/**
 * Claude API 토큰 사용량 · 비용(추정) — sb.token_usage.
 * 비용은 응답의 토큰 수 × 공개 단가로 계산한 추정치다(계약 할인 등은 반영하지 않는다, 이 앱이 한 호출만 센다).
 */
import { sql } from "./db";
import { kstDay } from "./time";

// 공개 단가 ($ per 1M tokens) = [입력, 출력]. 먼저 맞는 것을 쓰므로 긴 이름을 앞에 둔다.
const PRICING: [string, number, number][] = [
  ["claude-fable-5-1", 10, 50],
  ["claude-fable-5", 10, 50],
  ["claude-opus-5-5", 4, 20],
  ["claude-opus-5", 5, 25],
  ["claude-opus-4", 5, 25],
  ["claude-sonnet-5-5", 2, 10],
  ["claude-sonnet-5", 2, 10],
  ["claude-sonnet-4", 3, 15],
  ["claude-haiku-5-5", 0.1, 0.5],
  ["claude-haiku-4-5", 1, 5],
];
const DEFAULT_PRICE: [number, number] = [5, 25];

export function price(model: string): [number, number] {
  const m = (model || "").toLowerCase();
  for (const [k, i, o] of PRICING) if (m.includes(k)) return [i, o];
  return DEFAULT_PRICE;
}

export type UsageLike = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

export function cost(model: string, u: UsageLike): number {
  const [pin, pout] = price(model);
  const inp = u.input_tokens ?? 0, out = u.output_tokens ?? 0;
  const cr = u.cache_read_input_tokens ?? 0, cw = u.cache_creation_input_tokens ?? 0;
  // cache read ≈ 0.1×, cache write ≈ 1.25× (입력 단가 기준)
  return (inp * pin + out * pout + cr * pin * 0.1 + cw * pin * 1.25) / 1_000_000;
}

/** 호출 한 번의 사용량을 남긴다. 기록이 실패해도 본 작업은 막지 않는다. */
export async function recordUsage(model: string, u: UsageLike, operation = "기타"): Promise<void> {
  try {
    const day = kstDay();
    await sql`
      INSERT INTO sb.token_usage (day, month, model, operation, input_tokens, output_tokens, cache_read, cache_write, cost_usd)
      VALUES (${day}, ${day.slice(0, 7)}, ${model || "?"}, ${operation || "기타"},
              ${u.input_tokens ?? 0}, ${u.output_tokens ?? 0},
              ${u.cache_read_input_tokens ?? 0}, ${u.cache_creation_input_tokens ?? 0}, ${cost(model, u)})`;
  } catch (e) {
    console.error("[usage] 기록 실패", e);
  }
}

// ── 조회(대시보드) ─────────────────────────────────────────────────────────────

type Agg = { cost: number; tokens: number; calls: number };

async function agg(where: "day" | "month" | "all", v = ""): Promise<Agg> {
  const [r] = await sql<Agg[]>`
    SELECT COALESCE(SUM(cost_usd), 0)::float8 AS cost,
           COALESCE(SUM(input_tokens + output_tokens), 0)::int8 AS tokens,
           COUNT(*)::int8 AS calls
    FROM sb.token_usage
    WHERE ${where === "day" ? sql`day = ${v}` : where === "month" ? sql`month = ${v}` : sql`TRUE`}`;
  return r;
}

export async function totals() {
  const today = kstDay();
  return { today: await agg("day", today), month: await agg("month", today.slice(0, 7)), all: await agg("all") };
}

export async function byDay(n = 30) {
  const rows = await sql`
    SELECT day, COALESCE(SUM(cost_usd), 0)::float8 AS cost, COALESCE(SUM(input_tokens + output_tokens), 0)::int8 AS tokens,
           COUNT(*)::int8 AS calls
    FROM sb.token_usage GROUP BY day ORDER BY day DESC LIMIT ${n}`;
  return [...rows].reverse();
}

export async function byMonth(n = 12) {
  const rows = await sql`
    SELECT month, COALESCE(SUM(cost_usd), 0)::float8 AS cost, COALESCE(SUM(input_tokens + output_tokens), 0)::int8 AS tokens,
           COUNT(*)::int8 AS calls
    FROM sb.token_usage GROUP BY month ORDER BY month DESC LIMIT ${n}`;
  return [...rows].reverse();
}

export async function byOperation(scope: "today" | "month" | "all" = "month") {
  const today = kstDay();
  const where = scope === "today" ? sql`day = ${today}` : scope === "month" ? sql`month = ${today.slice(0, 7)}` : sql`TRUE`;
  return sql`
    SELECT operation, COALESCE(SUM(cost_usd), 0)::float8 AS cost, COALESCE(SUM(input_tokens + output_tokens), 0)::int8 AS tokens,
           COUNT(*)::int8 AS calls
    FROM sb.token_usage WHERE ${where} GROUP BY operation ORDER BY cost DESC`;
}

/** 최근 호출 — ts 는 KST 'YYYY-MM-DDTHH:MM:SS'(예전 모양). */
export async function recentUsage(n = 50) {
  const rows = await sql<{ ts: Date; model: string; operation: string; input_tokens: number; output_tokens: number; cache_read: number; cost_usd: number }[]>`
    SELECT ts, model, operation, input_tokens, output_tokens, cache_read, cost_usd
    FROM sb.token_usage ORDER BY id DESC LIMIT ${n}`;
  return rows.map((r) => ({ ...r, ts: new Date(r.ts.getTime() + 9 * 3600e3).toISOString().slice(0, 19) }));
}
