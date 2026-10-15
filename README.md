# Solution Buffer (pointmobile-faq)

Redmine salesissue 를 수집하고, Resolved 된 이슈를 고객용 문서(SB) 초안으로 만들어 담당자가 검토 · 확정하는 앱.
tw-next(3080)의 Solution Buffer 메뉴를 떼어 낸 독립 프로젝트다. 확정된 문서는 DB(`issuetrack.rm_sb_docs`, state=`approved`)에 남는다.

| | 위치 | 주소 |
|---|---|---|
| 화면 | `web/` — Next.js 15 · React 19 · Tailwind 4 | `http://192.168.121.35:3070` (0.0.0.0) |
| API | `api/` — FastAPI | `127.0.0.1:8170` (이 PC 안에서만) |
| 업무 코드 | `backend/app/` — 이슈 수집 · SB 문서 · 메일 발송 | |
| DB | 로컬 PostgreSQL 17 `127.0.0.1:5432` · DB `sbnext` · 계정 `sbn` | 스키마 `public` · `issuetrack` · `usage` |

## 띄우기

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start.ps1
```

PostgreSQL 이 꺼져 있으면 먼저 켠다(서비스가 아니다 — 프로그램 `C:\Users\POINTMOBILE\pgsql`, 데이터 `C:\Users\POINTMOBILE\pgdata\twnext`, tw-next 와 같은 서버).
화면을 고친 뒤에는 `web\.next` 를 지우고 다시 띄우면 빌드부터 한다.

## 화면

- `/` SB 문서 — 내 담당 문서(관리자는 전체). 편집 · 검토 요청 · 확정 · 폐기
- `/issues` 이슈 — Redmine 이슈 목록 · 타임라인
- `/stats` 통계
- `/usage` Claude 사용량
- `/settings` 검증 모드 · Redmine · 메일 발송 · Claude · SB 동작 · 계정 · 사내 인원 · 메일 문구 · 비밀번호

## 검증 모드

`TWN_LIVE_WRITES=0`(기본)이면 메일을 보내지 않고 `backend/work/shadow_writes.jsonl` 에 기록만 한다
(`app/shadow.py` — `user_mailer.send_as_user` 에서 막는다).
운영 전환은 관리자가 [설정 → 검증 모드 · 운영 전환] 에서 한다. tw-next · tw-automation 과 같은 메일 계정을 쓰므로,
한쪽만 실제로 쓰게 둬야 같은 메일이 두 번 나가지 않는다.

## 설정 파일(git 에 올리지 않는다)

- `.env` — `SBN_SECRET`(세션 쿠키 서명)
- `backend/.env` — `FERNET_KEY`(자격증명 암호화 — tw-next 와 같은 값이어야 옮겨 온 자격증명이 풀린다) · `ANTHROPIC_API_KEY` ·
  `TW_MAIL_*`(발송 계정) · `TW_APP_URL` · `TWN_LIVE_WRITES` · `TWN_PG_URL`

## 데이터

처음 한 번(2026-10-14) tw-next DB 에서 계정 · 메일 발송 계정 · Redmine 자격증명 · 사내 인원 · 메일 문구 · 이슈/SB 문서를
복사했다. 그 뒤로 두 앱의 데이터는 따로 쌓인다(복사 도구는 2026-10-15 정리 때 지웠다 — git 이력에 있다).

2026-10-15 Confluence 업로드를 없앴다. 예전에 '업로드 완료'였던 문서는 기동 때 '확정'(approved)으로 바뀐다.
`rm_sb_docs` 의 옛 컬럼(template_id · labels_json · confluence_page_id · confluence_url · uploaded_at)과
`web_credentials` 의 Confluence 행(target=`release_notes`)은 값이 남아 있어 지우지 않았다 — 앱은 읽지 않는다.

## tw-next 에서 가져온 것

`backend/app` 은 tw-next `97332bb` 의 `issuetrack/` 와 그것이 쓰는 공용 모듈(DB · 자격증명 · 메일 발송 · Claude 호출 ·
검증 모드 · 사용량 · 인원 명부 · 메일 문구)만 옮긴 것이다. 메일 수신 · OS Update · WhiteList · License 는 없고,
그것들만 쓰던 코드(메일 인용 · 첨부 · FOTA/WhiteList 인원 역할 · 그림 첨부 Claude 호출 등)도 2026-10-15 에 걷어 냈다.
`app/sb_tick.py` 는 tw-next `app/background.py` 의 `redmine_poll_once` · `sb_tick_once` 를 그대로 옮겼다.
