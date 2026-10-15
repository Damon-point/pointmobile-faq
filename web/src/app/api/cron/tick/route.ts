import { NextResponse } from "next/server";
import { tick } from "@/server/issuetrack/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 5분마다 — Redmine 수집 → SB 대상 판정 → 초안 생성 → 담당자 검토 요청.
 * Vercel Cron(vercel.json)이나 Supabase pg_cron 이 부른다. `Authorization: Bearer <CRON_SECRET>` 이 맞아야 돈다.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "인증 실패" }, { status: 401 });
  const res = await tick(Number(process.env.TICK_BUDGET_MS || 270_000));
  return NextResponse.json(res);
}
