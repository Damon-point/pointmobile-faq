"""DB 연결 / 세션 헬퍼 — public 스키마(계정 · 자격증명 · 인원 · 메일 문구 · 설정).

로컬 PostgreSQL(app.dbconf, DB sbnext)을 쓴다. TWN_PG_URL 이 없으면 프로젝트 루트의 sb_app.db(SQLite).
이슈 · SB 문서는 issuetrack 스키마(app/issuetrack/db.py), Claude 사용량은 usage 스키마(app/usage.py).
"""
from pathlib import Path

from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.dbconf import make_engine

# 프로젝트 루트 (app/ 의 부모)
BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "sb_app.db"

engine = make_engine("public", DB_PATH)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


# 나중에 붙은 칸 — create_all 은 이미 있는 표에 칸을 더하지 않는다. (표, 칸, PostgreSQL 타입·기본값)
_ADDED_COLUMNS: list[tuple[str, str, str]] = [
    ("users", "status", "VARCHAR(20) NOT NULL DEFAULT 'approved'"),
    ("users", "company", "VARCHAR(120) NOT NULL DEFAULT ''"),
    ("users", "email", "VARCHAR(200) NOT NULL DEFAULT ''"),
    ("users", "requested_at", "TIMESTAMP"),
    ("users", "decided_by", "VARCHAR(80) NOT NULL DEFAULT ''"),
    ("users", "decided_at", "TIMESTAMP"),
    ("users", "reject_reason", "TEXT NOT NULL DEFAULT ''"),
]


def _migrate() -> None:
    from sqlalchemy import inspect, text

    insp = inspect(engine)
    tables = set(insp.get_table_names())
    with engine.begin() as c:
        for table, col, ddl in _ADDED_COLUMNS:
            if table in tables and col not in {x["name"] for x in insp.get_columns(table)}:
                c.execute(text(f'ALTER TABLE "{table}" ADD COLUMN "{col}" {ddl}'))
        if "users" in tables:
            c.execute(text('CREATE INDEX IF NOT EXISTS ix_users_status ON users (status)'))
            c.execute(text('CREATE INDEX IF NOT EXISTS ix_users_email ON users (email)'))
            # 가입 기능 전 계정은 아이디가 이메일이었다 — 이메일 칸이 비어 있으면 채워 둔다
            c.execute(text("UPDATE users SET email = username WHERE email = '' AND username LIKE '%@%'"))


def init_db() -> None:
    """모든 테이블을 만들고(이미 있으면 그대로) 나중에 붙은 칸을 더한다."""
    from app import models  # noqa: F401  (모델 등록 목적 import)

    Base.metadata.create_all(bind=engine)
    _migrate()


def get_session():
    """with get_session() as db: ... 형태로 사용."""
    return SessionLocal()
