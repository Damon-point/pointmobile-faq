import { bad, paramInt, route } from "@/server/http";
import { requireUser } from "@/server/session";
import { kstIso } from "@/server/time";
import { r2 } from "@/server/issuetrack/api";
import { baseUrl } from "@/server/issuetrack/client";
import { ACTION_KINDS, Naming, timeline, timings } from "@/server/issuetrack/events";
import { render } from "@/server/issuetrack/markup";
import { issueWithJournals } from "@/server/issuetrack/store";

export const dynamic = "force-dynamic";

/** 이슈 하나의 타임라인과 소요시간 지표. */
export const GET = route(async (_req, ctx) => {
  await requireUser();
  const id = await paramInt(ctx, "id");
  const issue = await issueWithJournals(id);
  if (!issue) bad("이슈가 없습니다", 404);
  const naming = await Naming.load();
  const evs = timeline(issue!, naming);
  const t = timings(issue!, naming);
  let base = "";
  try {
    base = await baseUrl();
  } catch {
    base = "";
  }
  return {
    events: evs.map((e) => ({
      at: kstIso(e.at),
      who: e.who || "",
      kind: e.kind,
      creation: e.is_creation,
      new_status: e.new_status || "",
      summary: e.summary,
      note_html: e.note ? render(e.note, base) : "",
    })),
    metrics: {
      first_action_days: r2(t.first_action_workdays),
      first_action_kind: ACTION_KINDS[t.first_action_kind] ?? "",
      first_action_by: t.first_action_by || "",
      lead_days: r2(t.lead_workdays),
      reopened: t.reopened,
      participants: t.participants,
      comments: t.comment_count,
    },
  };
});
