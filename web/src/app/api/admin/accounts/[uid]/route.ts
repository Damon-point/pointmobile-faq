import { deleteUser } from "@/server/accounts";
import { bad, paramInt, route } from "@/server/http";
import { requireAdmin } from "@/server/session";

export const dynamic = "force-dynamic";

export const DELETE = route(async (_req, ctx) => {
  const u = await requireAdmin();
  const [ok, msg] = await deleteUser(await paramInt(ctx, "uid"), u.id);
  if (!ok) bad(msg, 409);
  return { ok: true, message: msg };
});
