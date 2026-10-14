"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AuthField, AuthShell, authInput } from "@/components/AuthShell";
import { cx } from "@/components/ui";
import { api } from "@/lib/api";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{3,39}$/;
const PW_MIN = 8;

type Check = { ok: boolean; message: string } | null;

/** 입력이 멈추고 0.4초 뒤 서버에 중복을 묻는다. 형식이 틀리면 묻지 않는다. */
function useAvailability(kind: "username" | "email", value: string, valid: boolean): [Check, boolean] {
  const [res, setRes] = useState<Check>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setRes(null);
    if (!valid) return;
    setBusy(true);
    const v = value.trim();
    const t = setTimeout(async () => {
      try {
        const r = await api<Record<string, { ok: boolean; message: string }>>(`/api/signup/check?${kind}=${encodeURIComponent(v)}`);
        setRes(r[kind] ?? null);
      } catch {
        setRes(null);
      } finally {
        setBusy(false);
      }
    }, 400);
    return () => { clearTimeout(t); setBusy(false); };
  }, [kind, value, valid]);
  return [res, busy];
}

function useCountdown(until: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  return Math.max(0, Math.ceil((until - now) / 1000));
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function Hint({ res, busy, idle }: { res: Check; busy: boolean; idle?: string }) {
  if (busy) return <div className="mt-1 text-[12px] text-ink-3">확인 중…</div>;
  if (res) return <div className={cx("mt-1 text-[12px]", res.ok ? "text-ok" : "text-err")}>{res.ok ? "✓ " : ""}{res.message}</div>;
  return idle ? <div className="mt-1 text-[12px] text-err">{idle}</div> : null;
}

/** 회원가입 — 회사명 · 이메일(인증) · ID(중복 확인) · 비밀번호 · 비밀번호 확인. 관리자가 승인해야 로그인할 수 있다. */
export default function SignupPage() {
  const router = useRouter();
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // 이메일 인증
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [codeUntil, setCodeUntil] = useState(0);
  const [resendAt, setResendAt] = useState(0);
  const [token, setToken] = useState("");
  const [mailMsg, setMailMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [mailBusy, setMailBusy] = useState("");
  const codeRef = useRef<HTMLInputElement>(null);
  const codeLeft = useCountdown(codeUntil);
  const resendLeft = useCountdown(resendAt);

  const emailValid = EMAIL.test(email.trim());
  const idValid = ID.test(username.trim());
  const [emailCheck, emailChecking] = useAvailability("email", email, emailValid && !token);
  const [idCheck, idChecking] = useAvailability("username", username, idValid);
  const verified = !!token;

  function changeEmail(v: string) {
    setEmail(v);
    if (token || codeSent) { setToken(""); setCodeSent(false); setCode(""); setCodeUntil(0); setMailMsg(null); }
  }

  async function sendCode() {
    setMailBusy("send");
    setMailMsg(null);
    try {
      const r = await api<{ message: string; ttl: number; resend: number }>("/api/signup/email-code", { method: "POST", body: JSON.stringify({ email: email.trim() }) });
      setCodeSent(true);
      setCode("");
      setCodeUntil(Date.now() + r.ttl * 1000);
      setResendAt(Date.now() + r.resend * 1000);
      setMailMsg({ ok: true, text: r.message });
      setTimeout(() => codeRef.current?.focus(), 30);
    } catch (e) {
      setMailMsg({ ok: false, text: e instanceof Error ? e.message : "인증번호를 보내지 못했습니다" });
    } finally {
      setMailBusy("");
    }
  }

  async function verify() {
    setMailBusy("verify");
    try {
      const r = await api<{ message: string; token: string }>("/api/signup/email-verify", { method: "POST", body: JSON.stringify({ email: email.trim(), code: code.trim() }) });
      setToken(r.token);
      setCodeSent(false);
      setMailMsg({ ok: true, text: r.message });
    } catch (e) {
      setMailMsg({ ok: false, text: e instanceof Error ? e.message : "확인하지 못했습니다" });
    } finally {
      setMailBusy("");
    }
  }

  const pwErr = pw.length > 0 && pw.length < PW_MIN ? `${PW_MIN}자 이상` : "";
  const pw2Err = pw2.length > 0 && pw2 !== pw ? "비밀번호가 일치하지 않습니다" : "";
  const ready = !!company.trim() && verified && idValid && !!idCheck?.ok && pw.length >= PW_MIN && pw === pw2;
  const missing = [
    !company.trim() && "회사명", !verified && "이메일 인증", !(idValid && idCheck?.ok) && "ID", !(pw.length >= PW_MIN && pw === pw2) && "비밀번호",
  ].filter(Boolean) as string[];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ company: true, email: true, username: true });
    if (!ready) return;
    setBusy(true);
    setErr("");
    try {
      await api("/api/signup", {
        method: "POST",
        body: JSON.stringify({ company: company.trim(), email: email.trim(), email_token: token, username: username.trim(), password: pw, password2: pw2 }),
      });
      router.replace(`/login?signed=1&id=${encodeURIComponent(username.trim())}`);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "가입 신청 실패");
    } finally {
      setBusy(false);
    }
  }

  const btn = "shrink-0 whitespace-nowrap rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-semibold hover:bg-surface-2 disabled:opacity-50";

  return (
    <AuthShell sub="회원가입 — 관리자 승인 후 로그인할 수 있습니다">
      <form onSubmit={submit} noValidate>
        {err && <div className="mb-4 rounded-lg bg-err-soft px-3 py-2.5 text-[13px] text-err">{err}</div>}

        <AuthField id="company" label="회사명" error={touched.company && !company.trim() ? "회사명을 입력하세요" : ""}>
          <input id="company" autoFocus autoComplete="organization" value={company} onChange={(e) => setCompany(e.target.value)}
                 onBlur={() => setTouched((t) => ({ ...t, company: true }))} className={authInput} />
        </AuthField>

        <div className="mb-4">
          <label className="mb-1.5 flex items-baseline gap-2 text-[13px] font-semibold text-ink-2" htmlFor="email">
            이메일<span className="text-[11.5px] font-normal text-ink-3">인증번호를 받아 확인합니다</span>
          </label>
          <div className="flex gap-2">
            <input id="email" type="email" autoComplete="email" value={email} readOnly={verified}
                   onChange={(e) => changeEmail(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                   className={cx(authInput, verified && "bg-surface-2 text-ink-2")} />
            {verified ? (
              <button type="button" className={btn} onClick={() => changeEmail("")}>변경</button>
            ) : (
              <button type="button" className={btn} onClick={sendCode}
                      disabled={!emailValid || !emailCheck?.ok || mailBusy === "send" || resendLeft > 0}>
                {mailBusy === "send" ? "보내는 중…" : resendLeft > 0 ? `재전송 ${resendLeft}초` : codeSent ? "다시 받기" : "인증번호 받기"}
              </button>
            )}
          </div>
          {verified ? (
            <div className="mt-1 text-[12px] font-semibold text-ok">✓ 인증된 이메일</div>
          ) : (
            <Hint res={emailCheck} busy={emailChecking} idle={touched.email && email && !emailValid ? "이메일 형식이 아닙니다" : ""} />
          )}

          {codeSent && !verified && (
            <div className="mt-2.5 rounded-lg bg-surface-2 p-3">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input ref={codeRef} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="인증번호 6자리"
                         value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                         onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (code.length === 6) verify(); } }}
                         className={cx(authInput, "pr-14 font-mono tracking-[0.3em]")} />
                  <span className={cx("absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[12px]", codeLeft > 60 ? "text-ink-3" : "text-err")}>
                    {codeLeft > 0 ? mmss(codeLeft) : "만료"}
                  </span>
                </div>
                <button type="button" className={cx(btn, "border-transparent bg-brand text-white hover:bg-brand-ink")}
                        disabled={code.length !== 6 || codeLeft === 0 || mailBusy === "verify"} onClick={verify}>
                  {mailBusy === "verify" ? "확인 중…" : "확인"}
                </button>
              </div>
            </div>
          )}
          {mailMsg && !verified && (
            <div className={cx("mt-1.5 text-[12px]", mailMsg.ok ? "text-ink-2" : "text-err")}>{mailMsg.text}</div>
          )}
        </div>

        <div className="mb-4">
          <label className="mb-1.5 flex items-baseline gap-2 text-[13px] font-semibold text-ink-2" htmlFor="username">
            ID<span className="text-[11.5px] font-normal text-ink-3">로그인할 때 씁니다</span>
          </label>
          <input id="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)}
                 onBlur={() => setTouched((t) => ({ ...t, username: true }))} className={authInput} />
          <Hint res={idCheck} busy={idChecking}
                idle={touched.username && username && !idValid ? "영문·숫자로 시작하는 4~40자(영문 · 숫자 · . _ -)" : ""} />
        </div>

        <AuthField id="password" label="비밀번호" hint={`${PW_MIN}자 이상`} error={pwErr}>
          <input id="password" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} className={authInput} />
        </AuthField>
        <AuthField id="password2" label="비밀번호 확인" error={pw2Err}>
          <input id="password2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} className={authInput} />
        </AuthField>

        <button disabled={busy || !ready}
                className="mt-1 w-full rounded-lg bg-brand py-2.5 text-[14px] font-semibold text-white hover:bg-brand-ink disabled:opacity-50">
          {busy ? "신청 중…" : "가입 신청"}
        </button>
        {!ready && missing.length > 0 && <div className="mt-2 text-center text-[12px] text-ink-3">남은 것: {missing.join(" · ")}</div>}
        <div className="mt-5 border-t border-line pt-4 text-center text-[13px] text-ink-3">
          이미 계정이 있으면 <Link href="/login" className="font-semibold text-brand-ink hover:underline">로그인</Link>
        </div>
      </form>
    </AuthShell>
  );
}
