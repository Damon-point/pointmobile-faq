/**
 * 공용 웹 자격증명(Redmine) — admin 계정 한 곳(sb.web_credentials)에 두고 팀 전체가 쓴다.
 * 비밀번호는 Fernet 으로 암호화돼 있다(crypto.ts).
 */
import { decryptSecret } from "./crypto";
import { sql } from "./db";

/** 공용 자격증명을 가진 계정 id = admin(username 'admin' 우선, 없으면 가장 앞 관리자). */
export async function credentialUserId(): Promise<number> {
  const [r] = await sql<{ id: number }[]>`
    SELECT id FROM sb.users
    ORDER BY (username = 'admin') DESC, (role = 'admin') DESC, id
    LIMIT 1`;
  return r?.id ?? 1;
}

export type WebConfig = { target: string; baseUrl: string; username: string; password: string };

export async function getWebConfig(target: string): Promise<WebConfig | null> {
  const uid = await credentialUserId();
  const [c] = await sql<{ target: string; base_url: string; username: string; encrypted_password: string }[]>`
    SELECT target, base_url, username, encrypted_password FROM sb.web_credentials
    WHERE user_id = ${uid} AND target = ${target}`;
  if (!c || !c.base_url) return null;
  return {
    target: c.target,
    baseUrl: c.base_url,
    username: c.username,
    password: c.encrypted_password ? decryptSecret(c.encrypted_password) : "",
  };
}
