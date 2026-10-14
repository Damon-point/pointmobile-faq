# -*- coding: utf-8 -*-
"""앱이 보내는 메일의 **문구 모음**. 화면([설정] → 메일 문구)에서 고칠 수 있다.

여기 있는 것은 기본 문구다. 사람이 고치면 mail_templates 표에 그것만 저장되고, 고친
적이 없으면 기본 문구가 그대로 쓰인다. '기본값으로 되돌리기'는 저장된 행을 지우는 일이다.

문구 안의 {{이름}} 은 보낼 때 실제 값으로 바뀐다. 각 문구가 어떤 값을 받는지는 vars 에
적어 두었고, 편집 화면이 그 설명을 그대로 보여 준다. {{앱주소}}·{{문의주소}}·{{오늘}}
은 어느 문구에서나 쓸 수 있다(AUTO 참조).

**서명은 본문에 넣지 않는다.** 보낼 때 user_mailer 가 보내는 사람 이름을 뒤에 붙인다
(시스템 명의 메일은 서명이 없으므로, 그런 문구는 맺음말을 본문에 둔다).

문구를 고쳐도 **보내는 자리는 바뀌지 않는다** — 누구에게 언제 나가는지는 코드가 정한다.
아는 이름이 아닌 {{...}} 는 손대지 않고 그대로 둔다(오타 때문에 발송이 실패하지 않게).
저장할 때 편집 화면이 그런 이름을 짚어 준다.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime

from app.database import get_session
from app.models import MailTemplate

_VAR = re.compile(r"\{\{\s*([^{}\s]+)\s*\}\}")

#: 어느 문구에서나 쓸 수 있는 값. 보낼 때 자동으로 채워진다.
AUTO: dict[str, str] = {
    "앱주소": "Solution Buffer 주소 — 'http://192.168.121.35:3070'",
    "문의주소": "문의를 받을 시스템 관리자 메일 주소",
    "오늘": "보내는 날짜 — '2026-08-25'",
}


def auto_values() -> dict:
    from app.user_mailer import app_url, system_admin_emails

    admins = system_admin_emails()
    return {"앱주소": app_url(),
            "문의주소": admins[0] if admins else "",
            "오늘": datetime.now().strftime("%Y-%m-%d")}


@dataclass
class Tpl:
    key: str
    title: str                     # 화면에 보일 이름
    group: str                     # 묶음(WhiteList · 계정 · 알림 · 검수 · License)
    when: str                      # 언제 나가는가
    to: str                        # 누구에게 가는가
    subject: str
    body: str
    vars: dict[str, str] = field(default_factory=dict)   # 이름 -> 설명(예시)


TEMPLATES: dict[str, Tpl] = {}


def _add(t: Tpl) -> None:
    TEMPLATES[t.key] = t


_AUTO_NOTE = "이 메일은 Solution Buffer 가 자동 발송했습니다."

# ── 계정 ─────────────────────────────────────────────────────────────────────
_add(Tpl(
    key="signup_request", title="회원가입 승인 요청", group="계정",
    when="누군가 회원가입을 신청했을 때", to="시스템 관리자",
    subject="[Solution Buffer] 회원가입 승인 요청 — {{회사}} {{아이디}}",
    body=(
        "Solution Buffer 회원가입 신청이 들어왔습니다.\n"
        "\n"
        "{{정보표}}\n"
        "▶ [설정 → 계정] 에서 승인하거나 반려해 주십시오.\n"
        "  {{계정관리주소}}\n"
        "\n"
        "승인하면 신청자에게 로그인 안내 메일이, 반려하면 사유가 담긴 메일이 나갑니다.\n"
        "\n"
        + _AUTO_NOTE
    ),
    vars={"회사": "신청한 회사명", "아이디": "신청한 ID",
          "정보표": "회사 · 이메일 · ID · 신청 시각 상자", "계정관리주소": "앱의 [설정 → 계정] 주소"},
))

_add(Tpl(
    key="signup_approved", title="회원가입 승인 안내", group="계정",
    when="관리자가 가입을 승인했을 때", to="신청자",
    subject="[Solution Buffer] 회원가입이 승인되었습니다",
    body=(
        "안녕하십니까.\n"
        "신청하신 Solution Buffer 회원가입이 승인되었습니다.\n"
        "\n"
        "{{정보표}}\n"
        "위 주소에서 신청하신 ID 와 비밀번호로 로그인하실 수 있습니다.\n"
        "\n"
        "사용 중 문의는 이 메일에 회신해 주시기 바랍니다.\n"
        "\n"
        + _AUTO_NOTE
    ),
    vars={"정보표": "서비스 주소 · 회사 · ID 상자"},
))

_add(Tpl(
    key="signup_rejected", title="회원가입 반려 안내", group="계정",
    when="관리자가 가입을 반려했을 때", to="신청자",
    subject="[Solution Buffer] 회원가입 신청 결과 안내",
    body=(
        "안녕하십니까.\n"
        "신청하신 Solution Buffer 회원가입은 아래 사유로 승인되지 않았습니다.\n"
        "\n"
        "{{정보표}}\n"
        "사유: {{사유}}\n"
        "\n"
        "내용을 고쳐 같은 ID 로 다시 신청하실 수 있습니다.\n"
        "\n"
        + _AUTO_NOTE
    ),
    vars={"정보표": "회사 · ID 상자", "사유": "관리자가 적은 반려 사유"},
))

_add(Tpl(
    key="account_reset", title="비밀번호 초기화 안내", group="계정",
    when="관리자가 비밀번호를 초기화한 직후", to="그 계정의 주인",
    subject="[Solution Buffer] 비밀번호가 초기화되었습니다",
    body=(
        "안녕하십니까.\n"
        "요청하신 대로 Solution Buffer 비밀번호를 초기화했습니다.\n"
        "\n"
        "{{정보표}}\n"
        "다음 로그인 때 비밀번호 변경 화면이 먼저 열립니다.\n"
        "위 초기 비밀번호는 임시 값이므로, 본인만 아는 비밀번호로 바꾸신 뒤\n"
        "이용해 주시기 바랍니다.\n"
        "\n"
        "본인이 요청하지 않으셨다면 다른 사람이 초기화를 요청했을 수 있습니다.\n"
        "이 메일에 회신해 바로 알려 주시기 바랍니다.\n"
        "\n"
        + _AUTO_NOTE
    ),
    vars={"정보표": "서비스 주소·아이디·초기 비밀번호를 줄맞춤한 상자"},
))

_add(Tpl(
    key="account_forgot", title="비밀번호 초기화 요청 알림", group="계정",
    when="로그인 화면에서 '비밀번호를 잊으셨나요?' 를 눌렀을 때", to="시스템 관리자",
    subject="[Solution Buffer][비밀번호 초기화 요청] {{아이디}}",
    body=(
        "로그인 화면에서 비밀번호 초기화 요청이 접수되었습니다.\n"
        "\n"
        "{{정보표}}\n"
        "▶ [계정 관리] 에서 해당 계정의 [비밀번호 초기화] 를 눌러 주시기 바랍니다.\n"
        "  {{계정관리주소}}\n"
        "\n"
        "  초기화하면 초기 비밀번호로 되돌아가고, 본인에게 안내 메일이 자동으로\n"
        "  발송됩니다. 다음 로그인 때 비밀번호 변경 화면이 먼저 열립니다.\n"
        "\n"
        "요청한 사람에게는 계정이 있는지 없는지 알리지 않았습니다.\n"
        "위 '계정 존재' 가 '아니오' 라면 아이디를 떠보는 시도일 수 있으니,\n"
        "초기화하지 마시고 그대로 두시기 바랍니다.\n"
        "\n"
        + _AUTO_NOTE
    ),
    vars={"아이디": "요청에 쓰인 아이디", "정보표": "아이디·요청 시각·계정 존재 여부 상자",
          "계정관리주소": "앱의 [계정 관리] 주소"},
))


# ── 자동 알림 ────────────────────────────────────────────────────────────────


_add(Tpl(
    key="sb_review", title="Solution Buffer 검토 요청", group="자동 알림",
    when="Redmine 이슈가 Resolved 되어 초안을 만들었을 때", to="이슈 담당자 (없으면 관리자)",
    subject="[Solution Buffer] SB 업로드 문서 검토 요청 — #{{이슈번호}} {{문서제목}}",
    body=(
        "{{담당자}} 님,\n"
        "\n"
        "담당하신 Redmine 이슈 #{{이슈번호}} 가 Resolved 되어, Solution Buffer 에\n"
        "올릴 문서 초안을 자동으로 작성했습니다.\n"
        "\n"
        "{{정보표}}{{대신보냄}}\n"
        "────────────────────────────────────────────────────────\n"
        "아래 주소로 로그인하시면 Solution Buffer 첫 화면에 본인 담당 문서만 모여 있습니다.\n"
        "  {{화면주소}}\n"
        "\n"
        "  1. 제목·공개 등급·본문을 확인하고 필요하면 고칩니다.\n"
        "     (등급을 바꾸면 Confluence 템플릿과 라벨도 따라 바뀝니다)\n"
        "  2. [미리보기·검증] 으로 실제 올라갈 모습을 확인합니다.\n"
        "  3. [업로드] 를 누르면 그때 Confluence 에 반영됩니다.\n"
        "\n"
        "누르지 않으면 초안으로만 남고 Confluence 에는 아무것도 올라가지 않습니다.\n"
        "올릴 필요가 없는 내용이면 [폐기] 로 정리해 주세요.\n"
        "────────────────────────────────────────────────────────\n"
        "\n"
        "초안은 이슈 내용을 바탕으로 만든 것이라 사실관계와 표현을 꼭 확인해\n"
        "주셔야 합니다. 고객에게 공개되는 문서입니다.\n"
        "\n"
        + _AUTO_NOTE
    ),
    vars={"담당자": "이슈 담당자 이름", "이슈번호": "Redmine 이슈 번호",
          "문서제목": "만든 문서 제목",
          "정보표": "이슈·문서 제목·추천 등급·Applies to (개정판이면 개정 줄까지)",
          "대신보냄": "담당자 주소를 못 찾아 관리자에게 보낼 때의 안내(아니면 비어 있음)",
          "화면주소": "[Solution Buffer] 화면 주소"},
))

# ── 저장·읽기 ────────────────────────────────────────────────────────────────
def groups() -> list[str]:
    out: list[str] = []
    for t in TEMPLATES.values():
        if t.group not in out:
            out.append(t.group)
    return out


def get(key: str) -> dict:
    """{key, title, …, subject, body, edited} — 고친 것이 있으면 그것."""
    t = TEMPLATES.get(key)
    if t is None:
        return {}
    subject, body, edited, by, at = t.subject, t.body, False, "", None
    with get_session() as db:
        row = db.query(MailTemplate).filter_by(key=key).first()
        if row is not None:
            subject, body, edited = row.subject, row.body, True
            by, at = row.updated_by, row.updated_at
    return {"key": key, "title": t.title, "group": t.group, "when": t.when, "to": t.to,
            "subject": subject, "body": body, "vars": dict(t.vars), "auto": dict(AUTO),
            "default_subject": t.subject, "default_body": t.body,
            "edited": edited, "updated_by": by, "updated_at": at}


def save(key: str, subject: str, body: str, actor: str = "") -> tuple[bool, str]:
    if key not in TEMPLATES:
        return False, "없는 문구입니다."
    if not (subject or "").strip():
        return False, "제목을 비워 둘 수 없습니다."
    if not (body or "").strip():
        return False, "본문을 비워 둘 수 없습니다."
    with get_session() as db:
        row = db.query(MailTemplate).filter_by(key=key).first()
        if row is None:
            row = MailTemplate(key=key)
            db.add(row)
        row.subject, row.body, row.updated_by = subject, body, actor
        db.commit()
    return True, "저장했습니다."


def reset(key: str) -> tuple[bool, str]:
    """고친 것을 지워 기본 문구로 되돌린다."""
    with get_session() as db:
        row = db.query(MailTemplate).filter_by(key=key).first()
        if row is None:
            return True, "이미 기본 문구입니다."
        db.delete(row)
        db.commit()
    return True, "기본 문구로 되돌렸습니다."


def _known(key: str) -> set:
    t = TEMPLATES.get(key)
    return set((t.vars if t else {}).keys()) | set(AUTO.keys())


def unknown_vars(key: str, subject: str, body: str) -> list[str]:
    """문구에 쓰였지만 값이 채워지지 않는 이름들. 저장 전에 짚어 주기 위한 것."""
    used = set(_VAR.findall(subject or "")) | set(_VAR.findall(body or ""))
    return sorted(used - _known(key))


def missing_vars(key: str, subject: str, body: str) -> list[str]:
    """이 문구만의 값인데 문구에서 빠진 이름들. 지워도 되지만 알려는 준다.

    어디서나 쓸 수 있는 값(AUTO)은 안 써도 이상할 것이 없으므로 세지 않는다.
    """
    t = TEMPLATES.get(key)
    used = set(_VAR.findall(subject or "")) | set(_VAR.findall(body or ""))
    return sorted(set((t.vars if t else {}).keys()) - used)


def fill(text: str, values: dict) -> str:
    """{{이름}} 을 값으로 바꾼다. 모르는 이름은 **그대로 둔다**."""
    def sub(m):
        name = m.group(1)
        return str(values[name]) if name in values else m.group(0)

    return _VAR.sub(sub, text or "")


def render(key: str, **values) -> tuple[str, str]:
    """(제목, 본문). 고친 문구가 있으면 그것으로 만든다."""
    cur = get(key)
    if not cur:
        return "", ""
    vals = dict(auto_values())
    vals.update(values)                      # 부르는 쪽 값이 우선
    return fill(cur["subject"], vals), fill(cur["body"], vals)


def sample(key: str) -> dict:
    """미리보기용 예시 값 — 설명에서 따옴표 안의 예시를 뽑아 쓰고, 없으면 이름을 쓴다."""
    t = TEMPLATES.get(key)
    out: dict[str, str] = {}
    for name, desc in list((t.vars if t else {}).items()) + list(AUTO.items()):
        m = re.search(r"'([^']*)'", desc or "")
        out[name] = m.group(1) if m else f"({name})"
    out.update(auto_values())                # 앱주소·문의주소·오늘은 실제 값으로
    return out
