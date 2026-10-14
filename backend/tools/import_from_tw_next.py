"""tw-next(3080) 의 DB 에서 Solution Buffer 에 필요한 것만 sbnext 로 복사한다(3080 쪽은 읽기만).

    backend\\.venv\\Scripts\\python.exe -X utf8 tools\\import_from_tw_next.py            # 건수만
    backend\\.venv\\Scripts\\python.exe -X utf8 tools\\import_from_tw_next.py --load     # 실제로(대상 표를 비우고 채운다)

  public    : users · mail_credentials · web_credentials(redmine · release_notes 만) · staff · mail_templates · app_settings
  issuetrack: 전부(이슈 · 이벤트 · 첨부 · SB 문서 · 수집 상태 · 이름표)
  usage     : 옮기지 않는다(이 프로젝트에서 새로 쌓는다)

API(8170)를 멈춘 상태에서 돌린다. 원본 접속 주소는 tw-next/backend/.env 의 TWN_PG_URL.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import dotenv_values  # noqa: E402
from sqlalchemy import create_engine, select, text  # noqa: E402

from app import database  # noqa: E402
from app import models  # noqa: E402
from app.issuetrack import db as itdb  # noqa: E402
from app.issuetrack import models as _im  # noqa: E402,F401

SRC_ENV = Path(r"C:\Users\POINTMOBILE\dev\tw-next\backend\.env")
src_url = dotenv_values(SRC_ENV).get("TWN_PG_URL") or ""
if not src_url:
    raise SystemExit(f"원본 TWN_PG_URL 이 없습니다 ({SRC_ENV})")
SRC = create_engine(src_url, connect_args={"options": "-c default_transaction_read_only=on"})

WEB_TARGETS = ("redmine", "release_notes")
PLAN = [
    # (스키마, 표 객체, 대상 엔진, 원본에서 고를 조건)
    ("public", models.User.__table__, database.engine, None),
    ("public", models.MailCredential.__table__, database.engine, None),
    ("public", models.WebCredential.__table__, database.engine, models.WebCredential.__table__.c.target.in_(WEB_TARGETS)),
    ("public", models.Staff.__table__, database.engine, None),
    ("public", models.MailTemplate.__table__, database.engine, None),
    ("public", models.AppSetting.__table__, database.engine, None),
] + [("issuetrack", t, itdb.issuetrack_engine, None) for t in itdb.IssuetrackBase.metadata.sorted_tables]


def run(load: bool) -> int:
    database.init_db()
    itdb.init_issuetrack_db()
    bad = 0
    if load:   # 자식 표부터 비운다(외래키)
        for schema, table, eng, _w in reversed(PLAN):
            with eng.begin() as c:
                c.execute(text(f'TRUNCATE TABLE "{schema}"."{table.name}" RESTART IDENTITY CASCADE'))
    for schema, table, eng, where in PLAN:
        src_table = table.to_metadata(type(table.metadata)(), schema=schema)
        q = select(*src_table.columns)
        if where is not None:
            q = q.where(src_table.c[where.left.name].in_(WEB_TARGETS))
        with SRC.connect() as sc:
            rows = [dict(r._mapping) for r in sc.execute(q)]
        if not load:
            print(f"   {schema}.{table.name}: {len(rows)}행")
            continue
        with eng.begin() as c:
            for i in range(0, len(rows), 500):
                c.execute(table.insert(), rows[i:i + 500])
            pk = list(table.primary_key.columns)
            if len(pk) == 1 and pk[0].type.python_type is int and pk[0].autoincrement in (True, "auto"):
                c.execute(text(
                    f"SELECT setval(pg_get_serial_sequence('\"{schema}\".\"{table.name}\"', '{pk[0].name}'), "
                    f"COALESCE((SELECT MAX(\"{pk[0].name}\") FROM \"{schema}\".\"{table.name}\"), 1), "
                    f"(SELECT MAX(\"{pk[0].name}\") FROM \"{schema}\".\"{table.name}\") IS NOT NULL)"))
            n = c.execute(text(f'SELECT COUNT(*) FROM "{schema}"."{table.name}"')).scalar()
        mark = "" if n == len(rows) else f"  ✘ 원본 {len(rows)}행"
        bad += n != len(rows)
        print(f"   {schema}.{table.name}: {n}행{mark}")
    if load:   # SB 에는 RN 승인자·최종 승인자 역할이 없다 — 관리자가 아니면 담당자(user)로
        with database.engine.begin() as c:
            n = c.execute(text("UPDATE users SET role='user' WHERE role NOT IN ('admin','user')")).rowcount
        print(f"   역할 정리: {n}명 → user")
    return bad


if __name__ == "__main__":
    b = run("--load" in sys.argv)
    print("문제 없음" if not b else f"문제 {b}건")
    sys.exit(1 if b else 0)
