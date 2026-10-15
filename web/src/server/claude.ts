/**
 * Claude 호출 — Anthropic API 키(ANTHROPIC_API_KEY)로 부른다.
 *
 * 예전 앱은 이 PC 의 Claude Code(구독)를 불러 요금 없이 쓰는 길도 있었지만, 웹에 올린 서버에는
 * Claude Code 가 없어 API 하나로 정리했다. 호출마다 사용량을 sb.token_usage 에 남긴다.
 *
 * 정책 거절(stop_reason "refusal")에 대비해 서버 측 대체 모델(fallbacks: "default")을 켠다 —
 * 거절되면 Anthropic 이 권하는 모델로 같은 요청을 한 번 더 돌린다. 끝내 거절되면 호출부가 오류로 다룬다.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { recordUsage } from "./usage";

/** SB 초안 등에 쓰는 기본 모델. SB_MODEL 로 바꿀 수 있다. */
export const MODEL = process.env.SB_MODEL || "claude-opus-5-5";
/** 생각 깊이 — Opus 5.5 의 기본은 medium. SB_EFFORT 로 low · medium · high · xhigh · max. */
const EFFORT = (process.env.SB_EFFORT || "medium") as "low" | "medium" | "high" | "xhigh" | "max";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

let _client: Anthropic | null = null;
function client(): Anthropic {
  // 서버리스 한 번의 실행 시간 안에 끝나야 하므로 너무 길게 기다리지 않는다(초안 1건은 보통 30초 안팎).
  _client ??= new Anthropic({ timeout: Number(process.env.CLAUDE_TIMEOUT_MS || 240_000), maxRetries: 1 });
  return _client;
}

export function hasKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export type Parsed<T> =
  | { ok: true; data: T; model: string; usage: { input_tokens: number; output_tokens: number } }
  | { ok: false; error: string; refusal?: boolean };

/** 구조화 출력 — schema(zod) 모양으로 받아 검증까지 한 값을 돌려준다. 예외를 올리지 않는다. */
export async function parseStructured<S extends z.ZodType>(opts: {
  system: string;
  prompt: string;
  schema: S;
  operation: string;
  maxTokens?: number;
  model?: string;
}): Promise<Parsed<z.infer<S>>> {
  const model = opts.model || MODEL;
  try {
    const resp = await client().beta.messages.parse({
      model,
      max_tokens: opts.maxTokens ?? 16000,
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
      output_config: { format: betaZodOutputFormat(opts.schema), effort: EFFORT },
      betas: [FALLBACK_BETA],
      fallbacks: "default",
    });
    await recordUsage(resp.model || model, resp.usage, opts.operation);
    if (resp.stop_reason === "refusal") {
      const why = resp.stop_details && "category" in resp.stop_details ? resp.stop_details.category : "";
      return { ok: false, refusal: true, error: `Claude 가 응답을 거부했습니다${why ? ` (${why})` : ""}` };
    }
    if (resp.stop_reason === "max_tokens") return { ok: false, error: "응답이 길이 한도에서 끊겼습니다" };
    if (!resp.parsed_output) return { ok: false, error: "구조화 출력을 읽지 못했습니다" };
    return {
      ok: true,
      data: resp.parsed_output as z.infer<S>,
      model: resp.model || model,
      usage: { input_tokens: resp.usage.input_tokens ?? 0, output_tokens: resp.usage.output_tokens ?? 0 },
    };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

/** 짧은 시험 호출 — [설정 → Claude] 의 연결 확인. */
export async function ping(): Promise<{ ok: boolean; message: string; model?: string; ms?: number }> {
  if (!hasKey()) return { ok: false, message: "ANTHROPIC_API_KEY 가 설정되지 않았습니다" };
  const t0 = Date.now();
  try {
    const resp = await client().messages.create({
      model: MODEL,
      max_tokens: 64,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: "한 단어로만 답하세요: 연결 확인" }],
    });
    await recordUsage(resp.model, resp.usage, "연결 확인");
    const text = resp.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
    return { ok: true, message: text || "(빈 응답)", model: resp.model, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, message: errText(e) };
  }
}

function errText(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "API 키가 맞지 않습니다(401)";
  if (e instanceof Anthropic.RateLimitError) return "요청 한도에 걸렸습니다(429) — 잠시 뒤 다시";
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "Claude 응답 시간이 지났습니다";
  if (e instanceof Anthropic.APIError) return `Claude API 오류(${e.status ?? "?"}): ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
