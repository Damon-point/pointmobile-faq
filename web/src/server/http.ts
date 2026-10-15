/**
 * Route Handler 공용 — 오류 응답 모양을 예전 FastAPI 와 같게 둔다: `{"error": "<메시지>"}`.
 * 화면(lib/api.ts)이 이 모양을 읽어 토스트로 보여 주고, 401 이면 로그인으로 보낸다.
 */
import { NextResponse } from "next/server";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const bad = (msg: string, status = 400): never => {
  throw new HttpError(status, msg);
};

type Ctx = { params: Promise<Record<string, string>> };
type Handler = (req: Request, ctx: Ctx) => Promise<unknown> | unknown;

/** 핸들러가 돌려준 값을 JSON 으로, HttpError 는 {error} 로 바꾼다. Response 를 돌려주면 그대로 보낸다. */
export function route(fn: Handler) {
  return async (req: Request, ctx: Ctx) => {
    try {
      const out = await fn(req, ctx);
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      console.error("[api]", req.method, new URL(req.url).pathname, e);
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  };
}

/** 요청 본문(JSON). 비었거나 깨졌으면 {} — 필드별 기본값은 호출부가 정한다. */
export async function body<T = Record<string, unknown>>(req: Request): Promise<Partial<T>> {
  try {
    const t = await req.text();
    return t ? (JSON.parse(t) as Partial<T>) : {};
  } catch {
    return {};
  }
}

/** 쿼리 문자열 하나. */
export function q(req: Request, name: string, dflt = ""): string {
  return new URL(req.url).searchParams.get(name) ?? dflt;
}

export function qInt(req: Request, name: string, dflt: number): number {
  const v = Number.parseInt(q(req, name, ""), 10);
  return Number.isFinite(v) ? v : dflt;
}

/** 경로 변수(예: /sb/[id]). */
export async function param(ctx: Ctx, name: string): Promise<string> {
  return (await ctx.params)[name] ?? "";
}

export async function paramInt(ctx: Ctx, name: string): Promise<number> {
  const v = Number.parseInt(await param(ctx, name), 10);
  if (!Number.isFinite(v)) bad("잘못된 번호입니다", 404);
  return v;
}
