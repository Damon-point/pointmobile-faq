import { bad, body, route } from "@/server/http";
import { requireAdmin } from "@/server/session";
import { ACTIVE, LEFT, listStaff, saveStaff, STATUSES } from "@/server/staff";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await requireAdmin();
  return { staff: await listStaff(), statuses: [...STATUSES], active: ACTIVE, left: LEFT };
});

type StaffIn = { id: number | null; name: string; email: string; team: string; status: string; memo: string };

export const POST = route(async (req) => {
  const u = await requireAdmin();
  const b = await body<StaffIn>(req);
  const [ok, msg] = await saveStaff({
    id: b.id == null ? null : Number(b.id), name: String(b.name ?? ""), email: String(b.email ?? ""),
    status: String(b.status || ACTIVE), team: String(b.team ?? ""), memo: String(b.memo ?? ""), by: u.username,
  });
  if (!ok) bad(msg);
  return { ok: true, message: msg };
});
