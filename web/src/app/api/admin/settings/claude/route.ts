import { hasKey, MODEL } from "@/server/claude";
import { bad, body, route } from "@/server/http";
import { requireAdmin } from "@/server/session";

export const dynamic = "force-dynamic";

/** 웹 서버에는 Claude Code 가 없어 API 키로만 부른다 — 'api' 만 받는다. */
export const POST = route(async (req) => {
  await requireAdmin();
  const b = await body<{ backend: string }>(req);
  if (b.backend !== "api")
    bad("웹 서버에는 Claude Code 가 없어 구독(subscription) 방식은 쓸 수 없습니다. API 키(ANTHROPIC_API_KEY)로만 부릅니다.");
  return { backend: "api", claude: "", has_key: hasKey(), model: MODEL };
});
