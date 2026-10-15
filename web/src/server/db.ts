/**
 * DB 접속 — PostgreSQL(로컬 · Supabase 공용). 표는 모두 sb 스키마에 있다(db/schema.sql).
 *
 * **SQL 에는 표 이름을 늘 `sb.` 을 붙여 쓴다.** Supabase 의 연결 풀러(transaction 모드)는 접속 때
 * 준 search_path 를 이어 주지 않아서, 스키마를 생략하면 public 에서 찾는다.
 * 같은 까닭으로 prepared statement 를 끈다(prepare: false).
 *
 * 서버리스 함수 한 개가 연결을 잔뜩 붙잡지 않게 max 를 작게 둔다. 개발 서버는 고칠 때마다 모듈을
 * 다시 읽어 연결이 새므로 globalThis 에 하나만 둔다.
 */
import postgres from "postgres";

declare global {
  var __sbSql: postgres.Sql | undefined;
}

function connect(): postgres.Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL 이 없습니다 (.env.local 또는 배포 환경변수)");
  return postgres(url, {
    prepare: false,
    max: Number(process.env.DB_POOL_MAX || 5),
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
    // count(*) · bigserial 이 문자열로 오지 않게 — 이 앱의 수는 모두 안전한 정수 범위다.
    types: {
      bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
    },
  });
}

/** sql`...` — 지연 연결. import 만으로는 DB 에 붙지 않는다(빌드 때 DATABASE_URL 이 없어도 된다). */
export const sql: postgres.Sql = new Proxy((() => {}) as unknown as postgres.Sql, {
  get(_t, prop) {
    globalThis.__sbSql ??= connect();
    const v = Reflect.get(globalThis.__sbSql, prop);
    return typeof v === "function" ? v.bind(globalThis.__sbSql) : v;
  },
  apply(_t, _this, args) {
    globalThis.__sbSql ??= connect();
    return Reflect.apply(globalThis.__sbSql as unknown as (...a: unknown[]) => unknown, undefined, args);
  },
});

export type Tx = postgres.TransactionSql;
