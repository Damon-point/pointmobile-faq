"""앱이 보내는 모든 메일의 발송구.

**로그인 계정과 보이는 발신자를 나눈다.**
  · 로그인(SMTP AUTH)  : 공용 계정 하나 — TW_MAIL_ACCOUNT. 사람마다 앱 비밀번호를
    등록하지 않아도 앱이 메일을 보낼 수 있다. 지정이 없으면 예전처럼 본인 계정.
  · 보이는 발신자(From): **언제나 시스템 주소 하나**(TW_MAIL_FROM). 사람 주소는 절대
    From 에 넣지 않는다.
  · 답장(Reply-To)     : 사람이 한 일이면 그 사람, 시스템이 알리는 것이면 시스템 관리자.
  · 반송(Return-Path)  : 항상 로그인 계정. 시스템 주소에 사서함이 없어도 배달 실패
    통지가 사라지지 않는다.
  · 항상 참조(Cc)      : TW_MAIL_ALWAYS_CC. 앱이 내보내는 모든 메일을 그 주소가 함께
    받는다(보낸 사람이거나 받는 사람이면 넣지 않는다).
사내 메일 서버가 From 을 검사하지 않아 가능한 구성이다(실측 2026-08-25). O365 였다면
인증 계정과 다른 From 은 5.7.60 으로 거부된다.

**왜 From 을 고정하는가** — 한동안 사람이 누른 메일은 그 사람 주소로 내보냈다. 받는
쪽은 그 사람이 직접 쓴 메일로 읽었고, 실제로는 앱이 보낸 것이라 혼선이 컸다
(2026-08-25 사용자 지적). 누가 처리했는지는 Reply-To 와 본문 끝 서명이 전한다.

시스템 주소는 **회사 도메인 안**이어야 한다. 다른 도메인(twautomation.com 등)을 쓰면
사외 수신 서버의 DMARC 정렬에 걸려 스팸 처리되거나 거부된다 — 그 도메인은 우리 것도
아니다(2026-08-25 DNS 확인: Afternic 매물 · null MX · SPF -all).

주소만 등록하고 앱 비밀번호는 비워 둘 수 있다 — 로그인은 공용 계정이 한다. 사람 주소는
Reply-To 와 수신자 목록(admin_emails 등)에 쓰인다.
자격증명이 하나도 없으면 (False, 사유) 반환 → 호출부에서 안내.

TW_MAIL_FROM 을 두지 않으면 보내는 계정(user_id) 명의로 나가고, 그 사람 이름 서명이 붙는다.
이 앱이 보내는 메일은 모두 시스템 안내다(SB 검토 요청 · 회원가입 · 계정 알림).
"""
from __future__ import annotations

import os
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage

from app import shadow as _shadow
from app.database import get_session
from app.models import MailCredential, User
from app.security import decrypt_secret


@dataclass
class SendIdentity:
    email: str
    password: str
    host: str
    port: int


def _smtp_host_for(pop_server: str) -> str:
    # 명시 override(USER_SMTP_HOST)가 있으면 최우선.
    override = os.getenv("USER_SMTP_HOST", "").strip()
    if override:
        return override
    p = (pop_server or "").strip()
    pl = p.lower()
    if "office365" in pl or "outlook" in pl:
        return "smtp.office365.com"
    for pre in ("pop3.", "pop.", "imap."):
        if pl.startswith(pre):
            return "smtp." + p[len(pre):]
    # 그 외(자체 메일서버 등): POP 과 동일 호스트를 SMTP 로 사용
    # (예: mail.pointmobile.com POP3/SMTP 겸용). 빈 값이면 O365 로 폴백.
    return p or "smtp.office365.com"


def get_send_identity(user_id: int) -> "SendIdentity | None":
    """사용자의 메일 자격증명 → SMTP 발송 신원. 미등록/복호화 실패 시 None."""
    with get_session() as db:
        c = db.query(MailCredential).filter_by(user_id=user_id).first()
        if c is None or not c.email_address or not c.encrypted_password:
            return None
        try:
            pw = decrypt_secret(c.encrypted_password)
        except Exception:  # noqa: BLE001
            return None
        if not pw:
            return None
        return SendIdentity(
            email=c.email_address.strip(), password=pw,
            host=_smtp_host_for(c.pop_server),
            port=int(os.getenv("USER_SMTP_PORT", "587") or "587"),
        )


def system_from() -> tuple[str, str, str]:
    """시스템 명의 발신 설정 — (보이는 주소, 표시 이름, 답장 받을 주소).

    보이는 주소가 비어 있으면 예전 그대로 **보내는 사람 = 로그인 사용자**로 나간다.
    설정해 두면 시스템 안내 메일의 From 만 그 주소로 보이고, SMTP 로그인·반송 주소
    (Return-Path)는 여전히 실제 계정이다. 사내 메일 서버가 From 을 검사하지 않아
    가능한 방식이다 (O365 였다면 5.7.60 으로 거부된다 — 실측 2026-08-25).

    답장 받을 주소(Reply-To)를 비워 두면 시스템 관리자에게 간다. 시스템 주소는 사서함이
    없을 수도 있어서(2026-08-25 기준 tw.auto 는 아직 없다), 답장이 갈 곳을 사람 주소로
    두지 않으면 회신이 반송된다.
    """
    return (os.getenv("TW_MAIL_FROM", "").strip(),
            os.getenv("TW_MAIL_FROM_NAME", "").strip() or "Solution Buffer",
            os.getenv("TW_MAIL_REPLY_TO", "").strip())


def always_cc() -> list[str]:
    """앱이 보내는 **모든** 메일에 참조로 넣을 주소. TW_MAIL_ALWAYS_CC (쉼표 구분).

    보낸 사람이거나 받는 사람이면 넣지 않는다 — 같은 메일이 두 통 오는 일을 막는다.
    설정이 없으면 빈 목록이라 예전과 같다.
    """
    raw = os.getenv("TW_MAIL_ALWAYS_CC", "")
    out: list[str] = []
    for part in raw.replace(";", ",").split(","):
        a = part.strip()
        if a and "@" in a and a.lower() not in [x.lower() for x in out]:
            out.append(a)
    return out


def relay_identity(fallback_user_id: int | None = None) -> "SendIdentity | None":
    """**모든 메일이 실제로 로그인할 계정**. TW_MAIL_ACCOUNT 로 지정한다.

    계정 이름('damon.park')이든 메일 주소든 받는다. 이 값을 두면 사람마다 앱 비밀번호를
    등록하지 않아도 앱이 메일을 보낼 수 있다 — 보이는 발신자(From)는 send_as_user 가
    따로 정한다(언제나 시스템 주소 하나로 고정).

    지정이 없으면 fallback_user_id(=보내는 사람 본인) 계정을 쓴다 — 예전 그대로다.
    """
    key = os.getenv("TW_MAIL_ACCOUNT", "").strip()
    if not key:
        return get_send_identity(fallback_user_id) if fallback_user_id else None
    with get_session() as db:
        uid = (
            db.query(MailCredential.user_id)
            .filter(MailCredential.email_address == key).scalar()
            or db.query(User.id).filter(User.username == key).scalar()
        )
    return get_send_identity(uid) if uid else None


def _email_from_username(username: str) -> str:
    """로그인 아이디에서 메일 주소를 얻는다. 없으면 ''.

    ① 아이디 자체가 메일 주소인 계정이 많다(brandon.ha@pointmobile.com).
    ② 아니면 **사내 인원 명부**에서 아이디를 앞자리로 가진 주소를 찾는다
       (damon.park → damon.park@pointmobile.com). 규칙으로 지어내지 않고 등록된
       주소에서만 찾는다 — 없는 주소를 만들면 회신이 반송된다.
    """
    name = (username or "").strip()
    if not name:
        return ""
    if "@" in name:
        return name
    from app.staff import list_staff

    low = name.lower()
    for s in list_staff():
        addr = str(s.get("email") or "").strip()
        if addr and addr.split("@", 1)[0].lower() == low:
            return addr
    return ""


def sender_profile(user_id: int) -> tuple[str, str, str]:
    """그 사람 명의로 보낼 때 쓸 (주소, 표시 이름, 서명). 주소를 못 찾으면 ('', 이름, '').

    앱 비밀번호가 없어도 그 사람 명의로 나갈 수 있다 — 로그인은 공용 계정
    (relay_identity)이 하기 때문이다. 주소는 등록해 둔 것 → 아이디 순으로 찾는다.
    """
    with get_session() as db:
        c = db.query(MailCredential).filter_by(user_id=user_id).first()
        u = db.query(User).filter_by(id=user_id).first()
        addr = (c.email_address or "").strip() if c else ""
        sig = ((getattr(c, "signature_html", "") or "").strip() if c else "")
        uname = u.username if u else ""
    addr = addr or _email_from_username(uname)
    name = display_name_for(addr) or uname
    return addr, name, (sig or (name_signature(addr) if addr else ""))


def user_email(user_id: int) -> str:
    """사용자의 메일 주소 — 등록해 둔 것이 없으면 아이디에서 찾는다. 없으면 ''."""
    with get_session() as db:
        c = db.query(MailCredential).filter_by(user_id=user_id).first()
        if c and c.email_address:
            return c.email_address.strip()
        u = db.query(User).filter_by(id=user_id).first()
        if u and (u.email or "").strip():          # 회원가입 때 받은 주소
            return u.email.strip()
        uname = u.username if u else ""
    return _email_from_username(uname)


def _role_emails(*roles: str, exclude_username: str = "") -> list[str]:
    """해당 역할 사용자들의 메일 주소 — **등록해 둔 것이 없으면 아이디에서 찾는다**.

    자격증명(MailCredential)이 있는 사람만 고르면 아이디가 메일 주소인 계정조차
    수신자에서 빠진다. 중복 주소는 한 번만 남긴다.
    """
    with get_session() as db:
        q = db.query(User.id, User.username).filter(User.role.in_(roles), User.status == "approved")
        if exclude_username:
            q = q.filter(User.username != exclude_username)
        rows = q.order_by(User.id).all()
    out: list[str] = []
    seen: set[str] = set()
    for uid, uname in rows:
        addr = user_email(uid) or _email_from_username(uname)
        low = addr.lower()
        if addr and low not in seen:
            seen.add(low)
            out.append(addr)
    return out


def system_sender_user_id() -> int | None:
    """시스템 안내 메일을 어느 계정 앞으로 돌릴지. 없으면 None.

    보이는 발신자는 어차피 시스템 주소라 이 값은 로그인·기록용이다. 공용 발송 계정
    (TW_MAIL_ACCOUNT)을 먼저 찾고, 없으면 자격증명이 있는 관리자를 쓴다.
    예전에는 부르는 곳마다 '자격증명 있는 사용자'를 따로 뒤졌는데, 개인 등록이 필요
    없어진 지금은 그 조회들이 **보낼 수 있는데도 못 보낸다고** 막아설 뿐이다.
    """
    key = os.getenv("TW_MAIL_ACCOUNT", "").strip()
    with get_session() as db:
        if key:
            uid = (db.query(MailCredential.user_id)
                   .filter(MailCredential.email_address == key).scalar()
                   or db.query(User.id).filter(User.username == key).scalar())
            if uid:
                return uid
        row = (db.query(User.id)
               .join(MailCredential, MailCredential.user_id == User.id)
               .filter(MailCredential.encrypted_password != "")
               .order_by(User.role != "admin", User.id).first())
    return row[0] if row else None


def admin_emails() -> list[str]:
    """시스템 관리자(role=admin) 이메일 목록."""
    return _role_emails("admin")


def system_admin_emails() -> list[str]:
    """시스템 관리자 이메일 — **공용 'admin' 계정은 뺀다**.

    admin 은 여러 사람이 함께 쓰는 계정이라, 개인이 처리해야 할 안내가 묻힌다.
    비밀번호 초기화 요청처럼 사람이 손을 대야 하는 건은 실제 담당자에게만 보낸다
    (사용자 확정 2026-08-19).
    """
    return _role_emails("admin", exclude_username="admin")


def app_url() -> str:
    """안내 메일에 싣는 서비스 주소. 배포처가 바뀌면 TW_APP_URL 로 덮는다."""
    import os

    return os.getenv("TW_APP_URL", "http://192.168.121.35:3070").rstrip("/")


#: 사내 메일의 본문 서식 — Outlook 이 만든 회신 메일의 <style> 블록을 그대로 옮겼다.
#: 맑은 고딕 10pt 가 사내 표준 본문 서체다(사용자 확정 2026-08-19).
_MAIL_CSS = "\n".join([
    "p.MsoNormal, li.MsoNormal, div.MsoNormal",
    "   {margin:0cm; text-align:justify; text-justify:inter-ideograph;",
    "    text-autospace:none; word-break:break-hangul;",
    '    font-size:10.0pt; font-family:"맑은 고딕";}',
    "body, div.WordSection1, table, td, p, li, span",
    '   {font-size:10.0pt; font-family:"맑은 고딕";}'
    ,
    "a:link, span.MsoHyperlink",
    "   {color:#467886; text-decoration:underline;}",
])

def _esc(s: str) -> str:
    from html import escape

    return escape(s or "", quote=False)


def _text_to_html(text: str) -> str:
    """평문 → <p class=MsoNormal> 줄들. 빈 줄은 Outlook 처럼 &nbsp; 한 줄로 둔다."""
    out = []
    for line in (text or "").split("\n"):
        s = line.rstrip()
        if not s.strip():
            out.append("<p class=MsoNormal><o:p>&nbsp;</o:p></p>")
            continue
        # 앞 공백은 화면에서 살려 준다(들여쓴 주소 줄 등).
        lead = len(s) - len(s.lstrip())
        out.append("<p class=MsoNormal>"
                   + "&nbsp;" * lead + _esc(s.strip())
                   + "</p>")
    return "\n".join(out)


def build_html_mail(body: str, *, signature: str = "") -> str:
    """평문 본문 + (서명) → 사내 서식의 HTML 메일 한 통."""
    parts = [_text_to_html(body)]
    if (signature or "").strip():
        parts += ["<p class=MsoNormal><o:p>&nbsp;</o:p></p>",
                  signature if "<" in signature else _text_to_html(signature)]
    return ('<html><head><meta http-equiv="Content-Type" '
            'content="text/html; charset=utf-8"><style><!--\n'
            + _MAIL_CSS
            + '\n--></style></head><body lang=KO><div class=WordSection1>\n'
            + "\n".join(parts)
            + "\n</div></body></html>")


def html_to_text(doc: str) -> str:
    """HTML 조각 → 평문. 평문판에도 서명이 남아야 해서 쓴다(정교할 필요는 없다)."""
    import re as _re
    from html import unescape

    nl = chr(10)
    s = _re.sub(r"<(br|/p|/div|/tr)[^>]*>", nl, doc or "", flags=_re.I)
    s = _re.sub(r"<[^>]+>", "", s)
    s = unescape(s).replace(chr(160), " ")
    return nl.join(x.rstrip() for x in s.splitlines()).strip()


def display_name_for(email: str) -> str:
    """보내는 사람 표시 이름. 사내 인원 명부에 있으면 그 이름, 없으면 주소에서 만든다.

    damon.park@pointmobile.com -> Damon Park
    """
    addr = (email or "").strip()
    if not addr:
        return ""
    try:
        from app.models import Staff

        with get_session() as db:
            row = (db.query(Staff)
                   .filter(Staff.email.ilike(addr))
                   .first())
        if row and (row.name or "").strip():
            return row.name.strip()
    except Exception:  # noqa: BLE001  (명부가 없어도 서명은 나가야 한다)
        pass
    local = addr.split("@", 1)[0]
    return " ".join(w.capitalize() for w in local.replace("_", ".").split(".") if w)


def name_signature(email: str) -> str:
    """서명 — 이름 한 줄만 파란 글자로(사용자 확정 2026-08-19).

    사람마다 다른 Outlook 서명을 그대로 가져올 방법이 없고(각자 PC 에 있다),
    서명 자체가 중요한 요소는 아니라 이름만 남긴다. 색은 사내 서명이 쓰는 남색.
    """
    name = display_name_for(email)
    if not name:
        return ""
    return ("<p class=MsoNormal><b><span style='color:#376092'>"
            + name + "</span></b></p>")


def send_as_user(user_id: int, to: "list[str] | str", subject: str, body: str) -> tuple[bool, str]:
    """시스템 안내 메일 발송. 반환 (성공, 오류사유). 자격증명 미등록이면 (False, 안내).

    SMTP 로그인은 공용 계정(TW_MAIL_ACCOUNT) 하나로 한다 — 없으면 user_id 계정으로.
    보이는 발신자는 시스템 주소(TW_MAIL_FROM), 답장은 시스템 관리자에게 간다.
    시스템 주소를 정하지 않았으면 user_id 명의로 나가고 그 사람 이름 서명이 붙는다.
    """
    if _shadow.blocked("mail", "send", user_id=user_id, to=to, subject=subject, body=body):
        return True, ""
    from email.utils import formataddr, formatdate, make_msgid

    ident = relay_identity(user_id)
    if ident is None:
        return False, "발송 계정 미등록 — [계정 관리]에서 본인 이메일 자격증명을 등록하세요."
    tos = [to] if isinstance(to, str) else list(to)
    tos = [t.strip() for t in tos if t and t.strip()]
    if not tos:
        return False, "수신 주소가 비어 있습니다."

    # ── 보이는 발신자 ────────────────────────────────────────────────────────
    # **사람 주소는 From 에 넣지 않는다.** 앱이 보낸 메일을 그 사람이 직접 쓴 것으로
    # 읽어 혼선이 컸다(2026-08-25 사용자 지적).
    sys_from, sys_name, sys_reply = system_from()
    if sys_from:
        show_from, show_name, signature = sys_from, sys_name, ""
        # 시스템 주소에 사서함이 없을 수 있어 답장은 시스템 관리자가 받는다.
        reply_to = sys_reply or (system_admin_emails() or [ident.email])[0]
    else:
        # 시스템 주소를 정하지 않았으면 보내는 계정 명의로 나간다.
        pf_addr, pf_name, signature = sender_profile(user_id)
        show_from, show_name, reply_to = pf_addr or ident.email, pf_name, ""

    # 항상 참조 — 앱이 내보내는 모든 메일을 한 사람이 함께 받아 두게 한다.
    # 이미 보낸 사람이거나 받는 사람이면 넣지 않는다(같은 메일을 두 번 받게 된다).
    seen = {t.lower() for t in tos} | {show_from.lower()}
    cc_list = [a for a in always_cc() if a.lower() not in seen]

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((show_name, show_from)) if show_name else show_from
    msg["To"] = ", ".join(tos)
    if reply_to:
        msg["Reply-To"] = reply_to
    # Message-ID·Date 를 **직접** 단다. smtplib 도, 사내 메일 서버도 붙여 주지 않는다
    # (실측 2026-08-19, 수신함 원문 확인).
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain=(show_from.rpartition("@")[2] or None))
    if cc_list:
        msg["Cc"] = ", ".join(cc_list)   # send_message 가 To+Cc 모두에게 보낸다
    # 앱이 보낸 메일 표식 — 같은 사서함을 읽는 tw-next 의 수신 필터가 이걸 보고 신규 요청에서 뺀다.
    msg["X-TW-Automation"] = "1"
    plain = body
    if signature:
        plain = plain.rstrip() + chr(10) * 2 + html_to_text(signature)
    msg.set_content(plain)
    # 사내 메일과 같은 서식(맑은 고딕 10pt)으로 보이도록 HTML 판을 함께 싣는다
    # (사용자 지적 2026-08-19).
    msg.add_alternative(build_html_mail(body, signature=signature), subtype="html")

    try:
        with smtplib.SMTP(ident.host, ident.port, timeout=30) as s:
            s.ehlo()
            s.starttls()
            s.ehlo()
            s.login(ident.email, ident.password)
            # 봉투 발신자(Return-Path)는 **실제 계정**으로 둔다. From 만 시스템 주소로
            # 바꾸고 반송까지 그리로 보내면, 사서함이 없을 때 배달 실패 통지가 사라진다.
            s.send_message(msg, from_addr=ident.email)
        return True, ""
    except Exception as e:  # noqa: BLE001
        return False, f"SMTP 발송 실패: {e}"
