import { INITIAL_PASSWORD } from "@/server/accounts";
import { hashPassword, verifyPassword } from "@/server/crypto";
import { sql } from "@/server/db";
import { bad, body, route } from "@/server/http";
import { requireUser } from "@/server/session";

export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const u = await requireUser();
  const b = await body<{ current: string; new: string }>(req);
  const pw = String(b.new ?? "").trim();
  if (pw.length < 4) bad("비밀번호는 4자 이상이어야 합니다");
  if (pw === INITIAL_PASSWORD) bad("초기 비밀번호와 다른 값으로 정하세요");
  const [row] = await sql<{ password_hash: string }[]>`SELECT password_hash FROM sb.users WHERE id = ${u.id}`;
  if (!row || !verifyPassword(String(b.current ?? ""), row.password_hash)) bad("지금 비밀번호가 맞지 않습니다", 403);
  await sql`UPDATE sb.users SET password_hash = ${hashPassword(pw)}, must_change_password = false WHERE id = ${u.id}`;
  return { ok: true, message: "비밀번호를 바꿨습니다" };
});
