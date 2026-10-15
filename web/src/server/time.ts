/** 시각 표기 — DB 는 UTC(timestamptz), 화면 · 메일은 KST(+09:00). */

const KST_MS = 9 * 3600 * 1000;

/** Date → 'YYYY-MM-DDTHH:MM:SS+09:00'. 없으면 ''. (예전 API 의 _kst 와 같은 모양) */
export function kstIso(d: Date | string | null | undefined): string {
  if (!d) return "";
  const t = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(t.getTime())) return "";
  return new Date(t.getTime() + KST_MS).toISOString().slice(0, 19) + "+09:00";
}

/** KST 기준 'YYYY-MM-DD'. */
export function kstDay(d: Date = new Date()): string {
  return new Date(d.getTime() + KST_MS).toISOString().slice(0, 10);
}

/** KST 기준 'YYYY-MM-DD HH:MM'. */
export function kstMinute(d: Date | null | undefined): string {
  if (!d) return "";
  return new Date(d.getTime() + KST_MS).toISOString().slice(0, 16).replace("T", " ");
}

/** KST 기준 'YYYY-MM-DD HH:MM:SS'. */
export function kstSecond(d: Date = new Date()): string {
  return new Date(d.getTime() + KST_MS).toISOString().slice(0, 19).replace("T", " ");
}
