"""계정 — 초기 비밀번호 · 역할 · 비밀번호 초기화 · 삭제. 관리자 전용 동작은 api 쪽에서 막는다.

Solution Buffer 의 역할은 둘이다 — user(본인 담당 SB 문서만) · admin(전체 · 설정 · 계정).
"""
from __future__ import annotations

from app.database import get_session
from app.models import MailCredential, User, WebCredential
from app.security import hash_password

#: 관리자가 만든 계정·초기화한 계정의 비밀번호. 첫 로그인에서 바꾸게 한다.
INITIAL_PASSWORD = "1234"

VALID_ROLES = ("user", "admin")
ROLE_LABEL = {"admin": "관리자", "user": "담당자"}

# 계정과 함께 지우는 개인 자격증명
_PERSONAL = (MailCredential, WebCredential)


def reset_password(user_id: int) -> tuple[bool, str, str]:
    """비밀번호를 초기값으로 되돌리고 다음 로그인에서 바꾸게 한다. (성공, 안내, 아이디)."""
    with get_session() as db:
        u = db.query(User).filter_by(id=user_id).first()
        if u is None:
            return False, "계정을 찾을 수 없습니다.", ""
        u.password_hash = hash_password(INITIAL_PASSWORD)
        u.must_change_password = True
        db.commit()
        return True, f"'{u.username}' 비밀번호를 초기화했습니다.", u.username


def _admin_count(db, exclude_id: int | None = None) -> int:
    q = db.query(User).filter(User.role == "admin")
    if exclude_id is not None:
        q = q.filter(User.id != exclude_id)
    return q.count()


def set_user_role(target_id: int, role: str, acting_id: int) -> tuple[bool, str]:
    """역할 변경. 마지막 관리자를 낮추는 것은 막는다."""
    if role not in VALID_ROLES:
        return False, f"알 수 없는 역할입니다: {role}"
    with get_session() as db:
        u = db.query(User).filter_by(id=target_id).first()
        if u is None:
            return False, "계정을 찾을 수 없습니다."
        if u.role == role:
            return True, f"'{u.username}' 은(는) 이미 {ROLE_LABEL[role]}입니다."
        if u.role == "admin" and role != "admin" and _admin_count(db, exclude_id=u.id) == 0:
            return False, "마지막 관리자는 권한을 낮출 수 없습니다. 다른 관리자를 먼저 지정하세요."
        u.role = role
        db.commit()
        return True, f"'{u.username}' 을(를) {ROLE_LABEL[role]}(으)로 변경했습니다."


def delete_user(target_id: int, acting_id: int) -> tuple[bool, str]:
    """계정 삭제 — 개인 자격증명만 같이 지운다. SB 문서·이슈는 계정에 묶여 있지 않아 그대로 남는다."""
    if target_id == acting_id:
        return False, "본인 계정은 삭제할 수 없습니다."
    with get_session() as db:
        u = db.query(User).filter_by(id=target_id).first()
        if u is None:
            return False, "계정을 찾을 수 없습니다."
        if u.role == "admin" and _admin_count(db, exclude_id=u.id) == 0:
            return False, "마지막 관리자는 삭제할 수 없습니다."
        uname = u.username
        for model in _PERSONAL:
            db.query(model).filter(model.user_id == target_id).delete(synchronize_session=False)
        db.flush()
        db.delete(db.query(User).filter_by(id=target_id).first())
        db.commit()
        return True, f"'{uname}' 계정을 삭제했습니다."
