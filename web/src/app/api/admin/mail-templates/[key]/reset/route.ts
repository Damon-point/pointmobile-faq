import { bad, param, route } from "@/server/http";
import { get, reset } from "@/server/mailTemplates";
import { requireAdmin } from "@/server/session";

export const dynamic = "force-dynamic";

export const POST = route(async (_req, ctx) => {
  await requireAdmin();
  const key = await param(ctx, "key");
  const [ok, msg] = await reset(key);
  if (!ok) bad(msg);
  return { ok: true, message: msg, item: await get(key) };
});
