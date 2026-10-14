"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthField, AuthShell, authInput } from "@/components/AuthShell";
import { api } from "@/lib/api";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{3,39}$/;
const PW_MIN = 8;

type Form = { company: string; email: string; username: string; password: string; password2: string };

/** 회원가입 — 회사명 · 이메일 · ID · 비밀번호 · 비밀번호 확인. 관리자가 승인해야 로그인할 수 있다. */
export default function SignupPage() {
  const router = useRouter();
  const [f, setF] = useState<Form>({ company: "", email: "", username: "", password: "", password2: "" });
  const [touched, setTouched] = useState<Partial<Record<keyof Form, boolean>>>({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const blur = (k: keyof Form) => () => setTouched({ ...touched, [k]: true });

  const problems: Partial<Record<keyof Form, string>> = {
    company: !f.company.trim() ? "회사명을 입력하세요" : "",
    email: !EMAIL.test(f.email.trim()) ? "이메일 형식이 아닙니다" : "",
    username: !ID.test(f.username.trim()) ? "영문·숫자로 시작하는 4~40자(영문 · 숫자 · . _ -)" : "",
    password: f.password.length < PW_MIN ? `${PW_MIN}자 이상` : "",
    password2: f.password2 !== f.password ? "비밀번호가 일치하지 않습니다" : "",
  };
  const ok = Object.values(problems).every((v) => !v);
  const show = (k: keyof Form) => (touched[k] && f[k] ? problems[k] : "") || "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ company: true, email: true, username: true, password: true, password2: true });
    if (!ok) return;
    setBusy(true);
    setErr("");
    try {
      await api("/api/signup", { method: "POST", body: JSON.stringify({ ...f, company: f.company.trim(), email: f.email.trim(), username: f.username.trim() }) });
      router.replace(`/login?signed=1&id=${encodeURIComponent(f.username.trim())}`);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "가입 신청 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell sub="회원가입 — 관리자 승인 후 로그인할 수 있습니다">
      <form onSubmit={submit} noValidate>
        {err && <div className="mb-4 rounded-lg bg-err-soft px-3 py-2.5 text-[13px] text-err">{err}</div>}
        <AuthField id="company" label="회사명" error={show("company")}>
          <input id="company" autoFocus autoComplete="organization" value={f.company} onChange={set("company")} onBlur={blur("company")} className={authInput} />
        </AuthField>
        <AuthField id="email" label="이메일" hint="승인 결과를 받는 주소" error={show("email")}>
          <input id="email" type="email" autoComplete="email" value={f.email} onChange={set("email")} onBlur={blur("email")} className={authInput} />
        </AuthField>
        <AuthField id="username" label="ID" hint="로그인할 때 씁니다" error={show("username")}>
          <input id="username" autoComplete="username" value={f.username} onChange={set("username")} onBlur={blur("username")} className={authInput} />
        </AuthField>
        <AuthField id="password" label="비밀번호" hint={`${PW_MIN}자 이상`} error={show("password")}>
          <input id="password" type="password" autoComplete="new-password" value={f.password} onChange={set("password")} onBlur={blur("password")} className={authInput} />
        </AuthField>
        <AuthField id="password2" label="비밀번호 확인" error={show("password2")}>
          <input id="password2" type="password" autoComplete="new-password" value={f.password2} onChange={set("password2")} onBlur={blur("password2")} className={authInput} />
        </AuthField>
        <button disabled={busy || !ok}
                className="mt-1 w-full rounded-lg bg-brand py-2.5 text-[14px] font-semibold text-white hover:bg-brand-ink disabled:opacity-50">
          {busy ? "신청 중…" : "가입 신청"}
        </button>
        <div className="mt-5 border-t border-line pt-4 text-center text-[13px] text-ink-3">
          이미 계정이 있으면 <Link href="/login" className="font-semibold text-brand-ink hover:underline">로그인</Link>
        </div>
      </form>
    </AuthShell>
  );
}
