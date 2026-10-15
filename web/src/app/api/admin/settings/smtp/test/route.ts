import { decryptSecret } from "@/server/crypto";
import { sql } from "@/server/db";
import { bad, body, route } from "@/server/http";
import { smtpHostFor, smtpPort, verifySmtp } from "@/server/mailer";
import { requireUser } from "@/server/session";
import { relayGuard } from "../../../_mail";
import { MAIL_SERVER } from "../../../_shared";

export const dynamic = "force-dynamic";

/** SMTP 로그인까지만 해 본다 — 메일은 보내지 않는다. */
export const POST = route(async (req) => {
  const u = await requireUser();
  await relayGuard(u);
  const b = await body<{ email: string; password: string }>(req);
  let pw = String(b.password ?? "");
  if (!pw) {
    const [row] = await sql<{ encrypted_password: string }[]>`SELECT encrypted_password FROM sb.mail_credentials WHERE user_id = ${u.id}`;
    pw = row?.encrypted_password ? decryptSecret(row.encrypted_password) : "";
  }
  const email = String(b.email ?? "").trim();
  if (!email || !pw) bad("메일 주소와 앱 비밀번호가 필요합니다");
  const host = smtpHostFor(MAIL_SERVER), port = smtpPort();
  try {
    await verifySmtp(host, port, email, pw);
    return { ok: true, message: `${host}:${port} 로그인 성공` };
  } catch (e) {
    return { ok: false, message: `로그인 실패: ${e instanceof Error ? e.message : String(e)}` };
  }
});
