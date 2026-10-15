import { setUserRole } from "@/server/accounts";
import { bad, body, paramInt, route } from "@/server/http";
import { requireAdmin } from "@/server/session";

export const dynamic = "force-dynamic";

export const POST = route(async (req, ctx) => {
  await requireAdmin();
  const b = await body<{ role: string }>(req);
  const [ok, msg] = await setUserRole(await paramInt(ctx, "uid"), String(b.role ?? ""));
  if (!ok) bad(msg, 409);
  return { ok: true, message: msg };
});
