import { body, route } from "@/server/http";
import { requireAdmin, requireUser } from "@/server/session";
import { assigneesWithoutAccount } from "@/server/issuetrack/sb";
import { loadSbSettings, setSbSetting } from "@/server/issuetrack/settings";

export const dynamic = "force-dynamic";

/** SB 동작 설정. */
export const GET = route(async () => {
  await requireUser();
  const cfg = await loadSbSettings();
  return {
    sb_auto_notify: cfg.sb_auto_notify,
    sb_auto_generate: cfg.sb_auto_generate,
    sb_per_tick: cfg.sb_per_tick,
    sb_cutoff: cfg.sb_cutoff,
    sb_assignees: cfg.sb_assignees,
    exclude_keywords: cfg.exclude_keywords,
    without_account: await assigneesWithoutAccount(),
  };
});

/** 화면에서 바꿀 수 있는 것은 셋 — 담당자 알림 · SB 대상 담당자 · 제외 키워드. */
export const POST = route(async (req) => {
  await requireAdmin();
  const b = await body<{ sb_auto_notify: boolean; sb_assignees: string; exclude_keywords: string }>(req);
  if (typeof b.sb_auto_notify === "boolean") await setSbSetting("sb_auto_notify", b.sb_auto_notify);
  if (typeof b.sb_assignees === "string") await setSbSetting("sb_assignees", b.sb_assignees.trim());
  if (typeof b.exclude_keywords === "string") await setSbSetting("exclude_keywords", b.exclude_keywords.trim());
  return { ok: true, message: "저장했습니다 — 다음 수집 주기부터 적용됩니다" };
});
