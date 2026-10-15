import { hasKey, MODEL } from "@/server/claude";
import { sql } from "@/server/db";
import { route } from "@/server/http";
import { assigneesWithoutAccount } from "@/server/issuetrack/sb";
import { loadSbSettings } from "@/server/issuetrack/settings";
import { senderProfile, systemFrom, systemSenderUserId } from "@/server/mailer";
import { requireUser } from "@/server/session";
import { kstMinute } from "@/server/time";
import { sharedUid, WEB_FIXED } from "../_shared";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const u = await requireUser();
  const sid = await sharedUid();
  const relay = (process.env.TW_MAIL_ACCOUNT || "").trim();
  const [mine] = await sql<{ email_address: string; encrypted_password: string }[]>`
    SELECT email_address, encrypted_password FROM sb.mail_credentials WHERE user_id = ${u.id}`;
  const webs = new Map((await sql<{ target: string; username: string; encrypted_password: string; updated_at: Date }[]>`
    SELECT target, username, encrypted_password, updated_at FROM sb.web_credentials WHERE user_id = ${sid}`).map((w) => [w.target, w]));
  const relayOwner = !relay || (await systemSenderUserId()) === u.id;
  const [addr] = await senderProfile(u.id);
  const [fAddr, fName] = systemFrom();

  let missing: { name: string; count: number }[] = [];
  try {
    missing = await assigneesWithoutAccount();
  } catch {
    missing = [];
  }
  const cfg = await loadSbSettings();
  return {
    is_admin: u.role === "admin",
    sender: {
      relay_owner: relayOwner, relay: Boolean(relay), my_address: addr || "",
      system_from: fAddr || "", system_from_name: fName || "",
      email: mine?.email_address ?? "", has_password: Boolean(mine?.encrypted_password),
    },
    web: Object.entries(WEB_FIXED).map(([t, c]) => ({
      target: t, label: c.label, base_url: c.base_url,
      username: webs.get(t)?.username ?? "",
      has_password: Boolean(webs.get(t)?.encrypted_password),
      updated_at: kstMinute(webs.get(t)?.updated_at),
    })),
    claude: { backend: "api", claude: "", has_key: hasKey(), model: MODEL },
    sb: {
      sb_auto_notify: cfg.sb_auto_notify, sb_assignees: cfg.sb_assignees, exclude_keywords: cfg.exclude_keywords,
      sb_auto_generate: cfg.sb_auto_generate, sb_per_tick: cfg.sb_per_tick, missing_accounts: missing,
    },
  };
});
