import { qInt, q, route } from "@/server/http";
import { requireUser } from "@/server/session";
import { ACTION_WHAT, r2 } from "@/server/issuetrack/api";
import { issueUrlMaker } from "@/server/issuetrack/client";
import * as ST from "@/server/issuetrack/stats";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 통계 — 이슈 1,600여 건 + 이벤트 1만여 건을 매번 계산한다(서버리스는 프로세스 캐시가 남지 않는다). */
export const GET = route(async (req) => {
  await requireUser();
  const includeExcluded = Boolean(qInt(req, "include_excluded", 0));
  let basis = q(req, "basis", "target");
  if (!(basis in ST.GROUP_BASES)) basis = "target";
  const months = qInt(req, "months", 24);
  const top = qInt(req, "top", 10);

  const rows = await ST.collect(includeExcluded);
  const s = ST.summary(rows);
  const comp = ST.composition(rows, basis, Math.max(1, Math.min(months, 240)), Math.max(1, Math.min(top, 30)));

  const compRows = comp.totals.map(([g, n]) => {
    const mem = comp.members[g] ?? [];
    const lead = mem.map((m) => m.lead_days).filter((v): v is number => v !== null && v >= 0);
    let inside = "";
    if (g === "기타") {
      const c = new Map<string, number>();
      for (const m of mem) c.set(m.target, (c.get(m.target) ?? 0) + 1);
      const sorted = [...c.entries()].sort((a, b) => b[1] - a[1]);
      inside = sorted.slice(0, 12).map(([k, v]) => `${k}(${v})`).join(", ");
      if (sorted.length > 12) inside += ` 외 ${sorted.length - 12}종`;
    }
    return {
      name: g,
      total: n,
      open: mem.filter((m) => m.is_open).length,
      lead: lead.length ? Math.round((lead.reduce((a, b) => a + b, 0) / lead.length) * 10) / 10 : null,
      inside,
    };
  });

  const url = await issueUrlMaker();
  const { aging, ...rest } = s;
  return {
    summary: Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, typeof v === "number" ? r2(v) : v])),
    aging: aging.map(([days, r]) => ({ days, id: r.id, status: r.status, subject: r.subject, assignee: r.assignee, url: url(r.id) })),
    monthly: ST.monthly(rows, 24),
    lead_hist: ST.durationHist(rows, "lead_days"),
    first_hist: ST.durationHist(rows, "first_action_days"),
    by_status: ST.byStatus(rows),
    by_tag: ST.byTag(rows, 18),
    by_assignee: ST.byAssignee(rows, 20).map((a) => ({ ...a, mean_lead: r2(a.mean_lead), mean_action: r2(a.mean_action) })),
    first_action: ST.byFirstAction(rows).map((a) => ({
      key: a.key,
      name: a.name,
      value: a.value,
      mean_days: r2(a.mean_days),
      median_days: r2(a.median_days),
      what: ACTION_WHAT[a.key] ?? "",
    })),
    no_action: ST.noAction(rows).length,
    composition: {
      labels: comp.labels,
      groups: comp.groups,
      series: comp.series,
      n: comp.n,
      rows: compRows,
      basis,
      months,
      top,
    },
    bases: ST.GROUP_BASES,
  };
});
