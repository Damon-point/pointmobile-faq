"""공용 웹 자격증명(Redmine)을 복호화해 쓸 수 있는 형태로 돌려준다."""
from __future__ import annotations

from dataclasses import dataclass

from app.database import get_session
from app.models import WebCredential
from app.security import decrypt_secret

# 공용 자격증명(Redmine)은
# **admin 계정 한 곳**에 등록해 팀 전체가 공유한다. 예외는 개인 메일 발송 계정뿐
# (그건 user_mailer 가 각 사용자 계정으로 보낸다 — 여기 getter 들은 그 계정을 다루지 않는다).
_ADMIN_CRED_UID: int | None = None


def credential_user_id() -> int:
    """공용 자격증명을 소유한 계정 id = admin. (username 'admin' 우선, 없으면 최소 id admin.)"""
    global _ADMIN_CRED_UID
    if _ADMIN_CRED_UID is not None:
        return _ADMIN_CRED_UID
    from app.models import User

    with get_session() as db:
        u = (db.query(User).filter_by(username="admin").first()
             or db.query(User).filter_by(role="admin").order_by(User.id).first())
        _ADMIN_CRED_UID = u.id if u else 1
    return _ADMIN_CRED_UID


@dataclass
class WebConfig:
    target: str
    base_url: str
    username: str
    password: str


def get_web_config(user_id: int, target: str) -> "WebConfig | None":
    user_id = credential_user_id()   # 공용: admin 계정 자격증명 사용
    with get_session() as db:
        c = db.query(WebCredential).filter_by(user_id=user_id, target=target).first()
        if c is None or not c.base_url:
            return None
        return WebConfig(
            target=c.target,
            base_url=c.base_url,
            username=c.username,
            password=decrypt_secret(c.encrypted_password) if c.encrypted_password else "",
        )
