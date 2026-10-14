"""데이터 모델(public 스키마) — 이슈·SB 문서는 app/issuetrack/models.py.

User          : 로그인 계정
MailCredential: 메일 발송 계정(비밀번호는 암호화 저장)
WebCredential : Redmine · Confluence 로그인(공용 — admin 계정 행)
Staff         : 사내 인원 명부(Redmine 작성자 → 이름·팀, 담당자 주소)
MailTemplate  : 메일 문구(SB 검토 요청 등)
AppSetting    : 화면에서 바꾸는 설정(Claude 경로 · 검증 모드)
"""
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(20), default="user")  # "admin" | "user"
    #: 첫 로그인에서 비밀번호를 바꿔야 하는가. 관리자가 계정을 만들면 초기 비밀번호가
    #: 공통값(1234)이라 그대로 두면 누구나 아는 비밀번호로 남는다. 그래서 새 계정은
    #: 이 표시를 달고 나가고, 본인이 바꾸기 전까지 다른 화면으로 갈 수 없다.
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    #: 회원가입 — pending(승인 대기) · approved(승인) · rejected(반려). 승인된 계정만 로그인한다.
    #: 가입 기능 전에 있던 계정은 approved 로 둔다.
    status: Mapped[str] = mapped_column(String(20), default="approved", index=True)
    #: 회원가입 때 받는 것 — 회사명 · 이메일(알림 · 승인 결과를 받는 곳). 로그인은 username(ID)으로 한다.
    company: Mapped[str] = mapped_column(String(120), default="")
    email: Mapped[str] = mapped_column(String(200), default="", index=True)
    requested_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    decided_by: Mapped[str] = mapped_column(String(80), default="")
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reject_reason: Mapped[str] = mapped_column(Text, default="")

    credential: Mapped["MailCredential | None"] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )


class MailCredential(Base):
    __tablename__ = "mail_credentials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True
    )
    email_address: Mapped[str] = mapped_column(String(200))
    # Fernet 로 암호화된 앱 비밀번호 (평문 저장 금지)
    encrypted_password: Mapped[str] = mapped_column(Text)
    pop_server: Mapped[str] = mapped_column(String(200), default="outlook.office365.com")
    pop_port: Mapped[int] = mapped_column(Integer, default=995)
    use_ssl: Mapped[bool] = mapped_column(Boolean, default=True)
    #: 이 사람의 메일 서명(Outlook 에서 복사해 붙인 HTML 그대로).
    #: 사람마다 직함·연락처가 달라 양식을 만들어 주는 대신 쓰던 것을 그대로 쓴다
    #: (사용자 확정 2026-08-19).
    signature_html: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    user: Mapped["User"] = relationship(back_populates="credential")


class WebCredential(Base):
    """브라우저 자동화용 웹 편집 계정 (Confluence 페이지 / 네이버 등).

    세션이 만료되면 저장된 username/password 로 자동 재로그인한다.
    로그인/편집 셀렉터는 사이트마다 달라 컬럼으로 저장(설정에서 튜닝 가능).
    """

    __tablename__ = "web_credentials"
    __table_args__ = (
        UniqueConstraint("user_id", "target", name="uq_web_user_target"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    target: Mapped[str] = mapped_column(String(30))  # confluence / naver
    base_url: Mapped[str] = mapped_column(String(500), default="")
    login_url: Mapped[str] = mapped_column(String(500), default="")  # 비우면 base_url 사용
    username: Mapped[str] = mapped_column(String(200), default="")
    encrypted_password: Mapped[str] = mapped_column(Text, default="")
    # 편집 흐름 셀렉터 (기본값 = Confluence 클래식)
    edit_url_template: Mapped[str] = mapped_column(
        String(500), default="{base}/pages/editpage.action?pageId={page_id}"
    )
    editor_iframe_sel: Mapped[str] = mapped_column(String(200), default="#wysiwygTextarea_ifr")
    save_button_sel: Mapped[str] = mapped_column(String(200), default="#rte-button-publish")
    # 로그인 폼 셀렉터
    username_sel: Mapped[str] = mapped_column(String(200), default="#os_username")
    password_sel: Mapped[str] = mapped_column(String(200), default="#os_password")
    submit_sel: Mapped[str] = mapped_column(String(200), default="#loginButton")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class Staff(Base):
    """사내 인원 명부 — **메일을 보내오는 사람**을 관리자가 직접 관리한다.

    로그인 계정(User)과 별개다. 대부분의 직원은 앱 계정이 없고, 우리는 그 사람이
    보낸 메일을 어떻게 다룰지만 알면 된다.

    이 명부가 예전에 흩어져 있던 두 목록을 대신한다:
      · is_dqa      → DQA FOTA 테스트 전용 처리 대상(예전: work/whitelist_dqa_senders.json)
      · is_handler  → 화이트리스트 처리 담당. 이 사람이 보낸 메일은 **완료 안내·회신**이라
                      신규 요청 목록에서 뺀다(예전: mail_filter.EXCLUDED_SENDERS 하드코딩)

    status 는 표시용이다. 퇴사했다고 역할을 자동으로 끄지 않는다 — 메일함에는 과거
    메일이 남아 있어서, 재직 중 보낸 요청은 계속 맞게 분류돼야 한다. 끄거나 지우는
    것은 관리자가 판단한다(사용자 확정 2026-08-06).
    """

    __tablename__ = "staff"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), default="")
    email: Mapped[str] = mapped_column(String(200), default="", unique=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="재직")   # 재직 · 퇴사
    is_dqa: Mapped[bool] = mapped_column(Boolean, default=False)
    is_handler: Mapped[bool] = mapped_column(Boolean, default=False)
    team: Mapped[str] = mapped_column(String(80), default="")
    memo: Mapped[str] = mapped_column(Text, default="")
    updated_by: Mapped[str] = mapped_column(String(80), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class MailTemplate(Base):
    """앱이 보내는 메일의 **문구**. 사람이 고쳐 쓰는 자리다.

    기본 문구는 코드(app/mail_templates.py)에 있고 여기에는 **고친 것만** 남는다.
    행이 없으면 기본 문구를 쓴다 — 그래서 '기본값으로 되돌리기'는 행을 지우는 일이다.
    """

    __tablename__ = "mail_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    subject: Mapped[str] = mapped_column(Text, default="")
    body: Mapped[str] = mapped_column(Text, default="")
    updated_by: Mapped[str] = mapped_column(String(80), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class AppSetting(Base):
    """앱 전체에 걸리는 **사람이 내린 결정**. 열쇠가 아니라 '어떻게 돌 것인가' 다.

    자격증명은 저마다 전용 표가 있고, 회차별 작업물은 work/ 에 있다. 여기 남는 것은
    그 둘 어디에도 속하지 않는 한 줄짜리 설정이다 — 지금은 Claude 를 구독으로 부를지
    API 열쇠로 부를지 하나뿐이다.

    env 는 '처음 켤 때의 기본', 이 표는 '사람이 화면에서 내린 결정' 으로 본다.
    한 번 화면에서 바꾸면 env 를 고쳐도 바뀌지 않는다(app/app_settings.py).
    """

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")
    updated_by: Mapped[str] = mapped_column(String(80), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class SignupEmailCode(Base):
    """회원가입 이메일 인증 — 주소마다 한 줄. 인증번호는 원문을 두지 않고 해시만 둔다.

    인증에 성공하면 짧게 쓰는 확인 토큰(token_hash)을 발급하고, 가입 신청이 그 토큰을 내야 통과한다.
    재발송 · 시도 횟수 제한에 쓰는 시각과 횟수도 여기 둔다.
    """

    __tablename__ = "signup_email_codes"

    email: Mapped[str] = mapped_column(String(200), primary_key=True)   # 소문자로 맞춘 주소
    code_hash: Mapped[str] = mapped_column(String(128), default="")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    sent_count: Mapped[int] = mapped_column(Integer, default=0)            # 한 시간 창 안의 발송 수
    window_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    token_hash: Mapped[str] = mapped_column(String(128), default="")
