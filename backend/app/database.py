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


def init_db() -> None:
    """모든 테이블을 만든다(이미 있으면 그대로)."""
    from app import models  # noqa: F401  (모델 등록 목적 import)

    Base.metadata.create_all(bind=engine)


def get_session():
    """with get_session() as db: ... 형태로 사용."""
    return SessionLocal()
