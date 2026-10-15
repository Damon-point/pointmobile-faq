import { bad, body, paramInt, route } from "@/server/http";
import { requireUser } from "@/server/session";
import { draftOf, loadDocFor, saveDraft, type DraftIn } from "@/server/issuetrack/api";
import * as SB from "@/server/issuetrack/sb";

export const dynamic = "force-dynamic";

/** 저장한 뒤 확정. */
export const POST = route(async (req, ctx) => {
  const u = await requireUser();
  const id = await paramInt(ctx, "id");
  await loadDocFor(u, id);
  await saveDraft(id, draftOf(await body<DraftIn>(req)));
  const res = await SB.approve(id, u.username || "");
  if (!res.ok) bad(res.error || "확정 실패", 409);
  return { ok: true, message: "확정했습니다" };
});
