import { bad, paramInt, route } from "@/server/http";
import { requireAdmin } from "@/server/session";
import { deleteStaff } from "@/server/staff";

export const dynamic = "force-dynamic";

export const DELETE = route(async (_req, ctx) => {
  await requireAdmin();
  const [ok, msg] = await deleteStaff(await paramInt(ctx, "sid"));
  if (!ok) bad(msg);
  return { ok: true, message: msg };
});
