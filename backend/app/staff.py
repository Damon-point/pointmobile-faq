"""사내 인원 명부 — 이름 · 메일 주소 · 팀을 관리자가 한 곳에서 관리한다.

메일을 보낼 때 받는 사람의 이름을 찾는 데 쓴다(app/user_mailer.py).
로그인 계정(users)과는 성격이 달라 따로 둔다 — 앱 사용자만이 아니라 사내 전원이다.
주소 비교는 소문자로 한다.

is_dqa · is_handler 컬럼은 tw-next 의 FOTA · WhiteList 메일 판정용이었다. 이 앱은 쓰지 않는다.
"""
from __future__ import annotations

from app.database import get_session
from app.models import Staff

ACTIVE, LEFT = "재직", "퇴사"
STATUSES = (ACTIVE, LEFT)


def _norm(email: str) -> str:
    return (email or "").strip().lower()


def _to_dict(s: Staff) -> dict:
    return {
        "id": s.id, "name": s.name or "", "email": s.email or "",
        "status": s.status or ACTIVE, "team": s.team or "",
        "memo": s.memo or "", "updated_by": s.updated_by or "",
    }


def list_staff() -> list[dict]:
    """명부 전체. 재직 먼저, 그다음 이름순."""
    with get_session() as db:
        rows = db.query(Staff).all()
        out = [_to_dict(s) for s in rows]
    out.sort(key=lambda r: (r["status"] != ACTIVE, r["name"] or r["email"]))
    return out


def save_staff(*, id: int | None, name: str, email: str, status: str = ACTIVE,
               team: str = "", memo: str = "", by: str = "") -> tuple[bool, str]:
    """추가(id=None) 또는 수정. (성공여부, 메시지).

    메일 주소는 명부에서 유일해야 한다 — 같은 사람이 두 행이면 이름이 갈린다.
    """
    addr = _norm(email)
    if not addr or "@" not in addr:
        return False, "메일 주소를 정확히 입력하세요."
    with get_session() as db:
        dup = db.query(Staff).filter(Staff.email == addr).first()
        if dup and (id is None or dup.id != id):
            return False, f"이미 등록된 주소입니다: {addr}"
        s = db.get(Staff, id) if id is not None else None
        if id is not None and s is None:
            return False, "대상을 찾을 수 없습니다(이미 삭제된 듯합니다)."
        if s is None:
            s = Staff()
            db.add(s)
        s.name = (name or "").strip()
        s.email = addr
        s.status = status if status in STATUSES else ACTIVE
        s.team = (team or "").strip()
        s.memo = (memo or "").strip()
        s.updated_by = by or ""
        db.commit()
    return True, "저장했습니다."


def delete_staff(id: int) -> tuple[bool, str]:
    with get_session() as db:
        s = db.get(Staff, id)
        if s is None:
            return False, "대상을 찾을 수 없습니다."
        db.delete(s)
        db.commit()
    return True, "삭제했습니다."
