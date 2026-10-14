"""
Solution Buffer API — Redmine salesissue 감시 · SB 문서 검토/업로드 · 통계 · 설정.

tw-next(3080)에서 Solution Buffer 만 떼어 낸 독립 프로젝트다.
- 업무 코드는 backend/app(이슈 수집·SB 문서·Confluence·메일 발송), DB 는 로컬 PostgreSQL(sbnext).
- 외부 쓰기(Confluence 업로드·메일)는 검증 모드(app.shadow)가 막고 기록만 한다. 운영 전환은 관리자가 한다.
- Redmine 수집 · SB 초안 생성 · 통계 데우기는 이 프로세스의 스레드로 돈다(runtime.py).
- 회원가입(회사명 · 이메일 · ID · 비밀번호)은 승인 대기로 들어가고, 관리자가 승인해야 로그인할 수 있다.
- 로그인은 users 표의 비밀번호로 확인하고, 서명된 쿠키 세션을 쓴다.

    python -m uvicorn main:app --host 127.0.0.1 --port 8170   (api 폴더에서, backend/.venv 로)
"""
from __future__ import annotations

import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
load_dotenv(HERE.parent / ".env")
BACKEND = (HERE.parent / "backend").resolve()
load_dotenv(BACKEND / ".env")
sys.path.insert(0, str(BACKEND))

from fastapi import FastAPI, HTTPException, Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from pydantic import BaseModel  # noqa: E402
from starlette.middleware.sessions import SessionMiddleware  # noqa: E402

from app import app_settings, shadow  # noqa: E402
from app.database import get_session  # noqa: E402
from app.models import User  # noqa: E402
from app.security import verify_password  # noqa: E402

import runtime  # noqa: E402
from common import user as _user  # noqa: E402

SECRET = os.getenv("SBN_SECRET", "")
if not SECRET:
    raise SystemExit("SBN_SECRET 가 .env 에 없습니다 (pointmobile-faq/.env)")


@asynccontextmanager
async def _lifespan(_app):
    runtime.start()
    yield


app = FastAPI(title="Solution Buffer api", docs_url=None, redoc_url=None, lifespan=_lifespan)
app.add_middleware(SessionMiddleware, secret_key=SECRET, session_cookie="sbn_session",
                   max_age=60 * 60 * 12, same_site="lax", https_only=False)


# ── 인증 ───────────────────────────────────────────────────────────────────────

class LoginIn(BaseModel):
    username: str
    password: str


@app.post("/api/login")
def login(body: LoginIn, request: Request):
    with get_session() as db:
        u = db.query(User).filter_by(username=body.username.strip()).first()
        if u is None or not verify_password(body.password, u.password_hash):
            raise HTTPException(401, "아이디 또는 비밀번호가 맞지 않습니다")
        # 비밀번호가 맞을 때만 상태를 알려 준다 — 남의 ID 로 가입 여부를 떠볼 수 없게
        if u.status == "pending":
            raise HTTPException(403, "가입 승인을 기다리고 있습니다. 관리자가 승인하면 로그인할 수 있습니다.")
        if u.status == "rejected":
            raise HTTPException(403, "가입이 반려되었습니다" + (f" — {u.reject_reason}" if u.reject_reason else "")
                                + ". 회원가입에서 다시 신청할 수 있습니다.")
        request.session["user"] = {"id": u.id, "username": u.username, "role": u.role}
        return {"ok": True, "username": u.username, "role": u.role,
                "must_change_password": bool(u.must_change_password)}


class SignupIn(BaseModel):
    company: str
    email: str
    email_token: str = ""          # 이메일 인증을 마치면 받는 확인 토큰
    username: str
    password: str
    password2: str


class EmailIn(BaseModel):
    email: str


class EmailCodeIn(BaseModel):
    email: str
    code: str


@app.get("/api/signup/check")
def signup_check(username: str = "", email: str = ""):
    """ID · 이메일 중복 확인 — 준 것만 확인한다."""
    from app import signup_verify as V

    out = {}
    if username:
        ok, msg = V.id_status(username)
        out["username"] = {"ok": ok, "message": msg}
    if email:
        ok, msg = V.email_status(email)
        out["email"] = {"ok": ok, "message": msg}
    return out


@app.post("/api/signup/email-code")
def signup_email_code(body: EmailIn):
    """인증번호를 메일로 보낸다(60초 간격 · 한 시간 5번). 검증 모드면 보내지 않고 기록만 한다."""
    from app import signup_verify as V

    ok, msg = V.send_code(body.email)
    if not ok:
        raise HTTPException(400, msg)
    return {"ok": True, "message": msg, "ttl": int(V.CODE_TTL.total_seconds()), "resend": int(V.RESEND_GAP.total_seconds())}


@app.post("/api/signup/email-verify")
def signup_email_verify(body: EmailCodeIn):
    from app import signup_verify as V

    ok, msg, token = V.verify_code(body.email, body.code)
    if not ok:
        raise HTTPException(400, msg)
    return {"ok": True, "message": msg, "token": token}


@app.post("/api/signup")
def signup(body: SignupIn):
    """회원가입 신청 — 이메일 인증 · ID/이메일 중복을 확인하고 승인 대기 계정을 만든 뒤 관리자에게 알린다."""
    from app import accounts
    from app import signup_verify as V
    from app.account_mail import send_signup_request

    if not V.token_valid(body.email, body.email_token):
        raise HTTPException(400, "이메일 인증을 먼저 마치세요(인증 후 30분 안에 신청해야 합니다)")
    e_ok, e_msg = V.email_status(body.email)
    if not e_ok:
        raise HTTPException(400, e_msg)
    ok, msg, _uid = accounts.request_signup(body.company, body.email, body.username, body.password, body.password2)
    if not ok:
        raise HTTPException(400, msg)
    V.consume_token(body.email)
    sent, why = send_signup_request({"company": body.company.strip(), "email": body.email.strip(),
                                     "username": body.username.strip()})
    if not sent:
        print(f"[signup] 관리자 알림 실패: {why}", flush=True)
    return {"ok": True, "message": msg}


@app.post("/api/logout")
def logout(request: Request):
    request.session.clear()
    return {"ok": True}


@app.get("/api/me")
def me(request: Request):
    u = _user(request)
    with get_session() as db:
        row = db.get(User, u["id"])
        must = bool(row and row.must_change_password)
    out = {**u, "live": shadow.live(), "must_change_password": must}
    if u.get("role") == "admin":
        from app import accounts

        out["pending_signups"] = accounts.pending_count()
    return out


# ── 검증 모드 · 운영 전환 ──────────────────────────────────────────────────────────

class LiveIn(BaseModel):
    live: bool


@app.get("/api/shadow")
def shadow_log(request: Request, limit: int = 200):
    _user(request)
    return {"live": shadow.live(), "writes": shadow.recent(min(limit, 1000)), "runtime": runtime.status}


@app.post("/api/shadow/live")
def shadow_set_live(body: LiveIn, request: Request):
    u = _user(request)
    if u.get("role") != "admin":
        raise HTTPException(403, "관리자만 바꿀 수 있습니다")
    app_settings.set("live_writes", "1" if body.live else "0", by=u["username"])
    shadow.record("system", "운영 전환" if body.live else "검증 모드로", by=u["username"])
    return {"live": shadow.live()}


# ── 영역별 라우터(api/routers/*.py) ─────────────────────────────────────────────────

def _include_routers() -> None:
    import importlib
    import pkgutil

    import routers

    for m in sorted(pkgutil.iter_modules(routers.__path__), key=lambda m: m.name):
        r = getattr(importlib.import_module(f"routers.{m.name}"), "router", None)
        if r is not None:
            app.include_router(r)


_include_routers()


@app.exception_handler(HTTPException)
async def _http_err(_req, exc: HTTPException):
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)
