import { encryptSecret } from "@/server/crypto";
import { sql } from "@/server/db";
import { bad, body, route } from "@/server/http";
import { requireUser } from "@/server/session";
import { relayGuard } from "../../_mail";
import { MAIL_SERVER } from "../../_shared";

export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const u = await requireUser();
  await relayGuard(u);
  const b = await body<{ email: string; password: string }>(req);
  const email = String(b.email ?? "").trim();
  const pw = String(b.password ?? "");
  if (!email) bad("메일 주소를 입력하세요");
  const [row] = await sql`SELECT id FROM sb.mail_credentials WHERE user_id = ${u.id}`;
  if (!row) {
    if (!pw) bad("최초 등록 시 앱 비밀번호가 필요합니다");
    await sql`
      INSERT INTO sb.mail_credentials (user_id, email_address, encrypted_password, pop_server)
      VALUES (${u.id}, ${email}, ${encryptSecret(pw)}, ${MAIL_SERVER})`;
  } else if (pw) {
    await sql`
      UPDATE sb.mail_credentials SET email_address = ${email}, pop_server = ${MAIL_SERVER},
        encrypted_password = ${encryptSecret(pw)}, updated_at = now() WHERE user_id = ${u.id}`;
  } else {
    await sql`
      UPDATE sb.mail_credentials SET email_address = ${email}, pop_server = ${MAIL_SERVER}, updated_at = now()
      WHERE user_id = ${u.id}`;
  }
  return { ok: true, message: "발송 계정을 저장했습니다" };
});
