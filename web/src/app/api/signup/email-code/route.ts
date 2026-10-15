import { bad, body, route } from "@/server/http";
import { CODE_TTL_SEC, RESEND_GAP_SEC, sendCode } from "@/server/signupVerify";

export const dynamic = "force-dynamic";

/** 인증번호를 메일로 보낸다(60초 간격 · 한 시간 5번). 검증 모드면 보내지 않고 기록만 한다. */
export const POST = route(async (req) => {
  const b = await body<{ email: string }>(req);
  const [ok, msg] = await sendCode(String(b.email ?? ""));
  if (!ok) bad(msg);
  return { ok: true, message: msg, ttl: CODE_TTL_SEC, resend: RESEND_GAP_SEC };
});
