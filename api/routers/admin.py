"""
관리 · 설정 — 메일 발송 계정 · Redmine/Confluence 로그인 · Claude · SB 동작 · 계정 · 인원 명부 · 메일 문구 · 사용량.

tw-next 의 api/routers/admin.py 에서 Solution Buffer 에 필요한 것만 옮겼다.
비밀번호 값은 화면으로 내보내지 않는다 — '설정됨' 여부와 갱신 시각만 준다. 바꿀 때만 새 값을 받는다.
공용 웹 자격증명(Redmine · Confluence)은 공용 계정(admin) 행에 저장한다.
"""
from __future__ import annotations

import os
import re
import time

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.database import get_session
from app.models import MailCredential, User, WebCredential
from app.security import decrypt_secret, encrypt_secret, hash_password, verify_password
from common import admin, user

router = APIRouter(prefix="/api/admin")

# 메일 서버 — 발송(SMTP) 호스트도 여기서 정한다(user_mailer._smtp_host_for). tw-next 와 같은 값
_MAIL_SERVER = os.getenv("MAIL_SERVER", "mail.pointmobile.com")
_MAIL_PORT = int(os.getenv("MAIL_POP_PORT", "995") or "995")

# 웹 로그인 대상 — SB 가 쓰는 둘(값은 tw-next 와 같다)
_WEB_FIXED: dict[str, dict] = {
    "redmine": {
        "label": "Redmine (사내 이슈)", "base_url": "https://issue.pointmobile.co.kr",
        "login_url": "https://issue.pointmobile.co.kr/login",
        "user_sel": "#username", "pw_sel": "#password", "submit_sel": "#login-submit",
        "edit_tpl": "", "iframe_sel": "", "save_sel": "",
    },
    "release_notes": {
        "label": "Confluence (SB 스페이스)",
        "base_url": "http://post.solution-pointmobile.co.kr:8040", "login_url": "",
        "user_sel": "#os_username", "pw_sel": "#os_password", "submit_sel": "#loginButton",
        "edit_tpl": "{base}/pages/editpage.action?pageId={page_id}",
        "iframe_sel": "#wysiwygTextarea_ifr", "save_sel": "#rte-button-publish",
    },
}


def _ts(dt) -> str:
    return dt.strftime("%Y-%m-%d %H:%M") if dt else ""


def _shared_uid() -> int:
    from app.integrations.creds import credential_user_id

    return credential_user_id()


def _bad(msg: str, code: int = 400):
    raise HTTPException(code, msg)


# ── 설정: 전체 현황 ────────────────────────────────────────────────────────────────

@router.get("/settings")
def settings_overview(request: Request):
    u = user(request)
    from app.user_mailer import sender_profile, system_from, system_sender_user_id

    sid = _shared_uid()
    relay = os.getenv("TW_MAIL_ACCOUNT", "").strip()
    with get_session() as db:
        mine = db.query(MailCredential).filter_by(user_id=u["id"]).first()
        webs = {w.target: w for w in db.query(WebCredential).filter_by(user_id=sid).all()}
        out: dict = {"is_admin": u.get("role") == "admin"}
        relay_owner = (not relay) or system_sender_user_id() == u["id"]
        addr, _n, _s = sender_profile(u["id"])
        f_addr, f_name, _r = system_from()
        out["sender"] = {
            "relay_owner": relay_owner, "relay": bool(relay), "my_address": addr or "",
            "system_from": f_addr or "", "system_from_name": f_name or "",
            "email": mine.email_address if mine else "", "has_password": bool(mine and mine.encrypted_password),
        }
        out["web"] = [{
            "target": t, "label": cfg["label"], "base_url": cfg["base_url"],
            "username": webs[t].username if t in webs else "",
            "has_password": bool(t in webs and webs[t].encrypted_password),
            "updated_at": _ts(getattr(webs.get(t), "updated_at", None)),
        } for t, cfg in _WEB_FIXED.items()]

    from app.integrations import claude_cli as CC

    st = CC.status()
    out["claude"] = {"backend": st["backend"], "claude": st["claude"] or "", "has_key": bool(st["has_key"])}

    from app.issuetrack import sb as _sb
    from app.issuetrack import settings as it_settings

    cfg = it_settings.load()
    missing = []
    try:
        missing = [{"name": n, "count": c} for n, c in _sb.assignees_without_account()]
    except Exception:  # noqa: BLE001
        pass
    out["sb"] = {"sb_auto_notify": cfg.sb_auto_notify, "sb_assignees": cfg.sb_assignees,
                 "exclude_keywords": cfg.exclude_keywords, "sb_auto_generate": cfg.sb_auto_generate,
                 "sb_per_tick": cfg.sb_per_tick, "missing_accounts": missing}
    return out


# ── 메일 발송 계정 ─────────────────────────────────────────────────────────────────

class MailAccountIn(BaseModel):
    email: str
    password: str = ""


def _relay_guard(u: dict) -> None:
    from app.user_mailer import system_sender_user_id

    relay = os.getenv("TW_MAIL_ACCOUNT", "").strip()
    if relay and system_sender_user_id() != u["id"]:
        _bad("공용 발송 계정을 쓰고 있어 등록할 것이 없습니다", 409)


@router.post("/settings/smtp")
def save_smtp(body: MailAccountIn, request: Request):
    u = user(request)
    _relay_guard(u)
    email = body.email.strip()
    if not email:
        _bad("메일 주소를 입력하세요")
    with get_session() as db:
        row = db.query(MailCredential).filter_by(user_id=u["id"]).first()
        if row is None:
            if not body.password:
                _bad("최초 등록 시 앱 비밀번호가 필요합니다")
            row = MailCredential(user_id=u["id"], encrypted_password="")
            db.add(row)
        row.email_address = email
        row.pop_server, row.pop_port, row.use_ssl = _MAIL_SERVER, _MAIL_PORT, True
        if body.password:
            row.encrypted_password = encrypt_secret(body.password)
        db.commit()
    return {"ok": True, "message": "발송 계정을 저장했습니다"}


@router.post("/settings/smtp/test")
def test_smtp(body: MailAccountIn, request: Request):
    """SMTP 로그인까지만 해 본다 — 메일은 보내지 않는다."""
    import smtplib

    from app.user_mailer import _smtp_host_for

    u = user(request)
    _relay_guard(u)
    pw = body.password
    if not pw:
        with get_session() as db:
            row = db.query(MailCredential).filter_by(user_id=u["id"]).first()
            pw = decrypt_secret(row.encrypted_password) if row and row.encrypted_password else ""
    email = body.email.strip()
    if not email or not pw:
        _bad("메일 주소와 앱 비밀번호가 필요합니다")
    host = _smtp_host_for(_MAIL_SERVER)
    port = int(os.getenv("USER_SMTP_PORT", "587") or "587")
    try:
        with smtplib.SMTP(host, port, timeout=20) as s:
            s.ehlo()
            s.starttls()
            s.ehlo()
            s.login(email, pw)
        return {"ok": True, "message": f"{host}:{port} 로그인 성공"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "message": f"로그인 실패: {e}"}


# ── Redmine · Confluence 로그인 ─────────────────────────────────────────────────────

class LoginCredIn(BaseModel):
    username: str
    password: str = ""


@router.post("/settings/web/{target}")
def save_web(target: str, body: LoginCredIn, request: Request):
    admin(request)
    cfg = _WEB_FIXED.get(target)
    if not cfg:
        _bad("모르는 대상입니다", 404)
    if not body.username.strip():
        _bad("아이디를 입력하세요")
    sid = _shared_uid()
    with get_session() as db:
        row = db.query(WebCredential).filter_by(user_id=sid, target=target).first()
        if row is None:
            if not body.password:
                _bad("최초 등록 시 비밀번호가 필요합니다")
            row = WebCredential(user_id=sid, target=target)
            db.add(row)
        row.base_url, row.login_url = cfg["base_url"], cfg["login_url"]
        row.username = body.username.strip()
        row.username_sel, row.password_sel, row.submit_sel = cfg["user_sel"], cfg["pw_sel"], cfg["submit_sel"]
        row.edit_url_template, row.editor_iframe_sel, row.save_button_sel = cfg["edit_tpl"], cfg["iframe_sel"], cfg["save_sel"]
        if body.password:
            row.encrypted_password = encrypt_secret(body.password)
        db.commit()
    return {"ok": True, "message": f"{cfg['label']} 계정을 저장했습니다"}


# ── Claude · SB 동작 ────────────────────────────────────────────────────────────

class ClaudeIn(BaseModel):
    backend: str


@router.post("/settings/claude")
def save_claude(body: ClaudeIn, request: Request):
    u = admin(request)
    from app import app_settings
    from app.integrations import claude_cli as CC

    try:
        app_settings.set("claude_backend", body.backend, by=str(u["id"]))
    except ValueError as e:
        _bad(str(e))
    st = CC.status()
    return {"backend": st["backend"], "claude": st["claude"] or "", "has_key": bool(st["has_key"])}


@router.post("/settings/claude/try")
def try_claude(request: Request):
    admin(request)
    import anthropic

    t = time.time()
    try:
        r = anthropic.Anthropic().messages.create(
            model="claude-haiku-4-5", max_tokens=32,
            messages=[{"role": "user", "content": "1+1 은? 숫자만 답하세요."}])
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "message": f"실패: {e}"}
    said = "".join(getattr(b, "text", "") for b in r.content).strip()
    use = r.usage
    return {"ok": True, "message": f"{time.time() - t:.1f}초 · 답 {said[:20]!r} · 토큰 "
                                   f"{getattr(use, 'input_tokens', 0)}/{getattr(use, 'output_tokens', 0)}"}


# ── 계정 ─────────────────────────────────────────────────────────────────────

def _ts_full(dt) -> str:
    return dt.isoformat(timespec="seconds") if dt else ""


@router.get("/accounts")
def accounts(request: Request):
    u = user(request)
    from app.accounts import INITIAL_PASSWORD, ROLE_LABEL, STATUS_LABEL
    from app.user_mailer import system_from, user_email

    f_addr, f_name, _ = system_from()
    rows = []
    if u.get("role") == "admin":
        with get_session() as db:
            users = db.query(User).order_by(User.id).all()
            rows = [{"id": x.id, "username": x.username, "role": x.role or "user", "must_change": bool(x.must_change_password),
                     "status": x.status or "approved", "company": x.company or "", "email_field": x.email or "",
                     "requested_at": _ts_full(x.requested_at), "decided_by": x.decided_by or "",
                     "decided_at": _ts_full(x.decided_at), "reject_reason": x.reject_reason or "",
                     "me": x.id == u["id"]} for x in users]
        for r in rows:
            r["email"] = r.pop("email_field") or user_email(r["id"]) or ""
    return {"roles": ROLE_LABEL, "statuses": STATUS_LABEL, "users": rows,
            "system_from": f_addr or "", "system_from_name": f_name or "",
            "initial_password": INITIAL_PASSWORD if u.get("role") == "admin" else ""}


class DecideIn(BaseModel):
    approve: bool
    reason: str = ""


@router.post("/accounts/{uid}/decide")
def decide_signup(uid: int, body: DecideIn, request: Request):
    """가입 승인 · 반려 — 결과는 신청자에게 메일로(검증 모드면 기록만)."""
    u = admin(request)
    from app.account_mail import send_signup_result
    from app.accounts import decide_signup as _decide

    ok, msg, info = _decide(uid, body.approve, u["username"], body.reason)
    if not ok:
        _bad(msg, 409)
    sent, why = send_signup_result(info, body.approve)
    return {"ok": True, "message": msg + (" · 안내 메일 발송" if sent else f" · 안내 메일 못 보냄: {why}")}


class RoleIn(BaseModel):
    role: str


@router.post("/accounts/{uid}/role")
def set_role(uid: int, body: RoleIn, request: Request):
    u = admin(request)
    from app.accounts import set_user_role

    ok, msg = set_user_role(uid, body.role, u["id"])
    if not ok:
        _bad(msg, 409)
    return {"ok": True, "message": msg}


@router.post("/accounts/{uid}/reset-password")
def reset_pw(uid: int, request: Request):
    u = admin(request)
    from app.account_mail import send_reset
    from app.accounts import reset_password

    ok, msg, who = reset_password(uid)
    if not ok:
        _bad(msg, 404)
    sent, why = send_reset(u["id"], who)
    return {"ok": True, "message": msg + (" · 안내 메일 발송" if sent else f" · 안내 메일 실패: {why}")}


@router.delete("/accounts/{uid}")
def delete_account(uid: int, request: Request):
    u = admin(request)
    from app.accounts import delete_user

    ok, msg = delete_user(uid, u["id"])
    if not ok:
        _bad(msg, 409)
    return {"ok": True, "message": msg}


class PasswordIn(BaseModel):
    current: str
    new: str


@router.post("/me/password")
def change_my_password(body: PasswordIn, request: Request):
    u = user(request)
    from app.accounts import INITIAL_PASSWORD

    pw = (body.new or "").strip()
    if len(pw) < 4:
        _bad("비밀번호는 4자 이상이어야 합니다")
    if pw == INITIAL_PASSWORD:
        _bad("초기 비밀번호와 다른 값으로 정하세요")
    with get_session() as db:
        row = db.query(User).filter_by(id=u["id"]).first()
        if row is None or not verify_password(body.current, row.password_hash):
            _bad("지금 비밀번호가 맞지 않습니다", 403)
        row.password_hash = hash_password(pw)
        row.must_change_password = False
        db.commit()
    return {"ok": True, "message": "비밀번호를 바꿨습니다"}


# ── 사내 인원(Redmine 작성자 → 이름·팀 · 담당자 주소) ────────────────────────────────

@router.get("/staff")
def staff_list(request: Request):
    admin(request)
    from app import staff as ST

    return {"staff": ST.list_staff(), "statuses": list(ST.STATUSES), "active": ST.ACTIVE, "left": ST.LEFT}


class StaffIn(BaseModel):
    id: int | None = None
    name: str = ""
    email: str = ""
    team: str = ""
    status: str = ""
    is_dqa: bool = False
    is_handler: bool = False
    memo: str = ""


@router.post("/staff")
def staff_save(body: StaffIn, request: Request):
    u = admin(request)
    from app import staff as ST

    ok, msg = ST.save_staff(id=body.id, name=body.name, email=body.email, status=body.status or ST.ACTIVE,
                            is_dqa=body.is_dqa, is_handler=body.is_handler, team=body.team, memo=body.memo,
                            by=u["username"])
    if not ok:
        _bad(msg)
    return {"ok": True, "message": msg}


@router.delete("/staff/{sid}")
def staff_delete(sid: int, request: Request):
    admin(request)
    from app import staff as ST

    ok, msg = ST.delete_staff(sid)
    if not ok:
        _bad(msg)
    return {"ok": True, "message": msg}


# ── 메일 문구 ──────────────────────────────────────────────────────────────────

def _tpl_out(d: dict) -> dict:
    return {**d, "updated_at": _ts(d.get("updated_at"))}


@router.get("/mail-templates")
def mail_templates(request: Request):
    admin(request)
    from app import mail_templates as MT

    return {"groups": [{"group": g, "items": [_tpl_out(MT.get(k)) for k, t in MT.TEMPLATES.items() if t.group == g]}
                       for g in MT.groups()]}


class MailTplIn(BaseModel):
    subject: str
    body: str


@router.post("/mail-templates/{key}/preview")
def mail_template_preview(key: str, body: MailTplIn, request: Request):
    admin(request)
    from app import mail_templates as MT

    if key not in MT.TEMPLATES:
        _bad("없는 문구입니다", 404)
    vals = MT.sample(key)
    return {"subject": MT.fill(body.subject, vals), "body": MT.fill(body.body, vals),
            "unknown": MT.unknown_vars(key, body.subject, body.body),
            "missing": MT.missing_vars(key, body.subject, body.body)}


@router.post("/mail-templates/{key}")
def mail_template_save(key: str, body: MailTplIn, request: Request):
    u = admin(request)
    from app import mail_templates as MT

    bad = MT.unknown_vars(key, body.subject, body.body)
    if bad:
        _bad("값이 채워지지 않는 자리가 있습니다: " + ", ".join("{{" + b + "}}" for b in bad))
    gone = MT.missing_vars(key, body.subject, body.body)
    ok, msg = MT.save(key, body.subject, body.body, u["username"])
    if not ok:
        _bad(msg)
    return {"ok": True, "message": msg, "missing": gone, "item": _tpl_out(MT.get(key))}


@router.post("/mail-templates/{key}/reset")
def mail_template_reset(key: str, request: Request):
    admin(request)
    from app import mail_templates as MT

    ok, msg = MT.reset(key)
    if not ok:
        _bad(msg)
    return {"ok": True, "message": msg, "item": _tpl_out(MT.get(key))}


# ── Claude 사용량 ──────────────────────────────────────────────────────────────

@router.get("/usage")
def usage(request: Request, scope: str = "month"):
    user(request)
    from app import usage as US

    if scope not in ("today", "month", "all"):
        scope = "month"
    return {"totals": US.totals(), "by_day": US.by_day(30), "by_month": US.by_month(12),
            "by_operation": US.by_operation(scope), "recent": US.recent(80), "scope": scope}
