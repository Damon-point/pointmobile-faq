"use client";

import type { Tone } from "@/lib/api";

export function cx(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(" ");
}

export function Card({ title, icon, right, children, className, pad = true }: {
  title?: React.ReactNode; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <section className={cx("rounded-2xl border border-line bg-surface shadow-[0_1px_2px_rgba(16,24,40,.05)]", className)}>
      {title && (
        <header className="flex items-center gap-2 border-b border-line px-5 py-3.5">
          {icon && <span className="text-ink-3">{icon}</span>}
          <h2 className="flex-1 text-[15px] font-bold">{title}</h2>
          {right}
        </header>
      )}
      <div className={pad ? "p-5" : ""}>{children}</div>
    </section>
  );
}

const TONE: Record<Tone, string> = {
  error: "bg-err-soft text-err",
  warn: "bg-warn-soft text-warn",
  ok: "bg-ok-soft text-ok",
  none: "bg-muted-soft text-ink-2",
};

export function Tag({ tone = "none", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={cx("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold", TONE[tone])}>{children}</span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-5 py-10 text-center text-sm text-ink-3">{children}</div>;
}

export function PageHead({ title, lead, right }: { title: React.ReactNode; lead?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight">{title}</h1>
        {lead && <p className="mt-1 text-[14px] text-ink-2">{lead}</p>}
      </div>
      {right}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-lg bg-muted-soft" />
      ))}
    </div>
  );
}
