-- Solution Buffer DB 스키마 — PostgreSQL(로컬 · Supabase 공용).
--
-- 모든 표는 sb 스키마에 둔다. Supabase 의 Data API(PostgREST)는 기본으로 public 만 내보내므로,
-- sb 에 두면 anon 키로 표가 열리지 않는다. 앱은 서버(Next.js Route Handler)에서 DATABASE_URL 로만 붙는다.
-- 시각은 모두 timestamptz(UTC 로 저장, 화면에서 KST 로 바꾼다).
--
--   psql "$DATABASE_URL" -f db/schema.sql        -- 몇 번을 돌려도 된다(IF NOT EXISTS)

CREATE SCHEMA IF NOT EXISTS sb;
SET search_path TO sb;

-- ── 계정 · 설정 ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id                   serial PRIMARY KEY,
  username             varchar(80)  NOT NULL UNIQUE,
  password_hash        varchar(200) NOT NULL,                 -- bcrypt
  role                 varchar(20)  NOT NULL DEFAULT 'user',  -- admin | user
  must_change_password boolean      NOT NULL DEFAULT false,
  created_at           timestamptz  NOT NULL DEFAULT now(),
  status               varchar(20)  NOT NULL DEFAULT 'approved', -- pending | approved | rejected
  company              varchar(120) NOT NULL DEFAULT '',
  email                varchar(200) NOT NULL DEFAULT '',
  requested_at         timestamptz,
  decided_by           varchar(80)  NOT NULL DEFAULT '',
  decided_at           timestamptz,
  reject_reason        text         NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_users_status ON users (status);
CREATE INDEX IF NOT EXISTS ix_users_email  ON users (email);

-- 메일 발송 계정. 비밀번호는 Fernet 으로 암호화(FERNET_KEY).
CREATE TABLE IF NOT EXISTS mail_credentials (
  id                 serial PRIMARY KEY,
  user_id            integer      NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  email_address      varchar(200) NOT NULL,
  encrypted_password text         NOT NULL DEFAULT '',
  pop_server         varchar(200) NOT NULL DEFAULT 'mail.pointmobile.com',  -- SMTP 호스트를 여기서 정한다
  signature_html     text         NOT NULL DEFAULT '',
  updated_at         timestamptz  NOT NULL DEFAULT now()
);

-- 웹 서비스 로그인(지금은 Redmine 하나, 공용 — admin 계정 행). 비밀번호는 Fernet 암호화.
CREATE TABLE IF NOT EXISTS web_credentials (
  id                 serial PRIMARY KEY,
  user_id            integer      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target             varchar(30)  NOT NULL,
  base_url           varchar(500) NOT NULL DEFAULT '',
  username           varchar(200) NOT NULL DEFAULT '',
  encrypted_password text         NOT NULL DEFAULT '',
  updated_at         timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT uq_web_user_target UNIQUE (user_id, target)
);

-- 사내 인원 명부 — 메일 받는 사람의 이름 · 팀.
CREATE TABLE IF NOT EXISTS staff (
  id         serial PRIMARY KEY,
  name       varchar(80)  NOT NULL DEFAULT '',
  email      varchar(200) NOT NULL DEFAULT '' UNIQUE,
  status     varchar(20)  NOT NULL DEFAULT '재직',  -- 재직 · 퇴사
  team       varchar(80)  NOT NULL DEFAULT '',
  memo       text         NOT NULL DEFAULT '',
  updated_by varchar(80)  NOT NULL DEFAULT ''
);

-- 메일 문구 — 화면에서 고친 것만 행으로 남는다(없으면 코드 기본값).
CREATE TABLE IF NOT EXISTS mail_templates (
  id         serial PRIMARY KEY,
  key        varchar(60) NOT NULL UNIQUE,
  subject    text        NOT NULL DEFAULT '',
  body       text        NOT NULL DEFAULT '',
  updated_by varchar(80) NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 화면에서 바꾸는 한 줄짜리 설정(검증 모드 등).
CREATE TABLE IF NOT EXISTS app_settings (
  key        varchar(60) PRIMARY KEY,
  value      text        NOT NULL DEFAULT '',
  updated_by varchar(80) NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 회원가입 이메일 인증 — 주소마다 한 줄, 인증번호 · 확인 토큰은 해시만.
CREATE TABLE IF NOT EXISTS signup_email_codes (
  email        varchar(200) PRIMARY KEY,
  code_hash    varchar(128) NOT NULL DEFAULT '',
  expires_at   timestamptz,
  attempts     integer      NOT NULL DEFAULT 0,
  sent_at      timestamptz,
  sent_count   integer      NOT NULL DEFAULT 0,
  window_start timestamptz,
  verified_at  timestamptz,
  token_hash   varchar(128) NOT NULL DEFAULT ''
);

-- 검증 모드에서 막은 쓰기(보내려던 메일 등). 예전에는 work/shadow_writes.jsonl 파일이었다.
CREATE TABLE IF NOT EXISTS shadow_writes (
  id     bigserial PRIMARY KEY,
  at     timestamptz NOT NULL DEFAULT now(),
  system varchar(40) NOT NULL,
  action varchar(80) NOT NULL,
  detail jsonb       NOT NULL DEFAULT '{}'::jsonb
);

-- Claude 호출 사용량 · 비용(추정).
CREATE TABLE IF NOT EXISTS token_usage (
  id            bigserial PRIMARY KEY,
  ts            timestamptz NOT NULL DEFAULT now(),
  day           text        NOT NULL,   -- KST 'YYYY-MM-DD'
  month         text        NOT NULL,   -- KST 'YYYY-MM'
  model         text        NOT NULL DEFAULT '?',
  operation     text        NOT NULL DEFAULT '기타',
  input_tokens  integer     NOT NULL DEFAULT 0,
  output_tokens integer     NOT NULL DEFAULT 0,
  cache_read    integer     NOT NULL DEFAULT 0,
  cache_write   integer     NOT NULL DEFAULT 0,
  cost_usd      double precision NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_token_usage_day   ON token_usage (day);
CREATE INDEX IF NOT EXISTS ix_token_usage_month ON token_usage (month);

-- 여러 인스턴스(서버리스)가 같은 작업을 겹쳐 돌리지 않게 하는 잠금 — 이름 · 만료 시각.
CREATE TABLE IF NOT EXISTS job_locks (
  name       varchar(60) PRIMARY KEY,
  holder     varchar(80) NOT NULL DEFAULT '',
  expires_at timestamptz NOT NULL
);

-- ── Redmine 이슈 · SB 문서 ──────────────────────────────────────────────────

-- Redmine 이슈 1건의 현재 스냅샷. id 는 Redmine 이슈 번호.
CREATE TABLE IF NOT EXISTS rm_issues (
  id                       integer PRIMARY KEY,
  project_id               integer,
  project_name             varchar(120),
  tracker                  varchar(60),
  status                   varchar(60),
  status_id                integer,
  priority                 varchar(60),
  priority_id              integer,
  category                 varchar(120),
  author_id                integer,
  author_name              varchar(120),
  assigned_to_id           integer,
  assigned_to_name         varchar(120),
  subject                  varchar(500) NOT NULL DEFAULT '',
  description              text,
  done_ratio               integer,
  start_date               varchar(20),
  due_date                 varchar(20),
  created_on               timestamptz,
  updated_on               timestamptz,
  closed_on                timestamptz,                       -- 믿을 수 없어 통계에 쓰지 않는다
  custom_fields_json       text,
  excluded                 boolean NOT NULL DEFAULT false,    -- 제외 키워드에 걸린 이슈(지우지 않고 표시)
  excluded_reason          varchar(120),
  is_test                  boolean NOT NULL DEFAULT false,    -- [Test] 이슈 — 통계에서만 뺀다
  detail_fetched           boolean NOT NULL DEFAULT false,    -- journals 까지 받았는가
  detail_synced_updated_on timestamptz,                       -- 그때의 updated_on(다르면 다시 받는다)
  synced_at                timestamptz
);
CREATE INDEX IF NOT EXISTS ix_rm_issues_status     ON rm_issues (status);
CREATE INDEX IF NOT EXISTS ix_rm_issues_assigned   ON rm_issues (assigned_to_name);
CREATE INDEX IF NOT EXISTS ix_rm_issues_created    ON rm_issues (created_on);
CREATE INDEX IF NOT EXISTS ix_rm_issues_updated    ON rm_issues (updated_on);
CREATE INDEX IF NOT EXISTS ix_rm_issues_excluded   ON rm_issues (excluded);
CREATE INDEX IF NOT EXISTS ix_rm_issues_is_test    ON rm_issues (is_test);
CREATE INDEX IF NOT EXISTS ix_rm_issues_detail     ON rm_issues (detail_fetched);

-- 이슈에서 일어난 이벤트 1건(코멘트 + 그때 바뀐 속성들). id 는 Redmine journal 번호.
CREATE TABLE IF NOT EXISTS rm_journals (
  id            integer PRIMARY KEY,
  issue_id      integer NOT NULL REFERENCES rm_issues(id) ON DELETE CASCADE,
  user_id       integer,
  user_name     varchar(120),
  created_on    timestamptz,
  notes         text,
  private_notes boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS ix_rm_journals_issue   ON rm_journals (issue_id);
CREATE INDEX IF NOT EXISTS ix_rm_journals_user    ON rm_journals (user_name);
CREATE INDEX IF NOT EXISTS ix_rm_journals_created ON rm_journals (created_on);

CREATE TABLE IF NOT EXISTS rm_journal_details (
  id         serial PRIMARY KEY,
  journal_id integer NOT NULL REFERENCES rm_journals(id) ON DELETE CASCADE,
  seq        integer NOT NULL DEFAULT 0,
  property   varchar(40),
  name       varchar(80),
  old_value  text,
  new_value  text,
  CONSTRAINT uq_rm_jd_journal_seq UNIQUE (journal_id, seq)
);
CREATE INDEX IF NOT EXISTS ix_rm_jd_journal ON rm_journal_details (journal_id);
CREATE INDEX IF NOT EXISTS ix_rm_jd_name    ON rm_journal_details (name);

-- 첨부 메타데이터(파일 내용은 받지 않는다).
CREATE TABLE IF NOT EXISTS rm_attachments (
  id           integer PRIMARY KEY,
  issue_id     integer NOT NULL REFERENCES rm_issues(id) ON DELETE CASCADE,
  filename     varchar(300),
  filesize     integer,
  content_type varchar(120),
  author_name  varchar(120),
  created_on   timestamptz
);
CREATE INDEX IF NOT EXISTS ix_rm_attachments_issue ON rm_attachments (issue_id);

-- 숫자 id → 표시 이름(journal detail 이 id 만 주기 때문).
CREATE TABLE IF NOT EXISTS rm_lookups (
  id     serial PRIMARY KEY,
  kind   varchar(30)  NOT NULL,   -- status | priority | tracker | user | category | cf
  ref_id integer      NOT NULL,
  name   varchar(200) NOT NULL,
  CONSTRAINT uq_rm_lookup UNIQUE (kind, ref_id)
);
CREATE INDEX IF NOT EXISTS ix_rm_lookups_kind ON rm_lookups (kind);

-- 이슈 하나에서 만든 SB 문서 1건. 재해결되면 revision+1 로 새 행(이전 행은 superseded).
--   backlog · not_needed · not_target · queued · draft · notified · approved(확정) · discarded · error
CREATE TABLE IF NOT EXISTS rm_sb_docs (
  id                 serial PRIMARY KEY,
  issue_id           integer NOT NULL REFERENCES rm_issues(id) ON DELETE CASCADE,
  revision           integer NOT NULL DEFAULT 1,
  superseded         boolean NOT NULL DEFAULT false,
  state              varchar(20) NOT NULL DEFAULT 'backlog',
  origin             varchar(20) NOT NULL DEFAULT 'backlog',  -- auto | backlog
  source_resolved_at timestamptz,
  title              varchar(400) NOT NULL DEFAULT '',
  is_troubleshooting boolean NOT NULL DEFAULT false,
  disclosure         varchar(20) NOT NULL DEFAULT 'internal', -- internal | public | partner | ascp
  disclosure_reason  text,
  applies_to         text,
  description_html   text,
  partners_json      text,
  assignee_name      varchar(120),
  assignee_email     varchar(200),
  model              varchar(60),
  input_tokens       integer NOT NULL DEFAULT 0,
  output_tokens      integer NOT NULL DEFAULT 0,
  error              text,
  generating_since   timestamptz,   -- Claude 로 만드는 중이면 시작 시각(예전에는 프로세스 메모리에 있었다)
  created_at         timestamptz,
  generated_at       timestamptz,
  notified_at        timestamptz,
  decided_at         timestamptz,
  decided_by         varchar(120),
  CONSTRAINT uq_rm_sb_issue_rev UNIQUE (issue_id, revision)
);
CREATE INDEX IF NOT EXISTS ix_rm_sb_docs_issue      ON rm_sb_docs (issue_id);
CREATE INDEX IF NOT EXISTS ix_rm_sb_docs_state      ON rm_sb_docs (state);
CREATE INDEX IF NOT EXISTS ix_rm_sb_docs_superseded ON rm_sb_docs (superseded);
CREATE INDEX IF NOT EXISTS ix_rm_sb_docs_origin     ON rm_sb_docs (origin);
CREATE INDEX IF NOT EXISTS ix_rm_sb_docs_disclosure ON rm_sb_docs (disclosure);

-- 수집 진행 상황 · SB 설정 등 key/value.
CREATE TABLE IF NOT EXISTS rm_sync_state (
  key        varchar(60) PRIMARY KEY,
  value      text,
  updated_at timestamptz
);
