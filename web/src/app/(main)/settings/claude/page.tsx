"use client";

import { useState } from "react";
import { Button, Section, useRunner } from "@/components/admin/kit";
import { Skeleton, cx } from "@/components/ui";
import { useApi } from "@/lib/api";
import { send, type SettingsOverview } from "@/lib/admin";

export default function ClaudeSettings() {
  const { data: s, loading } = useApi<SettingsOverview>("/api/admin/settings");
  const [tried, setTried] = useState<{ ok: boolean; message: string } | null>(null);
  const { busy, run } = useRunner();
  if (loading || !s) return <Skeleton rows={4} />;
  if (!s.is_admin) return <Section title="Claude 호출">관리자만 볼 수 있습니다.</Section>;
  const c = s.claude;

  return (
    <Section title="Claude 호출" desc="웹 서버에는 Claude Code 가 없어 Anthropic API 키로만 부릅니다. 쓴 만큼 요금이 붙습니다.">
      <div className="rounded-xl border border-line p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-bold">API 키 — api.anthropic.com</span>
          {c.model && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] font-semibold text-ink-2">{c.model}</span>}
        </div>
        <p className={cx("mt-2 text-[12.5px] font-semibold", c.has_key ? "text-ok" : "text-err")}>
          {c.has_key ? "✔ 서버에 ANTHROPIC_API_KEY 가 설정돼 있습니다" : "✘ 서버 환경변수에 ANTHROPIC_API_KEY 가 없습니다 — Claude 를 쓰는 단계가 실패합니다"}
        </p>
        <p className="mt-1.5 text-[12.5px] text-ink-3">키와 모델은 배포 환경변수(ANTHROPIC_API_KEY · SB_MODEL)로 정합니다. 화면에서 바꾸지 않습니다.</p>
      </div>
      {tried && <p className={cx("mt-3 rounded-lg px-3 py-2 text-[13px]", tried.ok ? "bg-ok-soft text-ok" : "bg-err-soft text-err")}>{tried.message}</p>}
      <div className="mt-4 flex justify-end">
        <Button variant="outline" busy={busy === "try"}
                onClick={() => run("try", async () => { const r = await send<{ ok: boolean; message: string }>("/api/admin/settings/claude/try"); setTried(r); return r; })}>
          지금 불러보기
        </Button>
      </div>
    </Section>
  );
}
