"""회원가입 이메일 인증 · ID/이메일 중복 확인.

흐름: 인증번호 받기(send_code) → 메일의 6자리 입력(verify_code) → 확인 토큰 → 가입 신청이 토큰을 낸다(consume_token).

- 인증번호는 원문을 저장하지 않는다 — sha256(비밀 열쇠 · 주소 · 번호). 10분 동안 유효, 틀린 입력 5번이면 무효.
- 재발송은 60초 간격, 한 주소에 한 시간 5번까지.
- 확인 토큰은 30분 동안 유효하고, 가입 신청에 한 번 쓰면 사라진다.
- 메일은 user_mailer.send_as_user 로 나간다 — 검증 모드면 보내지 않고 기록만 한다(관리자는 [설정 → 검증 모드] 기록에서 번호를 볼 수 있다).
"""
from __future__ import annotations

import hashlib
import os
import re
import secrets
from datetime import datetime, timedelta

from app.database import get_session
from app.models import SignupEmailCode, User

CODE_TTL = timedelta(minutes=10)
TOKEN_TTL = timedelta(minutes=30)
RESEND_GAP = timedelta(seconds=60)
MAX_PER_HOUR = 5
MAX_ATTEMPTS = 5

_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{3,39}$")


def _norm(email: str) -> str:
    return (email or "").strip().lower()


def _h(*parts: str) -> str:
    key = os.getenv("FERNET_KEY", "") or os.getenv("SBN_SECRET", "")
    return hashlib.sha256("\x1f".join((key, *parts)).encode("utf-8")).hexdigest()


# ── 중복 확인 ─────────────────────────────────────────────────────────────────

def id_status(username: str) -> tuple[bool, str]:
    """(쓸 수 있나, 안내). 반려된 ID 는 다시 신청할 수 있으므로 '쓸 수 있음' 이다."""
    u = (username or "").strip()
    if not _ID_RE.match(u):
        return False, "영문·숫자로 시작하는 4~40자(영문 · 숫자 · . _ -)"
    with get_session() as db:
        row = db.query(User).filter(User.username.ilike(u)).first()
        if row is None or row.status == "rejected":
            return True, "사용할 수 있는 ID 입니다"
        return False, "승인을 기다리는 신청이 있는 ID 입니다" if row.status == "pending" else "이미 쓰고 있는 ID 입니다"


def email_status(email: str) -> tuple[bool, str]:
    """(쓸 수 있나, 안내). 승인됐거나 승인 대기 중인 계정의 주소면 쓸 수 없다."""
    e = _norm(email)
    if not _EMAIL_RE.match(e):
        return False, "이메일 형식이 아닙니다"
    with get_session() as db:
        row = (db.query(User).filter(User.email.ilike(e), User.status.in_(("approved", "pending")))
               .order_by(User.status != "approved").first())
        if row is None:
            return True, "사용할 수 있는 이메일입니다"
        return False, "이미 가입된 이메일입니다" if row.status == "approved" else "승인을 기다리는 신청에 쓰인 이메일입니다"


# ── 인증번호 ───────────────────────────────────────────────────────────────────

def send_code(email: str) -> tuple[bool, str]:
    """인증번호를 만들어 메일로 보낸다. (성공, 안내)"""
    e = _norm(email)
    ok, why = email_status(e)
    if not ok:
        return False, why
    now = datetime.now()
    code = f"{secrets.randbelow(1_000_000):06d}"
    with get_session() as db:
        row = db.get(SignupEmailCode, e)
        if row is None:
            row = SignupEmailCode(email=e, sent_count=0)
            db.add(row)
        if row.sent_at and now - row.sent_at < RESEND_GAP:
            left = int((RESEND_GAP - (now - row.sent_at)).total_seconds()) + 1
            return False, f"{left}초 뒤에 다시 받을 수 있습니다"
        if not row.window_start or now - row.window_start > timedelta(hours=1):
            row.window_start, row.sent_count = now, 0
        if row.sent_count >= MAX_PER_HOUR:
            return False, "인증번호를 너무 자주 요청했습니다. 한 시간 뒤에 다시 시도하세요"
        row.code_hash = _h("code", e, code)
        row.expires_at = now + CODE_TTL
        row.attempts = 0
        row.sent_at = now
        row.sent_count = (row.sent_count or 0) + 1
        row.verified_at, row.token_hash = None, ""
        db.commit()

    from app import mail_templates as MT
    from app.user_mailer import send_as_user, system_sender_user_id

    sender = system_sender_user_id()
    if sender is None:
        return False, "메일 발송 계정이 설정되지 않아 보낼 수 없습니다"
    subject, body = MT.render("signup_email_code", 인증번호=code, 유효시간=f"{int(CODE_TTL.total_seconds() // 60)}분")
    sent, err = send_as_user(sender, e, subject, body)
    if not sent:
        return False, f"인증 메일을 보내지 못했습니다 — {err}"
    return True, f"{e} 로 인증번호를 보냈습니다. {int(CODE_TTL.total_seconds() // 60)}분 안에 입력하세요"


def verify_code(email: str, code: str) -> tuple[bool, str, str]:
    """인증번호 확인 — 맞으면 (True, 안내, 확인 토큰)."""
    e, code = _norm(email), (code or "").strip()
    now = datetime.now()
    with get_session() as db:
        row = db.get(SignupEmailCode, e)
        if row is None or not row.code_hash:
            return False, "먼저 인증번호를 받으세요", ""
        if row.expires_at is None or now > row.expires_at:
            return False, "인증번호가 만료되었습니다. 다시 받으세요", ""
        if (row.attempts or 0) >= MAX_ATTEMPTS:
            return False, "틀린 입력이 많아 이 인증번호는 쓸 수 없습니다. 다시 받으세요", ""
        if not secrets.compare_digest(row.code_hash, _h("code", e, code)):
            row.attempts = (row.attempts or 0) + 1
            db.commit()
            left = MAX_ATTEMPTS - row.attempts
            return False, (f"인증번호가 맞지 않습니다 (남은 시도 {left}번)" if left else "인증번호가 맞지 않습니다. 다시 받으세요"), ""
        token = secrets.token_urlsafe(24)
        row.verified_at, row.token_hash = now, _h("token", e, token)
        row.code_hash = ""                      # 한 번 맞힌 번호는 다시 못 쓴다
        db.commit()
        return True, "이메일이 인증되었습니다", token


def token_valid(email: str, token: str) -> bool:
    """가입 신청이 낸 확인 토큰이 그 주소의 것이고 아직 유효한가(소모하지 않는다)."""
    e = _norm(email)
    with get_session() as db:
        row = db.get(SignupEmailCode, e)
        return bool(row and row.token_hash and token and row.verified_at is not None
                    and datetime.now() - row.verified_at <= TOKEN_TTL
                    and secrets.compare_digest(row.token_hash, _h("token", e, token)))


def consume_token(email: str) -> None:
    """가입 신청이 성공한 뒤 — 토큰을 지워 다시 못 쓰게 한다."""
    with get_session() as db:
        row = db.get(SignupEmailCode, _norm(email))
        if row is not None:
            row.token_hash = ""
            db.commit()
