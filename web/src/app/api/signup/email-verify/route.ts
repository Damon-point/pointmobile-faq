import { bad, body, route } from "@/server/http";
import { verifyCode } from "@/server/signupVerify";

export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const b = await body<{ email: string; code: string }>(req);
  const [ok, msg, token] = await verifyCode(String(b.email ?? ""), String(b.code ?? ""));
  if (!ok) bad(msg);
  return { ok: true, message: msg, token };
});
