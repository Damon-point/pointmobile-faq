import { resetPassword } from "@/server/accounts";
import { sendReset } from "@/server/accountMail";
import { bad, paramInt, route } from "@/server/http";
import { requireAdmin } from "@/server/session";

export const dynamic = "force-dynamic";

export const POST = route(async (_req, ctx) => {
  const u = await requireAdmin();
  const [ok, msg, who] = await resetPassword(await paramInt(ctx, "uid"));
  if (!ok) bad(msg, 404);
  const [sent, why] = await sendReset(u.id, who);
  return { ok: true, message: msg + (sent ? " · 안내 메일 발송" : ` · 안내 메일 실패: ${why}`) };
});
