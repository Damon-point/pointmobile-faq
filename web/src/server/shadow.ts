/**
 * 검증 모드 — 운영 전환 전까지 외부(메일)에 쓰지 않는다.
 *
 * tw-next(3080) · tw-automation(8080) 과 같은 메일 계정을 쓰므로, 검증 중에 실제로 보내면 같은 메일이
 * 두 번 나간다. 그래서 외부에 쓰는 **마지막 함수**에서 여기에 묻고, 검증 모드면 보내려던 것만
 * sb.shadow_writes 에 남기고 성공한 것처럼 돌려준다. 운영 전환은 설정(app_settings 'live_writes')에서 한다.
 */
import { getSetting } from "./appSettings";
import { sql } from "./db";
import { kstIso } from "./time";

/** 외부에 실제로 써도 되는가. 설정을 못 읽으면 쓰지 않는다. */
export async function live(): Promise<boolean> {
  try {
    return (await getSetting("live_writes")) === "1";
  } catch {
    return false;
  }
}

function clip(v: unknown): unknown {
  if (typeof v === "string" && v.length > 2000) return v.slice(0, 2000) + `… (+${v.length - 2000})`;
  return v;
}

/** 보내지 않은 쓰기 하나를 남긴다. 기록이 실패해도 업무는 막지 않는다. */
export async function record(system: string, action: string, detail: Record<string, unknown> = {}): Promise<void> {
  const d: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) d[k] = clip(v);
  try {
    await sql`INSERT INTO sb.shadow_writes (system, action, detail) VALUES (${system}, ${action}, ${sql.json(d as never)})`;
  } catch (e) {
    console.error("[shadow] 기록 실패", e);
  }
}

/** 검증 모드면 기록하고 true(=보내지 말 것). */
export async function blocked(system: string, action: string, detail: Record<string, unknown> = {}): Promise<boolean> {
  if (await live()) return false;
  await record(system, action, detail);
  return true;
}

/** 최근 기록 — 예전 jsonl 한 줄과 같은 모양({at, system, action, ...detail}). */
export async function recent(limit = 200): Promise<Record<string, unknown>[]> {
  const rows = await sql<{ at: Date; system: string; action: string; detail: Record<string, unknown> }[]>`
    SELECT at, system, action, detail FROM sb.shadow_writes ORDER BY id DESC LIMIT ${limit}`;
  return rows.map((r) => ({ at: kstIso(r.at).slice(0, 19), system: r.system, action: r.action, ...r.detail }));
}
