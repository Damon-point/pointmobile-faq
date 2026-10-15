import { after } from "next/server";
import { sql } from "@/server/db";
import { bad, paramInt, route } from "@/server/http";
import { requireUser } from "@/server/session";
import { loadDocFor } from "@/server/issuetrack/api";
import * as SB from "@/server/issuetrack/sb";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Claude 로 초안 생성(30초 안팎). 응답은 바로 하고 생성은 응답 뒤(after)에 돈다.
 * 화면은 문서의 generating 표시(generating_since)가 꺼질 때까지 3초마다 다시 읽는다.
 */
export const POST = route(async (_req, ctx) => {
  const u = await requireUser();
  const id = await paramInt(ctx, "id");
  await loadDocFor(u, id);
  const claimed = await sql`
    UPDATE sb.rm_sb_docs SET generating_since = now()
    WHERE id = ${id}
      AND (generating_since IS NULL OR generating_since < now() - make_interval(mins => ${SB.GEN_WINDOW_MIN}))
    RETURNING id`;
  if (!claimed.length) bad("이미 생성 중입니다", 409);
  after(async () => {
    await SB.generate(id);
  });
  return { ok: true, message: "Claude 로 초안을 만드는 중" };
});
