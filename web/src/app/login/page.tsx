"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthField, AuthShell, authInput } from "@/components/AuthShell";
import { ApiError, api } from "@/lib/api";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setU] = useState(params.get("id") ?? "");
  const [password, setP] = useState("");
  const [err, setErr] = useState("");
  const [held, setHeld] = useState(false);       // 승인 대기 · 반려 — 오류가 아니라 상태 안내
  const [busy, setBusy] = useState(false);
  const justSigned = params.get("signed") === "1";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api("/api/login", { method: "POST", body: JSON.stringify({ username, password }) });
      router.replace(params.get("next") || "/");
    } catch (e) {
      setHeld(e instanceof ApiError && e.status === 403);
      setErr(e instanceof Error ? e.message : "로그인 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {justSigned && !err && (
        <div className="mb-4 rounded-lg bg-ok-soft px-3 py-2.5 text-[13px] text-ok">
          가입 신청을 받았습니다. 관리자가 승인하면 로그인할 수 있습니다.
        </div>
      )}
      {err && <div className={`mb-4 rounded-lg px-3 py-2.5 text-[13px] ${held ? "bg-warn-soft text-warn" : "bg-err-soft text-err"}`}>{err}</div>}
      <AuthField id="u" label="ID">
        <input id="u" autoFocus={!username} autoComplete="username" value={username} onChange={(e) => setU(e.target.value)} className={authInput} />
      </AuthField>
      <AuthField id="p" label="비밀번호">
        <input id="p" autoFocus={!!username} type="password" autoComplete="current-password" value={password}
               onChange={(e) => setP(e.target.value)} className={authInput} />
      </AuthField>
      <button disabled={busy || !username || !password}
              className="mt-1 w-full rounded-lg bg-brand py-2.5 text-[14px] font-semibold text-white hover:bg-brand-ink disabled:opacity-50">
        {busy ? "확인 중…" : "로그인"}
      </button>
      <div className="mt-5 border-t border-line pt-4 text-center text-[13px] text-ink-3">
        계정이 없으면 <Link href="/signup" className="font-semibold text-brand-ink hover:underline">회원가입</Link>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <AuthShell sub="로그인">
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
