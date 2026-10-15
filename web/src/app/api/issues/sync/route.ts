import { after } from "next/server";
import { route } from "@/server/http";
import { isLocked, withLock } from "@/server/locks";
import { requireUser } from "@/server/session";
import { saveSyncResult } from "@/server/issuetrack/api";
import { poll, SYNC_LOCK } from "@/server/issuetrack/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Redmine 에서 새 이벤트를 지금 가져온다(평소 5분마다 자동). 읽기만 한다.
 * 응답은 바로 하고 수집은 응답 뒤(after)에 돈다 — 화면은 overview 의 sync_result 로 끝을 안다.
 */
export const POST = route(async () => {
  await requireUser();
  if (await isLocked(SYNC_LOCK)) {
    await saveSyncResult({ skipped: true, reason: "이미 수집 중입니다" });
    return { ok: true, started: false, message: "이미 수집 중입니다" };
  }
  after(async () => {
    const res = await withLock(SYNC_LOCK, 300, async () => {
      try {
        return await poll(Date.now() + 240_000);
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    });
    await saveSyncResult(res ?? { skipped: true, reason: "이미 수집 중입니다" });
  });
  return { ok: true, started: true, message: "Redmine 에서 가져오는 중" };
});
