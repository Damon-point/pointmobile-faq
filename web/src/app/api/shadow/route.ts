import { qInt, route } from "@/server/http";
import { runtimeStatus } from "@/server/issuetrack/tick";
import { requireUser } from "@/server/session";
import { live, recent } from "@/server/shadow";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  await requireUser();
  const limit = Math.max(1, Math.min(qInt(req, "limit", 200), 1000));
  return { live: await live(), writes: await recent(limit), runtime: await runtimeStatus() };
});
