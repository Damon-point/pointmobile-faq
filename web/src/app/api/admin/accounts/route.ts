import { INITIAL_PASSWORD, ROLE_LABEL, STATUS_LABEL } from "@/server/accounts";
import { sql } from "@/server/db";
import { route } from "@/server/http";
import { systemFrom, userEmail } from "@/server/mailer";
import { requireUser } from "@/server/session";
import { kstIso } from "@/server/time";

export const dynamic = "force-dynamic";

type Row = {
  id: number; username: string; role: string; must_change_password: boolean; status: string; company: string; email: string;
  requested_at: Date | null; decided_by: string; decided_at: Date | null; reject_reason: string;
};

const ts = (d: Date | null) => kstIso(d).slice(0, 19);

export const GET = route(async () => {
  const u = await requireUser();
  const [fAddr, fName] = systemFrom();
  const admin = u.role === "admin";
  const users = admin ? await sql<Row[]>`SELECT * FROM sb.users ORDER BY id` : [];
  const rows = [];
  for (const x of users) {
    rows.push({
      id: x.id, username: x.username, role: x.role || "user", must_change: Boolean(x.must_change_password),
      status: x.status || "approved", company: x.company || "",
      requested_at: ts(x.requested_at), decided_by: x.decided_by || "", decided_at: ts(x.decided_at),
      reject_reason: x.reject_reason || "", me: x.id === u.id,
      email: x.email || (await userEmail(x.id)) || "",
    });
  }
  return {
    roles: ROLE_LABEL, statuses: STATUS_LABEL, users: rows,
    system_from: fAddr || "", system_from_name: fName || "",
    initial_password: admin ? INITIAL_PASSWORD : "",
  };
});
