"""계정 — 회원가입(승인제) · 역할 · 비밀번호 초기화 · 삭제. 관리자 전용 동작은 api 쪽에서 막는다.

가입하면 승인 대기(pending)가 되고, 관리자가 승인(approved)해야 로그인할 수 있다. 반려(rejected)된
아이디는 같은 아이디로 다시 신청할 수 있다(신청 내용을 새로 받는다).
역할은 둘이다 — user(본인 담당 SB 문서만) · admin(전체 · 설정 · 계정).
"""
from __future__ import annotations

import re
from datetime import datetime

from app.database import get_session
from app.models import MailCredential, User, WebCredential
from app.security import hash_password

#: 관리자가 만든 계정·초기화한 계정의 비밀번호. 첫 로그인에서 바꾸게 한다.
INITIAL_PASSWORD = "1234"

VALID_ROLES = ("user", "admin")
ROLE_LABEL = {"admin": "관리자", "user": "담당자"}

# 계정과 함께 지우는 개인 자격증명
_PERSONAL = (MailCredential, WebCredential)

PENDING, APPROVED, REJECTED = "pending", "approved", "rejected"
STATUS_LABEL = {PENDING: "승인 대기", APPROVED: "승인", REJECTED: "반려"}

_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{3,39}$")
_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
PASSWORD_MIN = 8


def _check_signup(company: str, email: str, username: str, password: str, password2: str) -> str:
    """신청 값 검사 — 문제가 있으면 사람이 읽을 사유, 없으면 ''."""
    if not company:
        return "회사명을 입력하세요."
    if not _EMAIL_RE.match(email):
        return "이메일 형식이 아닙니다."
    if not _ID_RE.match(username):
        return "ID 는 영문·숫자로 시작하는 4~40자(영문 · 숫자 · . _ -)입니다."
    if len(password) < PASSWORD_MIN:
        return f"비밀번호는 {PASSWORD_MIN}자 이상이어야 합니다."
    if password != password2:
        return "비밀번호 확인이 일치하지 않습니다."
    if password == INITIAL_PASSWORD or password.lower() == username.lower():
        return "아이디나 초기 비밀번호와 다른 비밀번호를 쓰세요."
    return ""


def request_signup(company: str, email: str, username: str, password: str, password2: str) -> tuple[bool, str, int | None]:
    """가입 신청 — 승인 대기 계정을 만든다. (성공, 안내, 계정 id)

    · 같은 ID 가 승인 대기면 다시 받지 않는다(관리자 처리를 기다린다).
    · 같은 ID 가 반려됐으면 새 신청으로 덮는다.
    · 승인된 계정과 ID · 이메일이 겹치면 받지 않는다.
    """
    company, email, username = (company or "").strip(), (email or "").strip(), (username or "").strip()
    why = _check_signup(company, email, username, password or "", password2 or "")
    if why:
        return False, why, None
    with get_session() as db:
        u = db.query(User).filter(User.username.ilike(username)).first()
        if u is not None and u.status == APPROVED:
            return False, "이미 쓰고 있는 ID 입니다.", None
        if u is not None and u.status == PENDING:
            return False, "같은 ID 로 승인을 기다리는 신청이 있습니다. 관리자 승인 후 로그인할 수 있습니다.", None
        clash = (db.query(User).filter(User.email.ilike(email), User.status == APPROVED)
                 .filter(User.id != (u.id if u else 0)).first())
        if clash is not None:
            return False, "이 이메일로 가입된 계정이 이미 있습니다.", None
        if u is None:
            u = User(username=username, role="user")
            db.add(u)
        u.password_hash = hash_password(password)
        u.company, u.email, u.status = company, email, PENDING
        u.must_change_password = False
        u.requested_at = datetime.now()
        u.decided_by, u.decided_at, u.reject_reason = "", None, ""
        db.commit()
        return True, "가입 신청을 받았습니다. 관리자가 승인하면 로그인할 수 있습니다.", u.id


def decide_signup(user_id: int, approve: bool, by: str, reason: str = "") -> tuple[bool, str, dict]:
    """승인 대기 계정을 승인 · 반려한다. (성공, 안내, 알림에 쓸 신청 정보)"""
    reason = (reason or "").strip()
    if not approve and not reason:
        return False, "반려 사유를 적으세요.", {}
    with get_session() as db:
        u = db.query(User).filter_by(id=user_id).first()
        if u is None:
            return False, "계정을 찾을 수 없습니다.", {}
        if u.status != PENDING:
            return False, f"'{u.username}' 은(는) 승인 대기가 아닙니다({STATUS_LABEL.get(u.status, u.status)}).", {}
        u.status = APPROVED if approve else REJECTED
        u.decided_by, u.decided_at = by, datetime.now()
        u.reject_reason = "" if approve else reason
        db.commit()
        info = {"username": u.username, "company": u.company, "email": u.email, "reason": u.reject_reason}
        return True, f"'{u.username}' 가입을 {'승인' if approve else '반려'}했습니다.", info


def pending_count() -> int:
    with get_session() as db:
        return db.query(User).filter(User.status == PENDING).count()


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
