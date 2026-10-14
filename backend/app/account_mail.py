"""계정 안내 메일 — 가입 요청 알림 · 가입 결과 · 비밀번호 초기화 · 비밀번호 찾기.

모두 **시스템 명의**로 나간다(as_system=True) — 사람이 아니라 시스템이 알리는 것이고, 가입 신청자는
아직 로그인 전이라 명의로 삼을 사람도 없다. 답장은 Reply-To 를 따라 시스템 관리자에게 간다.
신청자에게 가는 메일은 가입 때 받은 이메일로 보낸다(ID 는 이메일이 아니다).
"""
from __future__ import annotations

from datetime import datetime

from app.accounts import INITIAL_PASSWORD
from app.user_mailer import (
    app_url, send_as_user, system_admin_emails, system_sender_user_id,
)

_LINE = "─" * 46


def _w(s: str) -> int:
    """터미널·고정폭 메일에서 차지하는 칸 수. 한글은 두 칸이다."""
    import unicodedata

    return sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in s)


def _table(rows: list[tuple[str, str]]) -> str:
    """줄맞춤한 정보 상자. 문구에서는 {{정보표}} 한 자리로 들어간다."""
    pad = max((_w(k) for k, _ in rows), default=0)
    out = [_LINE]
    out += [f"  {k}{' ' * (pad - _w(k))}   {v}" for k, v in rows]
    out += [_LINE]
    return "\n".join(out)


def _email_of(username: str) -> str:
    from app.database import get_session
    from app.models import User

    with get_session() as db:
        u = db.query(User).filter_by(username=username).first()
        addr = (u.email or "").strip() if u else ""
    return addr or (username if "@" in username else "")


def send_signup_request(info: dict) -> tuple[bool, str]:
    """가입 신청 — 시스템 관리자에게 승인을 요청한다."""
    from app import mail_templates as MT

    tos = system_admin_emails()
    sender = system_sender_user_id()
    if not tos or sender is None:
        return False, "관리자 주소나 발송 계정이 없어 알리지 못했습니다."
    subject, body = MT.render(
        "signup_request", 회사=info["company"], 아이디=info["username"],
        계정관리주소=f"{app_url()}/settings/accounts",
        정보표=_table([("회사", info["company"]), ("이메일", info["email"]), ("ID", info["username"]),
                     ("신청 시각", datetime.now().strftime("%Y-%m-%d %H:%M"))]))
    return send_as_user(sender, tos, subject, body, as_system=True)


def send_signup_result(info: dict, approved: bool) -> tuple[bool, str]:
    """가입 승인 · 반려 결과 — 신청자에게."""
    from app import mail_templates as MT

    sender = system_sender_user_id()
    if sender is None or not info.get("email"):
        return False, "발송 계정이나 신청자 주소가 없어 알리지 못했습니다."
    if approved:
        subject, body = MT.render("signup_approved", 정보표=_table(
            [("서비스 주소", app_url()), ("회사", info["company"]), ("ID", info["username"])]))
    else:
        subject, body = MT.render("signup_rejected", 사유=info.get("reason") or "-", 정보표=_table(
            [("회사", info["company"]), ("ID", info["username"])]))
    return send_as_user(sender, info["email"], subject, body, as_system=True)


def send_reset(actor_user_id: int, username: str) -> tuple[bool, str]:
    """비밀번호 초기화 안내 — 관리자가 초기화한 직후, 그 계정의 이메일로."""
    from app import mail_templates as MT

    to = _email_of(username)
    if not to:
        return False, "이 계정의 이메일이 없어 알리지 못했습니다."
    subject, body = MT.render("account_reset", 정보표=_table(
        [("서비스 주소", app_url()), ("아이디", username), ("초기 비밀번호", INITIAL_PASSWORD)]))
    return send_as_user(actor_user_id, to, subject, body, as_system=True)


def send_forgot_request(login_id: str, exists: bool) -> tuple[bool, str]:
    """로그인 화면의 '비밀번호를 잊으셨나요?' — 시스템 관리자에게 알린다.

    공용 'admin' 계정은 수신자에서 뺀다 — 여러 사람이 함께 쓰는 계정이라 개인 앞으로
    가야 할 안내가 묻힌다(사용자 확정 2026-08-19).
    화면에는 계정 존재 여부를 알리지 않는다(아이디 떠보기 방지). 관리자에게만 알린다.
    """
    tos = system_admin_emails()
    if not tos:
        return False, ("시스템 관리자(admin 계정 제외) 계정이 없어 요청을 전달하지 "
                       "못했습니다.")
    sender = system_sender_user_id()
    if sender is None:
        return False, "발송 계정이 설정되지 않아 요청을 전달하지 못했습니다."

    from app import mail_templates as MT

    subject, body = MT.render(
        "account_forgot", 아이디=login_id, 계정관리주소=f"{app_url()}/settings/accounts",
        정보표=_table([
            ("요청 아이디", login_id),
            ("요청 시각", datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
            ("계정 존재", "예" if exists else "아니오 — 등록되지 않은 아이디입니다"),
        ]),
    )
    return send_as_user(sender, tos, subject, body, as_system=True)
