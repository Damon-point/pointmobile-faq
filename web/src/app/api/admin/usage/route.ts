import { q, route } from "@/server/http";
import { requireUser } from "@/server/session";
import { byDay, byMonth, byOperation, recentUsage, totals } from "@/server/usage";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  await requireUser();
  let scope = q(req, "scope", "month");
  if (!["today", "month", "all"].includes(scope)) scope = "month";
  return {
    totals: await totals(), by_day: await byDay(30), by_month: await byMonth(12),
    by_operation: await byOperation(scope as "today" | "month" | "all"), recent: await recentUsage(80), scope,
  };
});
