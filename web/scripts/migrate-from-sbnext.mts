/**
 * 예전 FastAPI 앱의 DB(sbnext — public · issuetrack · usage 스키마)를 새 sb 스키마로 옮긴다.
 *
 *   SOURCE_DATABASE_URL=postgresql://…/sbnext  npm run db:migrate            # 건수만 본다
 *   SOURCE_DATABASE_URL=postgresql://…/sbnext  npm run db:migrate -- --load  # 대상 sb 표를 비우고 채운다
 *
 * 대상은 DATABASE_URL(로컬이든 Supabase 든). 원본은 읽기만 한다(읽기 전용 트랜잭션).
 * - 옛 시각 칸은 시간대 없는 timestamp 에 UTC 로 들어 있다 → AT TIME ZONE 'UTC' 로 timestamptz 로 바꾼다.
 * - Confluence 를 없애며 뺀 칸(template_id · labels_json · confluence_* · uploaded_at 등)은 옮기지 않는다.
 *   '업로드 완료'(uploaded) 문서는 '확정'(approved)으로 옮긴다.
 * - web_credentials 는 Redmine 행만 옮긴다(Confluence 행은 버린다).
 * - 비밀번호 해시(bcrypt) · 암호화된 자격증명(Fernet)은 그대로 옮긴다 — 같은 FERNET_KEY 를 써야 풀린다.
 */
import postgres from "postgres";

const SRC = process.env.SOURCE_DATABASE_URL;
const DST = process.env.DATABASE_URL;
if (!SRC || !DST) throw new Error("SOURCE_DATABASE_URL 과 DATABASE_URL 이 모두 필요합니다");
const LOAD = process.argv.includes("--load");

const src = postgres(SRC, { prepare: false, onnotice: () => {}, max: 1 });
const dst = postgres(DST, { prepare: false, onnotice: () => {}, max: 1 });

const utc = (c: string) => `(${c} AT TIME ZONE 'UTC') AS ${c}`;

type Plan = { target: string; from: string; select: string; where?: string };

// 부모 표부터. select 의 칸 이름이 곧 대상 표의 칸 이름이다.
const PLAN: Plan[] = [
  {
    target: "users", from: "public.users",
    select: ["id", "username", "password_hash", "role", "must_change_password", utc("created_at"), "status", "company",
             "email", utc("requested_at"), "decided_by", utc("decided_at"), "reject_reason"].join(", "),
  },
  {
    target: "mail_credentials", from: "public.mail_credentials",
    select: ["id", "user_id", "email_address", "encrypted_password", "pop_server", "COALESCE(signature_html, '') AS signature_html",
             utc("updated_at")].join(", "),
  },
  {
    target: "web_credentials", from: "public.web_credentials",
    select: ["id", "user_id", "target", "base_url", "username", "encrypted_password", utc("updated_at")].join(", "),
    where: "target = 'redmine'",
  },
  { target: "staff", from: "public.staff", select: "id, name, email, status, team, memo, updated_by" },
  { target: "mail_templates", from: "public.mail_templates", select: `id, key, subject, body, updated_by, ${utc("updated_at")}` },
  {
    target: "app_settings", from: "public.app_settings", select: `key, value, updated_by, ${utc("updated_at")}`,
    where: "key = 'live_writes'",   // claude_backend(구독/API 선택)은 이제 없다
  },
  {
    target: "rm_issues", from: "issuetrack.rm_issues",
    select: ["id", "project_id", "project_name", "tracker", "status", "status_id", "priority", "priority_id", "category",
             "author_id", "author_name", "assigned_to_id", "assigned_to_name", "subject", "description", "done_ratio",
             "start_date", "due_date", utc("created_on"), utc("updated_on"), utc("closed_on"), "custom_fields_json",
             "excluded", "excluded_reason", "COALESCE(is_test, false) AS is_test", "detail_fetched",
             utc("detail_synced_updated_on"), utc("synced_at")].join(", "),
  },
  {
    target: "rm_journals", from: "issuetrack.rm_journals",
    select: `id, issue_id, user_id, user_name, ${utc("created_on")}, notes, private_notes`,
  },
  { target: "rm_journal_details", from: "issuetrack.rm_journal_details", select: "id, journal_id, seq, property, name, old_value, new_value" },
  {
    target: "rm_attachments", from: "issuetrack.rm_attachments",
    select: `id, issue_id, filename, filesize, content_type, author_name, ${utc("created_on")}`,
  },
  { target: "rm_lookups", from: "issuetrack.rm_lookups", select: "id, kind, ref_id, name" },
  {
    target: "rm_sb_docs", from: "issuetrack.rm_sb_docs",
    select: ["id", "issue_id", "revision", "superseded",
             "CASE WHEN state = 'uploaded' THEN 'approved' ELSE state END AS state",
             "COALESCE(origin, 'backlog') AS origin", utc("source_resolved_at"), "title", "is_troubleshooting", "disclosure",
             "disclosure_reason", "applies_to", "description_html", "partners_json", "assignee_name", "assignee_email",
             "model", "input_tokens", "output_tokens", "error", utc("created_at"), utc("generated_at"), utc("notified_at"),
             "COALESCE(decided_at, uploaded_at) AT TIME ZONE 'UTC' AS decided_at", "decided_by"].join(", "),
  },
  { target: "rm_sync_state", from: "issuetrack.rm_sync_state", select: `key, value, ${utc("updated_at")}` },
  {
    // 옛 ts 는 KST 로 찍은 글자다.
    target: "token_usage", from: "usage.token_usage",
    select: "id, (ts::timestamp AT TIME ZONE 'Asia/Seoul') AS ts, day, month, COALESCE(model, '?') AS model, "
          + "COALESCE(operation, '기타') AS operation, COALESCE(input_tokens, 0) AS input_tokens, "
          + "COALESCE(output_tokens, 0) AS output_tokens, COALESCE(cache_read, 0) AS cache_read, "
          + "COALESCE(cache_write, 0) AS cache_write, COALESCE(cost_usd, 0) AS cost_usd",
  },
];

// serial/bigserial 칸이 있는 표 — 옮긴 뒤 다음 번호를 맞춘다.
const SERIAL = ["users", "mail_credentials", "web_credentials", "staff", "mail_templates", "rm_journal_details",
                "rm_lookups", "rm_sb_docs", "token_usage"];
const BATCH = 1000;

const counts: Record<string, number> = {};
await src.begin("READ ONLY", async (s) => {
  if (LOAD) {
    const names = PLAN.map((p) => `sb.${p.target}`).join(", ");
    await dst.unsafe(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
  }
  for (const p of PLAN) {
    const rows = await s.unsafe(`SELECT ${p.select} FROM ${p.from}${p.where ? ` WHERE ${p.where}` : ""} ORDER BY 1`);
    counts[p.target] = rows.length;
    if (!LOAD || !rows.length) continue;
    const cols = Object.keys(rows[0]);
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH) as unknown as Record<string, unknown>[];
      await dst`INSERT INTO ${dst(`sb.${p.target}`)} ${dst(chunk, cols)}`;
    }
  }
});

if (LOAD) {
  for (const t of SERIAL) {
    await dst.unsafe(
      `SELECT setval(pg_get_serial_sequence('sb.${t}', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM sb.${t}), 1), `
      + `(SELECT COUNT(*) > 0 FROM sb.${t}))`);
  }
}

console.log(LOAD ? "옮겼습니다:" : "옮길 건수(--load 로 실제로 옮긴다):");
for (const [t, n] of Object.entries(counts)) console.log(`  ${t.padEnd(20)} ${n}`);
await src.end();
await dst.end();
