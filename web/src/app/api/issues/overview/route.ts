import { sql } from "@/server/db";
import { route } from "@/server/http";
import { isLocked } from "@/server/locks";
import { isAdmin, requireUser } from "@/server/session";
import { isoKst, syncResult } from "@/server/issuetrack/api";
import { dataVersion, status, SYNC_LOCK } from "@/server/issuetrack/sync";

export const dynamic = "force-dynamic";

/** 머리말 — 수집 상태 · 내 미처리 문서 수 · 데이터 판번호. */
export const GET = route(async () => {
  const u = await requireUser();
  let st: Partial<Awaited<ReturnType<typeof status>>> & { last_error?: string | null } = {};
  try {
    st = await status();
  } catch (e) {
    st = { last_error: e instanceof Error ? e.message : String(e) };
  }
  let open = 0;
  try {
    const [r] = await sql<{ n: number }[]>`
      SELECT count(*)::int8 AS n FROM sb.rm_sb_docs
      WHERE NOT superseded AND state IN ('draft', 'notified', 'error')
        ${isAdmin(u) ? sql`` : sql`AND assignee_name = ${u.username || ""}`}`;
    open = r.n;
  } catch {
    open = 0;
  }
  return {
    me: u.username,
    admin: isAdmin(u),
    sb_open: open,
    sync: {
      issues: st.issues ?? 0,
      journals: st.journals ?? 0,
      detail_pending: st.detail_pending ?? 0,
      backfill: st.backfill ?? "",
      last_poll: isoKst(st.last_poll),
      last_error: st.last_error || "",
      running: await isLocked(SYNC_LOCK),
    },
    sync_result: await syncResult(),
    version: await dataVersion(),
  };
});
