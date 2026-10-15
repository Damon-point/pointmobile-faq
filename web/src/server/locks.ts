/**
 * 작업 잠금 — 서버리스는 인스턴스가 여럿이라 프로세스 안 잠금(threading.Lock)이 소용없다.
 * DB 한 줄(sb.job_locks)로 '지금 누가 이 일을 하는가'를 정한다. 만료 시각이 지나면 남이 가져간다
 * (함수가 도중에 죽어도 영원히 잠기지 않게).
 */
import { randomUUID } from "node:crypto";
import { sql } from "./db";

/** 잡으면 풀 때 쓸 holder 를, 못 잡으면 null. */
export async function tryLock(name: string, ttlSec: number): Promise<string | null> {
  const holder = randomUUID();
  const rows = await sql`
    INSERT INTO sb.job_locks (name, holder, expires_at) VALUES (${name}, ${holder}, now() + make_interval(secs => ${ttlSec}))
    ON CONFLICT (name) DO UPDATE SET holder = EXCLUDED.holder, expires_at = EXCLUDED.expires_at
      WHERE sb.job_locks.expires_at < now()
    RETURNING holder`;
  return rows.length ? holder : null;
}

export async function unlock(name: string, holder: string): Promise<void> {
  await sql`DELETE FROM sb.job_locks WHERE name = ${name} AND holder = ${holder}`;
}

export async function isLocked(name: string): Promise<boolean> {
  const [r] = await sql`SELECT 1 FROM sb.job_locks WHERE name = ${name} AND expires_at > now()`;
  return Boolean(r);
}

/** 잠금을 잡고 fn 을 돌린다. 이미 누가 하고 있으면 null. */
export async function withLock<T>(name: string, ttlSec: number, fn: () => Promise<T>): Promise<T | null> {
  const h = await tryLock(name, ttlSec);
  if (!h) return null;
  try {
    return await fn();
  } finally {
    await unlock(name, h).catch(() => {});
  }
}
