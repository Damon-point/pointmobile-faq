/** /api/admin/* 공용 — 메일 서버 · 웹 로그인 대상(값은 tw-next 와 같다). */
import { credentialUserId } from "@/server/creds";

/** 메일 서버 — 발송(SMTP) 호스트도 여기서 정한다(mailer.smtpHostFor). */
export const MAIL_SERVER = process.env.MAIL_SERVER || "mail.pointmobile.com";

/** 웹 로그인 대상 — SB 가 쓰는 것. */
export const WEB_FIXED: Record<string, { label: string; base_url: string }> = {
  redmine: { label: "Redmine (사내 이슈)", base_url: "https://issue.pointmobile.co.kr" },
};

export const sharedUid = credentialUserId;
