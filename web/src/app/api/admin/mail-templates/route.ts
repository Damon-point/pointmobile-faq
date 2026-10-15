import { route } from "@/server/http";
import { get, groups, TEMPLATES } from "@/server/mailTemplates";
import { requireAdmin } from "@/server/session";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await requireAdmin();
  const out = [];
  for (const g of groups()) {
    const items = [];
    for (const t of Object.values(TEMPLATES)) if (t.group === g) items.push(await get(t.key));
    out.push({ group: g, items });
  }
  return { groups: out };
});
