import { verifyPassword } from "@/server/crypto";
import { sql } from "@/server/db";
import { body, HttpError, route } from "@/server/http";
import { setSession } from "@/server/session";

export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const b = await body<{ username: string; password: string }>(req);
  const [u] = await sql<{ id: number; username: string; role: string; password_hash: string; status: string; reject_reason: string; must_change_password: boolean }[]>`
    SELECT id, username, role, password_hash, status, reject_reason, must_change_password
    FROM sb.users WHERE username = ${String(b.username ?? "").trim()}`;
  if (!u || !verifyPassword(String(b.password ?? ""), u.password_hash)) throw new HttpError(401, "아이디 또는 비밀번호가 맞지 않습니다");
  // 비밀번호가 맞을 때만 상태를 알려 준다 — 남의 ID 로 가입 여부를 떠볼 수 없게
  if (u.status === "pending") throw new HttpError(403, "가입 승인을 기다리고 있습니다. 관리자가 승인하면 로그인할 수 있습니다.");
  if (u.status === "rejected")
    throw new HttpError(403, "가입이 반려되었습니다" + (u.reject_reason ? ` — ${u.reject_reason}` : "") + ". 회원가입에서 다시 신청할 수 있습니다.");
  await setSession({ id: u.id, username: u.username, role: u.role });
  return { ok: true, username: u.username, role: u.role, must_change_password: Boolean(u.must_change_password) };
});
