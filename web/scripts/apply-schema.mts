/**
 * db/schema.sql 을 DATABASE_URL 의 DB 에 적용한다(몇 번을 돌려도 된다).
 *   npm run db:schema                 (.env.local 을 읽는다)
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL 이 없습니다");
const sql = postgres(url, { prepare: false, onnotice: () => {} });
const ddl = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
await sql.unsafe(ddl);
const [r] = await sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'sb'`;
console.log(`sb 스키마 표 ${r.n}개`);
await sql.end();
