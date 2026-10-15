import { body, paramInt, route } from "@/server/http";
import { requireUser } from "@/server/session";
import { draftOf, loadDocFor, saveDraft, type DraftIn } from "@/server/issuetrack/api";

export const dynamic = "force-dynamic";

export const POST = route(async (req, ctx) => {
  const u = await requireUser();
  const id = await paramInt(ctx, "id");
  await loadDocFor(u, id);
  await saveDraft(id, draftOf(await body<DraftIn>(req)));
  return { ok: true, message: "저장했습니다", doc: await loadDocFor(u, id) };
});
