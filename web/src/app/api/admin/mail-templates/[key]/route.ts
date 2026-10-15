import { bad, body, param, route } from "@/server/http";
import { get, missingVars, save, unknownVars } from "@/server/mailTemplates";
import { requireAdmin } from "@/server/session";

export const dynamic = "force-dynamic";

export const POST = route(async (req, ctx) => {
  const u = await requireAdmin();
  const key = await param(ctx, "key");
  const b = await body<{ subject: string; body: string }>(req);
  const subject = String(b.subject ?? ""), text = String(b.body ?? "");
  const unknown = unknownVars(key, subject, text);
  if (unknown.length) bad("값이 채워지지 않는 자리가 있습니다: " + unknown.map((x) => "{{" + x + "}}").join(", "));
  const gone = missingVars(key, subject, text);
  const [ok, msg] = await save(key, subject, text, u.username);
  if (!ok) bad(msg);
  return { ok: true, message: msg, missing: gone, item: await get(key) };
});
