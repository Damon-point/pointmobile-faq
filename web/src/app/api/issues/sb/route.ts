import { sql } from "@/server/db";
import { q, qInt, route } from "@/server/http";
import { isAdmin, requireUser } from "@/server/session";
import { docDict, SB_ACTIVE, SB_HIDDEN, SB_PAGE, SB_STATES } from "@/server/issuetrack/api";
import { issueUrlMaker } from "@/server/issuetrack/client";
import * as SB from "@/server/issuetrack/sb";

export const dynamic = "force-dynamic";

/** SB 문서 목록. 일반 사용자는 본인 담당만, 관리자는 전체(또는 mine=1 로 본인 것만). */
export const GET = route(async (req) => {
  const u = await requireUser();
  const me = u.username || "";
  const admin = isAdmin(u);
  const mine = qInt(req, "mine", 0);
  const scope = !admin || mine ? me : "";
  const limit = Math.max(1, Math.min(qInt(req, "limit", SB_PAGE), 500));
  const states = q(req, "states", "active");
  const text = q(req, "q").trim();

  const stList = states === "active" ? SB_ACTIVE : states.split(",").filter((s) => s && s !== "all");
  const num = text.replace(/^#+/, "");
  // 이름이 비어 있어도 조건을 건다 — 빈 문자열은 아무것과도 안 맞아 남의 문서가 새지 않는다.
  const where = sql`NOT d.superseded
    ${!admin || mine ? sql`AND d.assignee_name = ${scope}` : sql``}
    ${stList.length ? sql`AND d.state = ANY(${stList}::text[])` : sql``}
    ${text ? (/^\d+$/.test(num) ? sql`AND d.issue_id = ${Number(num)}` : sql`AND d.title ILIKE ${`%${text}%`}`) : sql``}`;

  const [{ n: total }] = await sql<{ n: number }[]>`SELECT count(*)::int8 AS n FROM sb.rm_sb_docs d WHERE ${where}`;
  const rows = await sql<(SB.SbDocRow & { subject: string | null; issue_status: string | null })[]>`
    SELECT d.*, i.subject, i.status AS issue_status
    FROM sb.rm_sb_docs d JOIN sb.rm_issues i ON i.id = d.issue_id
    WHERE ${where} ORDER BY d.source_resolved_at DESC NULLS LAST, d.id DESC LIMIT ${limit}`;
  const url = await issueUrlMaker();
  const summ = await SB.summary(scope);
  return {
    total,
    docs: rows.map((r) => docDict(r, url)),
    me,
    admin,
    scope,
    counts: summ.counts,
    spent_usd: summ.spent_usd,
    generating: summ.running,
    states: SB_STATES,
    active: SB_ACTIVE,
    hidden: SB_HIDDEN,
    disclosures: SB.DISCLOSURES,
    partners: SB.PARTNER_CHOICES,
  };
});
