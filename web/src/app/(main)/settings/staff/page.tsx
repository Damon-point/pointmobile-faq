"use client";

import { Fragment, useMemo, useState } from "react";
import { Button, Confirm, Field, Input, Modal, SearchBox, Section, Select, useRunner } from "@/components/admin/kit";
import { Empty, Skeleton, cx } from "@/components/ui";
import { useApi } from "@/lib/api";
import { send, type StaffRow } from "@/lib/admin";

type Resp = { staff: StaffRow[]; statuses: string[]; active: string; left: string };
const EMPTY: Omit<StaffRow, "id"> & { id: number | null } = { id: null, name: "", email: "", team: "", status: "", memo: "" };

export default function StaffPage() {
  const { data, loading, reload } = useApi<Resp>("/api/admin/staff");
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<typeof EMPTY | null>(null);
  const [del, setDel] = useState<StaffRow | null>(null);
  const [filter, setFilter] = useState<"" | "left">("");
  const { busy, run } = useRunner();

  const teams = useMemo(() => {
    const rows = (data?.staff ?? []).filter((r) =>
      (!q || `${r.name} ${r.email} ${r.team}`.toLowerCase().includes(q.toLowerCase())) &&
      (!filter || r.status === data?.left));
    const m = new Map<string, StaffRow[]>();
    for (const r of rows) m.set(r.team || "", [...(m.get(r.team || "") ?? []), r]);
    return [...m.entries()].sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : a[0].localeCompare(b[0])))
      .map(([t, ms]) => [t, ms.sort((a, b) => Number(a.status !== data?.active) - Number(b.status !== data?.active) || a.name.localeCompare(b.name))] as const);
  }, [data, q, filter]);

  if (loading || !data) return <Skeleton rows={6} />;
  const all = data.staff;
  const chip = (k: typeof filter, label: string, n: number) => (
    <button onClick={() => setFilter(filter === k ? "" : k)}
            className={cx("rounded-full border px-3 py-1 text-[12.5px] font-semibold", filter === k ? "border-brand bg-brand-soft text-brand-ink" : "border-line-strong text-ink-2")}>
      {label} {n}
    </button>
  );

  return (
    <>
      <Section title="사내 인원 명부"
               desc="사내 인원과 메일 주소 명부입니다. SB 담당자 메일 주소를 찾을 때 씁니다. 퇴사는 표시일 뿐입니다."
               right={<Button onClick={() => setEdit({ ...EMPTY, status: data.active })}>인원 추가</Button>}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {chip("", "전체", all.length)}
          {chip("left", "퇴사", all.filter((r) => r.status === data.left).length)}
          <SearchBox value={q} onChange={setQ} placeholder="이름 · 메일 · 팀" className="ml-auto" />
        </div>
        {teams.length ? (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[560px] text-[13.5px]">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-[11.5px] font-semibold text-ink-3">
                  <th className="px-4 py-2">이름</th><th className="px-3 py-2">메일 주소</th><th className="px-3 py-2 text-center">상태</th><th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {teams.map(([team, ms]) => (
                  <Fragment key={`t-${team}`}>
                    <tr className="border-b border-line bg-surface-2/60">
                      <td colSpan={4} className="px-4 py-1.5 text-[12.5px] font-bold">{team || "(팀 없음)"} <span className="font-normal text-ink-3">{ms.length}명</span></td>
                    </tr>
                    {ms.map((r) => (
                      <tr key={r.id} className={cx("border-b border-line last:border-b-0", r.status === data.left && "opacity-55")}>
                        <td className="px-4 py-2 font-semibold">{r.name || "-"}{r.memo && <div className="text-[11.5px] font-normal text-ink-3">{r.memo}</div>}</td>
                        <td className="px-3 py-2 font-mono text-[12.5px]">{r.email}</td>
                        <td className={cx("px-3 py-2 text-center text-[12.5px]", r.status === data.left && "text-err")}>{r.status}</td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="sm" onClick={() => setEdit({ ...r })}>수정</Button>
                            <Button variant="ghost" size="sm" className="text-err hover:bg-err-soft hover:text-err" onClick={() => setDel(r)}>삭제</Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>맞는 인원이 없습니다</Empty>}
      </Section>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "인원 수정" : "인원 추가"}
             footer={<>
               <Button variant="ghost" onClick={() => setEdit(null)}>취소</Button>
               <Button busy={busy === "save"} onClick={() => run("save", async () => {
                 const r = await send("/api/admin/staff", edit);
                 setEdit(null); reload(); return r;
               })}>저장</Button>
             </>}>
        {edit && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="이름"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="팀"><Input value={edit.team} onChange={(e) => setEdit({ ...edit, team: e.target.value })} /></Field>
            </div>
            <Field label="메일 주소"><Input value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label="상태"><Select value={edit.status} onChange={(v) => setEdit({ ...edit, status: v })} options={data.statuses.map((s) => ({ value: s, label: s }))} /></Field>
            <Field label="메모"><Input value={edit.memo} onChange={(e) => setEdit({ ...edit, memo: e.target.value })} /></Field>
          </div>
        )}
      </Modal>

      <Confirm open={!!del} onClose={() => setDel(null)} title="명부에서 삭제" confirmText="삭제" danger
               onConfirm={async () => { await run("del", () => send(`/api/admin/staff/${del!.id}`, undefined, "DELETE")); reload(); }}>
        <div>{del?.name || "(이름 없음)"} · {del?.email}</div>
      </Confirm>
    </>
  );
}
