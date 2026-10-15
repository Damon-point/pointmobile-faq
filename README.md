# Solution Buffer (pointmobile-faq)

Redmine salesissue 를 수집하고, Resolved 된 이슈를 고객용 문서(SB) 초안으로 만들어 담당자가 검토 · 확정하는 앱.
확정된 문서는 DB(`sb.rm_sb_docs`, state=`approved`)에 남는다.

**Next.js 하나로 된 앱이다** — 화면과 API(`web/src/app/api/**/route.ts`)가 한 프로젝트에 있고 따로 띄우는 백엔드가 없다.
웹(Vercel) + Supabase(PostgreSQL)에 올리는 것을 전제로 짰다. 2026-10-15 에 FastAPI(Python) 백엔드를 옮겨 왔다.

| | 위치 |
|---|---|
| 화면 | `web/src/app/(main)` · `login` · `signup` — Next.js 15 · React 19 · Tailwind 4 |
| API | `web/src/app/api/**/route.ts` — 예전 FastAPI 와 주소 · 요청 · 응답 모양이 같다 |
| 서버 로직 | `web/src/server/` — DB · 세션 · 메일 · Claude · 검증 모드, `server/issuetrack/` — Redmine 수집 · SB 문서 · 통계 |
| DB | PostgreSQL 의 `sb` 스키마 — `web/db/schema.sql` |
| 주기 작업 | `GET /api/cron/tick` — 5분마다 Redmine 수집 → SB 초안 → 검토 요청 메일(`web/vercel.json`) |

## 웹에 올리기(Vercel + Supabase)

1. **Supabase** 프로젝트를 만들고 스키마를 넣는다.
   `web/.env.local` 의 `DATABASE_URL` 을 Supabase 의 **Transaction pooler**(포트 6543) 주소로 두고 `npm run db:schema`.
   표는 `sb` 스키마에 있어 Supabase Data API(anon 키)로는 열리지 않는다 — 앱은 서버에서 `DATABASE_URL` 로만 붙는다.
2. **데이터 옮기기**(한 번): `SOURCE_DATABASE_URL`(예전 sbnext) 을 넣고 `npm run db:migrate` 로 건수를 본 뒤
   `npm run db:migrate -- --load`. 대상 `sb` 표를 비우고 채운다. `npm run db:check` 로 자격증명이 풀리는지 확인한다.
3. **Vercel** 프로젝트를 만들고 Root Directory 를 `web` 으로, 환경변수는 `web/.env.example` 을 보고 넣는다.
   - `FERNET_KEY` 는 예전 앱과 **같은 값**이어야 옮겨 온 Redmine · 메일 비밀번호가 풀린다.
   - `CRON_SECRET` 을 넣으면 Vercel Cron 이 `Authorization: Bearer` 로 보낸다.
4. **주기 작업** — `web/vercel.json` 이 5분마다 `/api/cron/tick` 을 부른다. 5분 주기와 한 번 300초 실행은 Vercel Pro 가 필요하다
   (Hobby 는 cron 이 하루 1번). Pro 를 쓰지 않으면 Supabase Cron(pg_cron + pg_net)이나 다른 스케줄러가
   `Authorization: Bearer <CRON_SECRET>` 로 같은 주소를 5분마다 부르게 한다.
5. **Redmine 이 사외망에서 열리는지** 먼저 확인한다 — `issue.pointmobile.co.kr` 의 REST API(.json)에 Vercel 서버가 닿아야 수집된다.
   메일은 SMTP(`mail.pointmobile.com:587`, STARTTLS)로 보낸다.

## 이 PC 에서 띄우기

```powershell
cd web; npm install
# web\.env.local — web\.env.example 참고(DATABASE_URL 은 로컬 PostgreSQL 의 sbnext 를 써도 된다, 표는 sb 스키마)
powershell -ExecutionPolicy Bypass -File scripts\start.ps1     # 3070 + 5분 주기 작업
```

개발 중에는 `cd web; npm run dev`. 화면을 고친 뒤 `start.ps1` 로 띄울 때는 `web\.next` 를 지우면 다시 빌드한다.

## 화면

- `/` SB 문서 — 내 담당 문서(관리자는 전체). 편집 · 검토 요청 · 확정 · 폐기
- `/issues` 이슈 — Redmine 이슈 목록 · 타임라인
- `/stats` 통계(업무일 기준 — 주말 · 한국 공휴일 제외, `server/issuetrack/krHolidays.ts`)
- `/usage` Claude 사용량
- `/settings` 검증 모드 · Redmine · 메일 발송 · Claude · SB 동작 · 계정 · 사내 인원 · 메일 문구 · 비밀번호

## Claude

API 키(`ANTHROPIC_API_KEY`)로 부른다. 기본 모델 `claude-opus-5-5`(`SB_MODEL`), 생각 깊이 `medium`(`SB_EFFORT`).
정책 거절에 대비해 서버 측 대체 모델(`fallbacks: "default"`)을 켰다. 호출마다 사용량 · 추정 비용을 `sb.token_usage` 에 남긴다.
예전 앱의 '구독(이 PC 의 Claude Code)' 경로는 웹 서버에 Claude Code 가 없어 없앴다.

## 검증 모드

`live_writes` 가 0(기본, `TWN_LIVE_WRITES`)이면 메일을 보내지 않고 `sb.shadow_writes` 에 기록만 한다(`server/shadow.ts`).
운영 전환은 관리자가 [설정 → 검증 모드 · 운영 전환] 에서 한다. tw-next · tw-automation 과 같은 메일 계정을 쓰므로,
한쪽만 실제로 쓰게 둬야 같은 메일이 두 번 나가지 않는다.

## 예전 앱에서 바뀐 것

- 서버리스라 프로세스 메모리에 두던 상태를 DB 로 옮겼다 — 초안 생성 중 표시(`rm_sb_docs.generating_since`),
  작업 잠금(`sb.job_locks`), 마지막 주기 작업 결과 · 수동 수집 결과(`rm_sync_state`), 검증 모드 기록(`sb.shadow_writes`).
- 시각은 모두 `timestamptz`(UTC 저장, 화면 · 메일은 KST).
- Confluence 업로드(2026-10-15)는 이미 없앴다. 예전 '업로드 완료' 문서는 이관 때 '확정'(approved)이 된다.
