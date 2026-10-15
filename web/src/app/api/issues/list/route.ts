import { sql } from "@/server/db";
import { q, qInt, route } from "@/server/http";
import { requireUser } from "@/server/session";
import { kstIso } from "@/server/time";
import { ISSUE_PAGE } from "@/server/issuetrack/api";
import { issueUrlMaker } from "@/server/issuetrack/client";
import type { IssueRow } from "@/server/issuetrack/store";

export const dynamic = "force-dynamic";

/** 이슈 목록. 이슈 번호(4자리 이상)를 그대로 치면 다른 조건은 무시한다 — 그 이슈를 보러 온 것이다. */
export const GET = route(async (req) => {
  await requireUser();
  const limit = Math.max(1, Math.min(qInt(req, "limit", ISSUE_PAGE), 1000));
  const text = q(req, "q").trim();
  const status = q(req, "status");

  const counts = await sql<{ status: string | null; n: number }[]>`
    SELECT status, count(*)::int8 AS n FROM sb.rm_issues WHERE NOT excluded GROUP BY status`;

  let rows: IssueRow[];
  let total: number;
  const num = text.replace(/^#+/, "");
  if (/^\d+$/.test(num) && num.length >= 4) {
    rows = await sql<IssueRow[]>`SELECT * FROM sb.rm_issues WHERE id = ${Number(num)}`;
    total = rows.length;
  } else {
    const st = status.split(",").filter(Boolean);
    const like = `%${text}%`;
    const where = sql`NOT excluded
      ${st.length ? sql`AND status = ANY(${st}::text[])` : sql``}
      ${text ? sql`AND (subject ILIKE ${like} OR assigned_to_name ILIKE ${like} OR author_name ILIKE ${like})` : sql``}`;
    [{ n: total }] = await sql<{ n: number }[]>`SELECT count(*)::int8 AS n FROM sb.rm_issues WHERE ${where}`;
    rows = await sql<IssueRow[]>`
      SELECT * FROM sb.rm_issues WHERE ${where} ORDER BY updated_on DESC NULLS LAST LIMIT ${limit}`;
  }
  const url = await issueUrlMaker();
  return {
    total,
    rows: rows.map((r) => ({
      id: r.id,
      status: r.status || "",
      subject: r.subject || "",
      assignee: r.assigned_to_name || "",
      author: r.author_name || "",
      category: r.category || "",
      tracker: r.tracker || "",
      priority: r.priority || "",
      created: kstIso(r.created_on),
      updated: kstIso(r.updated_on),
      is_test: Boolean(r.is_test),
      excluded: Boolean(r.excluded),
      excluded_reason: r.excluded_reason || "",
      url: url(r.id),
    })),
    counts: counts.map((c) => [c.status || "(없음)", c.n] as [string, number]).sort((a, b) => b[1] - a[1]),
  };
});
