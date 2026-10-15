import { setSetting } from "@/server/appSettings";
import { body, HttpError, route } from "@/server/http";
import { requireUser } from "@/server/session";
import { live, record } from "@/server/shadow";

export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const u = await requireUser();
  if (u.role !== "admin") throw new HttpError(403, "관리자만 바꿀 수 있습니다");
  const b = await body<{ live: boolean }>(req);
  const on = Boolean(b.live);
  await setSetting("live_writes", on ? "1" : "0", u.username);
  await record("system", on ? "운영 전환" : "검증 모드로", { by: u.username });
  return { live: await live() };
});
