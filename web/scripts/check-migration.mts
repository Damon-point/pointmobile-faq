/** 이관 확인 — 자격증명이 새 Fernet 구현으로 풀리는가, 시각이 맞는가, 상태 분포. 값은 출력하지 않는다. */
import postgres from "postgres";
import { decryptSecret, encryptSecret } from "../src/server/crypto.ts";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, onnotice: () => {}, max: 1 });
const creds = await sql`SELECT 'web:' || target AS what, encrypted_password AS t FROM sb.web_credentials
                        UNION ALL SELECT 'mail:' || email_address, encrypted_password FROM sb.mail_credentials`;
for (const c of creds) {
  try {
    const p = decryptSecret(c.t);
    console.log(`복호화 OK  ${c.what.split("@")[0]}  (길이 ${p.length})`);
  } catch (e) {
    console.log(`복호화 실패 ${c.what}: ${(e as Error).message}`);
  }
}
const rt = decryptSecret(encryptSecret("왕복 시험"));
console.log("암호화→복호화 왕복:", rt === "왕복 시험" ? "OK" : "실패");
const [t] = await sql`SELECT max(synced_at) AS synced, now() AS now FROM sb.rm_issues`;
console.log("최근 수집(UTC):", t.synced.toISOString(), " 지금(UTC):", t.now.toISOString());
console.log("SB 상태:", (await sql`SELECT state, count(*)::int n FROM sb.rm_sb_docs GROUP BY state ORDER BY n DESC`)
  .map((r) => `${r.state} ${r.n}`).join(", "));
await sql.end();
