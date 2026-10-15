/**
 * 앱 전체 설정 — 화면에서 바꾸고 DB(sb.app_settings)에 남는다.
 * 우선순위: DB 에 저장된 값 > 환경변수 기본값 > 코드 기본값. 한 번 화면에서 바꾸면 환경변수를 고쳐도 안 바뀐다.
 * 서버리스는 요청마다 인스턴스가 다를 수 있어 값을 붙잡아 두지 않고 매번 읽는다(한 줄 조회다).
 */
import { sql } from "./db";

//: 키 → [환경변수 이름, 코드 기본값, 고를 수 있는 값들]
const DEFS = {
  // 외부 시스템(메일)에 실제로 쓸 것인가. 0 — 검증 모드(기록만), 1 — 운영.
  live_writes: ["TWN_LIVE_WRITES", "0", ["0", "1"]],
} as const satisfies Record<string, readonly [string, string, readonly string[]]>;

export type SettingKey = keyof typeof DEFS;

function envDefault(key: SettingKey): string {
  const [env, fallback, choices] = DEFS[key];
  const raw = (process.env[env] || "").trim().toLowerCase();
  return (choices as readonly string[]).includes(raw) ? raw : fallback;
}

/** 설정 하나. DB 를 못 읽어도 예외를 올리지 않는다 — 기본값으로 돈다. */
export async function getSetting(key: SettingKey): Promise<string> {
  let val = "";
  try {
    const [row] = await sql<{ value: string }[]>`SELECT value FROM sb.app_settings WHERE key = ${key}`;
    val = row?.value ?? "";
  } catch {
    val = "";
  }
  return (DEFS[key][2] as readonly string[]).includes(val) ? val : envDefault(key);
}

export async function setSetting(key: SettingKey, value: string, by = ""): Promise<void> {
  if (!(DEFS[key][2] as readonly string[]).includes(value)) throw new Error(`${key} 에 쓸 수 없는 값입니다: ${value}`);
  await sql`
    INSERT INTO sb.app_settings (key, value, updated_by, updated_at) VALUES (${key}, ${value}, ${by}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
}
