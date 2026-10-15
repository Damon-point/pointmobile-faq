import { bad, paramInt, route } from "@/server/http";
import { requireUser } from "@/server/session";
import { loadDocFor } from "@/server/issuetrack/api";
import * as SB from "@/server/issuetrack/sb";

export const dynamic = "force-dynamic";

export const POST = route(async (_req, ctx) => {
  const u = await requireUser();
  const id = await paramInt(ctx, "id");
  await loadDocFor(u, id);
  const res = await SB.reopenDraft(id);
  if (!res.ok) bad(res.error || "실패", 409);
  return { ok: true, message: "초안으로 되돌렸습니다" };
});
