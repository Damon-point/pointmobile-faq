import { ping } from "@/server/claude";
import { route } from "@/server/http";
import { requireAdmin } from "@/server/session";

export const dynamic = "force-dynamic";

export const POST = route(async () => {
  await requireAdmin();
  const r = await ping();
  if (!r.ok) return { ok: false, message: `실패: ${r.message}` };
  return { ok: true, message: `${((r.ms ?? 0) / 1000).toFixed(1)}초 · ${r.model} · 답 '${r.message.slice(0, 20)}'` };
});
