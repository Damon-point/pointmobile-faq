import { bad, body, paramInt, route } from "@/server/http";
import { requireUser } from "@/server/session";
import { draftOf, loadDocFor, saveDraft, type DraftIn } from "@/server/issuetrack/api";
import * as SB from "@/server/issuetrack/sb";

export const dynamic = "force-dynamic";

/** 저장한 뒤 담당자에게 검토 요청 메일. 검증 모드면 보내지 않고 기록만 한다. */
export const POST = route(async (req, ctx) => {
  const u = await requireUser();
  const id = await paramInt(ctx, "id");
  await loadDocFor(u, id);
  await saveDraft(id, draftOf(await body<DraftIn>(req)));
  const res = await SB.notify(id);
  if (!res.sent) bad(`발송 실패: ${res.error}`, 409);
  return { ok: true, message: `검토 요청 메일을 보냈습니다 → ${(res.to || []).join(", ")}` };
});
