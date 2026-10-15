import { requestSignup } from "@/server/accounts";
import { sendSignupRequest } from "@/server/accountMail";
import { bad, body, route } from "@/server/http";
import { consumeToken, emailStatus, tokenValid } from "@/server/signupVerify";

export const dynamic = "force-dynamic";

type SignupIn = { company: string; email: string; email_token: string; username: string; password: string; password2: string };

/** 회원가입 신청 — 이메일 인증 · ID/이메일 중복을 확인하고 승인 대기 계정을 만든 뒤 관리자에게 알린다. */
export const POST = route(async (req) => {
  const b = await body<SignupIn>(req);
  const company = String(b.company ?? ""), email = String(b.email ?? ""), username = String(b.username ?? "");
  if (!(await tokenValid(email, String(b.email_token ?? "")))) bad("이메일 인증을 먼저 마치세요(인증 후 30분 안에 신청해야 합니다)");
  const [eOk, eMsg] = await emailStatus(email);
  if (!eOk) bad(eMsg);
  const [ok, msg] = await requestSignup(company, email, username, String(b.password ?? ""), String(b.password2 ?? ""));
  if (!ok) bad(msg);
  await consumeToken(email);
  const [sent, why] = await sendSignupRequest({ company: company.trim(), email: email.trim(), username: username.trim() });
  if (!sent) console.log(`[signup] 관리자 알림 실패: ${why}`);
  return { ok: true, message: msg };
});
