"""영역 라우터들이 같이 쓰는 것 — 로그인 사용자 확인 · 관리자 확인.

세션 쿠키에는 로그인한 순간의 정보만 있다. 그 뒤 계정이 지워지거나 반려 · 역할 변경되면 쿠키만으로는
모르므로, 요청마다 계정을 다시 읽어 **승인된 계정**인지와 지금 역할을 확인한다.
"""
from __future__ import annotations

from fastapi import HTTPException, Request


def user(request: Request) -> dict:
    u = request.session.get("user")
    if not u:
        raise HTTPException(401, "로그인이 필요합니다")
    from app.database import get_session
    from app.models import User

    with get_session() as db:
        row = db.get(User, u.get("id"))
        if row is None or row.status != "approved":
            request.session.clear()
            raise HTTPException(401, "로그인이 필요합니다")
        if row.role != u.get("role") or row.username != u.get("username"):
            u = {"id": row.id, "username": row.username, "role": row.role}
            request.session["user"] = u
    return u


def admin(request: Request) -> dict:
    u = user(request)
    if u.get("role") != "admin":
        raise HTTPException(403, "관리자만 할 수 있습니다")
    return u
