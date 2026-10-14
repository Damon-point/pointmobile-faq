"use client";

import { useMemo, useState } from "react";
import { Button, Confirm, Modal, Section, Select, Textarea, useRunner } from "@/components/admin/kit";
import { Empty, Skeleton, cx } from "@/components/ui";
import { ago, useApi } from "@/lib/api";
import { send, type Account, type AccountStatus, type AccountsResp } from "@/lib/admin";

const ROLE_TONE: Record<string, string> = {
  admin: "bg-[#fde7da] text-[#b4441b] dark:bg-[#3a2014] dark:text-[#f3a37c]",
  user: "bg-muted-soft text-ink-2",
};
const STATUS_TONE: Record<AccountStatus, string> = {
  pending: "bg-warn-soft text-warn",
  approved: "bg-ok-soft text-ok",
  rejected: "bg-err-soft text-err",
};

type Filter = "all" | AccountStatus;

/** 계정 — 맨 위에 가입 승인 대기, 아래에 전체 계정(역할 · 비밀번호 초기화 · 삭제). */
export default function AccountsPage() {
  const { data, loading, reload } = useApi<AccountsResp>("/api/admin/accounts");
  const [reject, setReject] = useState<Account | null>(null);
  const [reason, setReason] = useState("");
  const [reset, setReset] = useState<Account | null>(null);
  const [del, setDel] = useState<Account | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const { busy, run } = useRunner();

  const pending = useMemo(() => (data?.users ?? []).filter((u) => u.status === "pending")
    .sort((a, b) => (a.requested_at < b.requested_at ? -1 : 1)), [data]);
  const others = useMemo(() => (data?.users ?? []).filter((u) => u.status !== "pending" && (filter === "all" || u.status === filter)), [data, filter]);

  if (loading || !data) return <Skeleton rows={5} />;
  if (!data.users.length) return <Section title="계정"><Empty>계정 목록은 관리자만 볼 수 있습니다</Empty></Section>;
  const roles = Object.entries(data.roles).map(([value, label]) => ({ value, label }));
  const count = (s: AccountStatus) => data.users.filter((u) => u.status === s).length;

  const approve = (u: Account) => run(`ok${u.id}`, async () => {
    const r = await send(`/api/admin/accounts/${u.id}/decide`, { approve: true });
    reload();
    return r;
  });

  return (
    <>
      <Section title={<span className="flex items-center gap-2">가입 승인 대기
        {pending.length > 0 && <span className="rounded-full bg-warn px-2 text-[12px] font-bold text-white">{pending.length}</span>}</span>}
               desc="승인하면 신청자가 로그인할 수 있고, 승인·반려 결과는 신청자 이메일로 안내됩니다.">
        {pending.length ? (
          <div className="divide-y divide-line">
            {pending.map((u) => (
              <div key={u.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[15px] font-bold">{u.company || "회사명 없음"}</span>
                    <span className="font-mono text-[13px] text-ink-2">{u.username}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[12.5px] text-ink-3">
                    {u.email} · 신청 {u.requested_at ? ago(u.requested_at) || u.requested_at.slice(0, 16).replace("T", " ") : "-"}
                    {u.reject_reason && <span> · 이전 반려 사유: {u.reject_reason}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="ghost" onClick={() => { setReason(""); setReject(u); }}>반려</Button>
                  <Button busy={busy === `ok${u.id}`} onClick={() => approve(u)}>승인</Button>
                </div>
              </div>
            ))}
          </div>
        ) : <p className="text-[13px] text-ink-3">기다리는 가입 신청이 없습니다.</p>}
      </Section>

      <Section title="계정"
               right={
                 <div className="flex rounded-lg border border-line bg-surface p-0.5 text-[12.5px] font-semibold">
                   {([["all", "전체", data.users.length - count("pending")], ["approved", "승인", count("approved")], ["rejected", "반려", count("rejected")]] as const).map(([k, label, n]) => (
                     <button key={k} onClick={() => setFilter(k)}
                             className={cx("rounded-md px-2.5 py-1", filter === k ? "bg-brand text-white" : "text-ink-2 hover:bg-surface-2")}>
                       {label} <span className={filter === k ? "text-white/80" : "text-ink-3"}>{n}</span>
                     </button>
                   ))}
                 </div>
               }
               desc={`앱이 보내는 메일은 ${data.system_from_name || "공용 계정"} <${data.system_from || "-"}> 로 나갑니다.`}>
        {others.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13.5px]">
              <thead>
                <tr className="border-b border-line text-left text-[11.5px] font-semibold text-ink-3">
                  <th className="py-2 pr-3">ID</th><th className="px-3 py-2">회사 · 이메일</th><th className="px-3 py-2">상태</th>
                  <th className="px-3 py-2">권한</th><th className="py-2 pl-3 text-right">관리</th>
                </tr>
              </thead>
              <tbody>
                {others.map((u) => (
                  <tr key={u.id} className="border-b border-line align-top last:border-b-0">
                    <td className="py-2.5 pr-3">
                      <div className="font-semibold">{u.username}{u.me && <span className="ml-1.5 text-[11.5px] font-normal text-ink-3">(나)</span>}</div>
                      {u.must_change && <div className="text-[11.5px] text-warn">비밀번호 변경 대기</div>}
                    </td>
                    <td className="px-3 py-2.5">
                      <div>{u.company || <span className="text-ink-3">—</span>}</div>
                      <div className={cx("text-[12.5px]", u.email ? "text-ink-3" : "text-err")}>{u.email || "이메일 없음"}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={cx("whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-bold", STATUS_TONE[u.status])}>{data.statuses[u.status] ?? u.status}</span>
                      {u.decided_by && <div className="mt-1 text-[11.5px] text-ink-3">{u.decided_by} · {u.decided_at.slice(0, 10)}</div>}
                      {u.status === "rejected" && u.reject_reason && <div className="mt-0.5 max-w-[220px] text-[11.5px] text-err">{u.reject_reason}</div>}
                    </td>
                    <td className="px-3 py-2.5">
                      {u.status === "approved" ? (
                        <div className="flex items-center gap-2">
                          <span className={cx("whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-bold", ROLE_TONE[u.role] ?? ROLE_TONE.user)}>{data.roles[u.role] ?? u.role}</span>
                          <Select value={u.role} options={roles} className="w-[120px] py-1 text-[13px]" disabled={busy === `role${u.id}` || u.me}
                                  onChange={(v) => run(`role${u.id}`, async () => { const r = await send(`/api/admin/accounts/${u.id}/role`, { role: v }); reload(); return r; })} />
                        </div>
                      ) : <span className="text-ink-3">—</span>}
                    </td>
                    <td className="py-2.5 pl-3">
                      <div className="flex justify-end gap-1">
                        {u.status === "approved" && <Button variant="ghost" size="sm" onClick={() => setReset(u)}>비밀번호 초기화</Button>}
                        <Button variant="ghost" size="sm" disabled={u.me} title={u.me ? "본인 계정은 지울 수 없습니다" : undefined}
                                className="text-err hover:bg-err-soft hover:text-err" onClick={() => setDel(u)}>삭제</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>해당하는 계정이 없습니다</Empty>}
      </Section>

      <Modal open={!!reject} onClose={() => setReject(null)} title={`'${reject?.username}' 가입 반려`}
             footer={<>
               <Button variant="ghost" onClick={() => setReject(null)}>취소</Button>
               <Button variant="danger" busy={busy === "reject"} disabled={!reason.trim()}
                       onClick={() => run("reject", async () => {
                         const r = await send(`/api/admin/accounts/${reject!.id}/decide`, { approve: false, reason: reason.trim() });
                         setReject(null); reload(); return r;
                       })}>반려</Button>
             </>}>
        <div className="space-y-3 text-[14px]">
          <p className="text-ink-2">{reject?.company} · {reject?.email}</p>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="반려 사유 — 신청자에게 메일로 전달됩니다" autoFocus />
        </div>
      </Modal>
      <Confirm open={!!reset} onClose={() => setReset(null)} title={`'${reset?.username}' 비밀번호 초기화`} confirmText="초기화"
               onConfirm={async () => { await run("reset", () => send(`/api/admin/accounts/${reset!.id}/reset-password`)); reload(); }}>
        초기 비밀번호({data.initial_password})로 돌아가고 다음 로그인에서 다시 정하게 됩니다. 계정 이메일({reset?.email || "없음"})로 안내 메일이 나갑니다.
      </Confirm>
      <Confirm open={!!del} onClose={() => setDel(null)} title={`'${del?.username}' 계정 삭제`} confirmText="삭제" danger
               onConfirm={async () => { await run("del", () => send(`/api/admin/accounts/${del!.id}`, undefined, "DELETE")); reload(); }}>
        계정과 그 계정의 자격증명이 지워집니다. SB 문서 · 이슈는 계정에 묶여 있지 않아 그대로 남습니다.
      </Confirm>
    </>
  );
}
