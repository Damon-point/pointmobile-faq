/** 메일 발송 계정 라우트 공용 — 공용 발송 계정(TW_MAIL_ACCOUNT)을 쓰면 개인 등록이 필요 없다. */
import { HttpError } from "@/server/http";
import { systemSenderUserId } from "@/server/mailer";
import type { SessionUser } from "@/server/session";

export async function relayGuard(u: SessionUser): Promise<void> {
  const relay = (process.env.TW_MAIL_ACCOUNT || "").trim();
  if (relay && (await systemSenderUserId()) !== u.id) throw new HttpError(409, "공용 발송 계정을 쓰고 있어 등록할 것이 없습니다");
}
