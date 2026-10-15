import { bad, body, param, route } from "@/server/http";
import { fill, missingVars, sample, TEMPLATES, unknownVars } from "@/server/mailTemplates";
import { requireAdmin } from "@/server/session";

export const dynamic = "force-dynamic";

export const POST = route(async (req, ctx) => {
  await requireAdmin();
  const key = await param(ctx, "key");
  if (!TEMPLATES[key]) bad("없는 문구입니다", 404);
  const b = await body<{ subject: string; body: string }>(req);
  const subject = String(b.subject ?? ""), text = String(b.body ?? "");
  const vals = await sample(key);
  return {
    subject: fill(subject, vals), body: fill(text, vals),
    unknown: unknownVars(key, subject, text), missing: missingVars(key, subject, text),
  };
});
