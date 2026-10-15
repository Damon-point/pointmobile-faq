import { decideSignup } from "@/server/accounts";
import { sendSignupResult } from "@/server/accountMail";
import { bad, body, paramInt, route } from "@/server/http";
import { requireAdmin } from "@/server/session";

export const dynamic = "force-dynamic";

/** 가입 승인 · 반려 — 결과는 신청자에게 메일로(검증 모드면 기록만). */
export const POST = route(async (req, ctx) => {
  const u = await requireAdmin();
  const b = await body<{ approve: boolean; reason: string }>(req);
  const approve = Boolean(b.approve);
  const [ok, msg, info] = await decideSignup(await paramInt(ctx, "uid"), approve, u.username, String(b.reason ?? ""));
  if (!ok || !info) return bad(msg, 409);
  const [sent, why] = await sendSignupResult(info, approve);
  return { ok: true, message: msg + (sent ? " · 안내 메일 발송" : ` · 안내 메일 못 보냄: ${why}`) };
});
