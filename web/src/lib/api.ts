"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    ...init,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {}
    if (res.status === 401 && typeof window !== "undefined" && !location.pathname.startsWith("/login") && !location.pathname.startsWith("/signup")) {
      location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

/** 데이터를 가져오고, refreshMs 를 주면 그 간격으로 다시 가져온다(창이 보일 때만). */
export function useApi<T>(path: string | null, refreshMs?: number | ((d: T | null) => number | undefined)) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const dataRef = useRef<T | null>(null);

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const d = await api<T>(path);
      dataRef.current = d;
      setData(d);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const ms = typeof refreshMs === "function" ? refreshMs(dataRef.current) : refreshMs;
      if (!ms) return;
      timer = setTimeout(async () => {
        if (document.visibilityState === "visible") await load();
        tick();
      }, ms);
    };
    tick();
    return () => clearTimeout(timer);
  }, [load, refreshMs]);

  return { data, error, loading, reload: load };
}

// ── 응답 타입 ────────────────────────────────────────────────────────────────

export type Tone = "ok" | "warn" | "error" | "none";
export type Me = { id: number; username: string; role: string; live: boolean; must_change_password?: boolean; pending_signups?: number };

export function ago(iso: string) {
  if (!iso) return "";
  const t = new Date(iso.includes("T") ? iso : iso.replace(" ", "T"));
  if (isNaN(t.getTime())) return iso;
  const s = (Date.now() - t.getTime()) / 1000;
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}일 전`;
  return `${t.getMonth() + 1}/${t.getDate()}`;
}
