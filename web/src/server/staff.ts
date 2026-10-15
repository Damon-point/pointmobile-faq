/**
 * 사내 인원 명부 — 이름 · 메일 주소 · 팀을 관리자가 한 곳에서 관리한다(sb.staff).
 * 메일을 보낼 때 받는 사람의 이름을 찾는 데 쓴다(mailer.ts). 주소 비교는 소문자로 한다.
 */
import { sql } from "./db";

export const ACTIVE = "재직";
export const LEFT = "퇴사";
export const STATUSES = [ACTIVE, LEFT] as const;

export type StaffRow = { id: number; name: string; email: string; status: string; team: string; memo: string; updated_by: string };

const norm = (e: string) => (e || "").trim().toLowerCase();

/** 명부 전체. 재직 먼저, 그다음 이름순. */
export async function listStaff(): Promise<StaffRow[]> {
  const rows = await sql<StaffRow[]>`SELECT id, name, email, status, team, memo, updated_by FROM sb.staff`;
  const out = rows.map((s) => ({
    id: s.id, name: s.name || "", email: s.email || "", status: s.status || ACTIVE,
    team: s.team || "", memo: s.memo || "", updated_by: s.updated_by || "",
  }));
  out.sort((a, b) => {
    const la = a.status !== ACTIVE ? 1 : 0, lb = b.status !== ACTIVE ? 1 : 0;
    if (la !== lb) return la - lb;
    const ka = a.name || a.email, kb = b.name || b.email;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return out;
}

/** 추가(id=null) 또는 수정. [성공, 메시지]. 메일 주소는 명부에서 유일해야 한다. */
export async function saveStaff(o: {
  id: number | null; name: string; email: string; status?: string; team?: string; memo?: string; by?: string;
}): Promise<[boolean, string]> {
  const addr = norm(o.email);
  if (!addr || !addr.includes("@")) return [false, "메일 주소를 정확히 입력하세요."];
  const [dup] = await sql<{ id: number }[]>`SELECT id FROM sb.staff WHERE email = ${addr}`;
  if (dup && (o.id == null || dup.id !== o.id)) return [false, `이미 등록된 주소입니다: ${addr}`];
  const status = (STATUSES as readonly string[]).includes(o.status || "") ? o.status! : ACTIVE;
  const name = (o.name || "").trim(), team = (o.team || "").trim(), memo = (o.memo || "").trim(), by = o.by || "";
  if (o.id != null) {
    const r = await sql`
      UPDATE sb.staff SET name = ${name}, email = ${addr}, status = ${status}, team = ${team}, memo = ${memo}, updated_by = ${by}
      WHERE id = ${o.id} RETURNING id`;
    if (!r.length) return [false, "대상을 찾을 수 없습니다(이미 삭제된 듯합니다)."];
  } else {
    await sql`
      INSERT INTO sb.staff (name, email, status, team, memo, updated_by)
      VALUES (${name}, ${addr}, ${status}, ${team}, ${memo}, ${by})`;
  }
  return [true, "저장했습니다."];
}

export async function deleteStaff(id: number): Promise<[boolean, string]> {
  const r = await sql`DELETE FROM sb.staff WHERE id = ${id} RETURNING id`;
  return r.length ? [true, "삭제했습니다."] : [false, "대상을 찾을 수 없습니다."];
}
