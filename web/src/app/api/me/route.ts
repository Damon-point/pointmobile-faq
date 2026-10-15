import { pendingCount } from "@/server/accounts";
import { sql } from "@/server/db";
import { route } from "@/server/http";
import { requireUser } from "@/server/session";
import { live } from "@/server/shadow";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const u = await requireUser();
  const [row] = await sql<{ must_change_password: boolean }[]>`SELECT must_change_password FROM sb.users WHERE id = ${u.id}`;
  const out: Record<string, unknown> = { ...u, live: await live(), must_change_password: Boolean(row?.must_change_password) };
  if (u.role === "admin") out.pending_signups = await pendingCount();
  return out;
});
