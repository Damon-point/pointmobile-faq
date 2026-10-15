# -*- coding: utf-8 -*-
"""Claude 호출을 **구독 인증**으로 — 이 PC 의 Claude Code 를 불러 쓴다.

Claude.ai 구독은 `api.anthropic.com` 을 열어 주지 않는다. 대신 이 PC 에 깔린 Claude
Code 가 구독으로 인증돼 있고(`~/.claude/.credentials.json`), 화면 없이 부르는 길이 있다.

호출부(issuetrack/sb.py 의 초안 생성 · 설정의 [시험 호출])는

    resp = anthropic.Anthropic().messages.parse(model=…, system=…, messages=[…], output_format=…)

모양 그대로 둔다. `anthropic.Anthropic` 자리에 **같은 모양의 물건**을 끼워 넣는다(install).

**둘 다 쓴다. 고르는 것은 사람이다**(사용자 지시 2026-09-22).
[설정 → Claude] 에서 고르고, 그 값은 DB 에 남는다(app/app_settings.py).

    subscription  이 PC 의 Claude Code 를 부른다. API 요금이 들지 않는다 — 기본값
    api           api.anthropic.com 에 열쇠로 붙는다

**어느 쪽인지는 부를 때마다 본다.** 화면에서 바꾸면 그 다음 호출부터 바로 듣는다.

claude 명령이 없어도 **서버는 뜬다**. Claude 를 쓰는 단계만 까닭을 말하며 실패한다.

**열쇠를 Claude Code 에 물려주지 않는다.** 환경에 ANTHROPIC_API_KEY 가 보이면 Claude Code 가
그 열쇠로 붙어 구독이 아니라 API 로 계산된다(실측 2026-09-21). `call()` 이 벗겨서 부른다.

붙이는 인자에는 저마다 까닭이 있다(gs-automation 실측 2026-09-01).

    --system-prompt      Claude Code 의 기본 프롬프트를 우리 것으로 갈아 끼운다.
                         그냥 부르면 들어가는 말만 21,000 토큰이다
    --tools ""           연장을 주지 않는다. 이 호출은 글만 쓴다
    --safe-mode          CLAUDE.md · 스킬 · 훅 · MCP · 사용자 설정 전부 끔
    --strict-mcp-config  MCP 서버도 건너뜀

일하는 자리(cwd)는 **빈 폴더**로 못박는다 — 소스도 자격증명도 보이지 않게.
요청문은 **표준입력**으로 넘긴다. 윈도우 명령줄은 32,767자에서 끊긴다.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
from dataclasses import dataclass, field
from pathlib import Path

#: 일하는 자리. 빈 폴더다.
_BOX = Path(__file__).resolve().parent.parent.parent / "work" / "claude_box"
_BOX.mkdir(parents=True, exist_ok=True)
BOX = _BOX.resolve()

#: 기다릴 시간(초). 긴 이슈의 초안도 있어 넉넉히 둔다.
TIMEOUT = int(os.getenv("TW_CLAUDE_CLI_TIMEOUT", "600"))

#: 한 번에 몇 개까지 동시에 부를지. 프로세스를 띄우는 일이라 무한정은 곤란하다.
_GATE = threading.Semaphore(int(os.getenv("TW_CLAUDE_CLI_PARALLEL", "3")))

#: 모델 이름 → Claude Code 가 받는 별칭. 모르는 이름은 그대로 넘긴다.
_ALIAS = {"opus": "opus", "sonnet": "sonnet", "haiku": "haiku"}


def exe() -> str:
    """claude 명령이 어디 있는가. 없으면 빈 문자열."""
    return shutil.which("claude") or ""


def ready() -> bool:
    return bool(exe())


SUBSCRIPTION = "subscription"
API = "api"


def backend() -> str:
    """지금 어느 쪽으로 부르는가 — "subscription" 또는 "api".

    **부를 때마다** 본다. 사람이 화면에서 바꾸면 그 다음 호출부터 바로 듣는다.
    DB 를 못 읽는 상황(표가 아직 없는 첫 기동 등)에서도 예외를 올리지 않는다.
    """
    try:
        from app import app_settings

        return app_settings.get("claude_backend")
    except Exception:  # noqa: BLE001
        return SUBSCRIPTION


def model_alias(model: str) -> str:
    """'claude-sonnet-5' → 'sonnet'. 등급만 넘기고 판 선택은 CLI 에 맡긴다."""
    m = (model or "").lower()
    for key, alias in _ALIAS.items():
        if key in m:
            return alias
    return model or ""


# ── anthropic 응답 흉내 ────────────────────────────────────────────────────
@dataclass
class _Usage:
    input_tokens: int = 0
    output_tokens: int = 0


@dataclass
class _Block:
    type: str = "text"
    text: str = ""


@dataclass
class _Resp:
    """`messages.create()` 가 돌려주는 것과 **같은 자리**만 갖춘다.

    호출부가 쓰는 것은 `resp.content[*].text` · `resp.model` · `resp.usage` 뿐이다
    (app/usage.py 의 계측도 model·usage 만 본다).
    """
    content: list = field(default_factory=list)
    model: str = ""
    usage: _Usage = field(default_factory=_Usage)
    stop_reason: str = "end_turn"
    role: str = "assistant"
    type: str = "message"


def _text_of(content) -> str:
    """messages 의 content — 글자일 수도, 블록 목록일 수도 있다."""
    if isinstance(content, str):
        return content
    got = []
    for b in content or []:
        if isinstance(b, str):
            got.append(b)
        elif isinstance(b, dict) and b.get("type") == "text":
            got.append(str(b.get("text") or ""))
        else:
            t = getattr(b, "text", None)
            if t:
                got.append(str(t))
    return "\n".join(got)


def _prompt_of(messages) -> str:
    """주고받은 말 → 한 덩이 글. 단발 호출이라 역할 표시를 글로 남긴다."""
    parts = []
    for m in messages or []:
        role = (m.get("role") if isinstance(m, dict) else getattr(m, "role", "")) or "user"
        body = _text_of(m.get("content") if isinstance(m, dict)
                        else getattr(m, "content", ""))
        if not body.strip():
            continue
        parts.append(body if role == "user" and len(messages) == 1
                     else f"[{role}]\n{body}")
    return "\n\n".join(parts)


def call(system: str, prompt: str, model: str = "") -> tuple[str, _Usage, str]:
    """한 번 묻는다. (답 글, 사용량, 오류). 예외를 올리지 않는다."""
    path = exe()
    if not path:
        return "", _Usage(), "claude 명령을 찾지 못했습니다"
    BOX.mkdir(parents=True, exist_ok=True)

    cmd = [path, "-p", "--output-format", "stream-json", "--verbose",
           "--tools", "", "--safe-mode", "--strict-mcp-config"]
    if system:
        cmd += ["--system-prompt", system]
    alias = model_alias(model)
    if alias:
        cmd += ["--model", alias]

    env = dict(os.environ)
    env["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"] = "1"
    # **열쇠를 물려주지 않는다.** Claude Code 는 ANTHROPIC_API_KEY 가 보이면 그것으로
    # 붙는다 — 구독이 아니라 API 로 계산된다. 이 앱은 열쇠를 .env 에서 읽어 환경에
    # 얹어 두기 때문에 그대로 넘기면 구독을 쓰려고 만든 이 길이 도로 API 가 된다.
    for _k in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL",
               "ANTHROPIC_CUSTOM_HEADERS", "ANTHROPIC_MODEL"):
        env.pop(_k, None)
    with _GATE:
        try:
            pr = subprocess.run(
                cmd, cwd=str(BOX), input=prompt, capture_output=True, text=True,
                encoding="utf-8", errors="replace", env=env, timeout=TIMEOUT,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except subprocess.TimeoutExpired:
            return "", _Usage(), f"{TIMEOUT}초 안에 답하지 않았습니다"
        except Exception as e:  # noqa: BLE001
            return "", _Usage(), f"{type(e).__name__}: {e}"

    said, use, err = [], _Usage(), ""
    for line in (pr.stdout or "").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            d = json.loads(line)
        except ValueError:
            continue
        kind = d.get("type")
        if kind == "assistant":
            for c in ((d.get("message") or {}).get("content") or []):
                if c.get("type") == "text":
                    said.append(str(c.get("text") or ""))
        elif kind == "result":
            u = d.get("usage") or {}
            use = _Usage(int(u.get("input_tokens") or 0),
                         int(u.get("output_tokens") or 0))
            if d.get("is_error"):
                err = str(d.get("result") or "오류")
            # result 의 글이 더 온전하면 그것을 쓴다(assistant 줄이 쪼개져 올 때가 있다).
            _r = str(d.get("result") or "")
            if _r and len("".join(said)) < len(_r):
                said = [_r]
    text = "".join(said).strip()
    if not text and not err:
        err = (pr.stderr or "").strip()[:300] or "빈 응답"
    return text, use, err


class _Messages:
    """`client.messages` 자리. create() · parse() 만 있으면 된다."""

    def create(self, **kw):
        if backend() == API:                   # 사람이 API 를 골랐다 — 진짜 SDK 로
            return _real_anthropic()().messages.create(**kw)

        system = kw.get("system") or ""
        if not isinstance(system, str):
            system = _text_of(system)
        msgs = kw.get("messages") or []
        prompt = _prompt_of(msgs)
        model = str(kw.get("model") or "")

        text, use, err = call(system, prompt, model)
        if err and not text:
            raise RuntimeError(f"Claude Code 호출 실패: {err}")

        resp = _Resp(content=[_Block("text", text)], model=model, usage=use)
        try:                                   # 사용량 기록은 실패해도 답을 버리지 않는다
            from app import usage as _U

            _U.record(model, use)
        except Exception:  # noqa: BLE001
            pass
        return resp

    def parse(self, **kw):
        """구조화 출력(`output_format=<pydantic 모델>`) 흉내.

        진짜 SDK 는 스키마를 따로 넘겨 모델이 그 모양으로만 답하게 한다. 여기서는
        스키마를 **시스템 프롬프트에 실어** 같은 결과를 얻고, 받은 JSON 을 그 모델로
        검증해 `parsed_output` 에 담는다. 호출부(issuetrack/sb.py)는 차이를 모른다.
        """
        if backend() == API:                   # 사람이 API 를 골랐다 — 진짜 SDK 로
            return _real_anthropic()().messages.parse(**kw)
        fmt = kw.pop("output_format", None)
        if fmt is None:
            return self.create(**kw)
        try:
            schema = json.dumps(fmt.model_json_schema(), ensure_ascii=False)
        except Exception:  # noqa: BLE001
            schema = ""
        sys_txt = kw.get("system") or ""
        if not isinstance(sys_txt, str):
            sys_txt = _text_of(sys_txt)
        kw["system"] = (sys_txt + "\n\n[출력 형식] 아래 JSON 스키마에 맞는 **JSON 하나만** "
                        "답하세요. 설명·코드 울타리 없이 JSON 만.\n" + schema)

        resp = self.create(**kw)
        text = "".join(getattr(b, "text", "") for b in resp.content)
        obj = _json_of(text)
        if not obj:
            raise RuntimeError("구조화 출력을 읽지 못했습니다(JSON 이 아닙니다)")
        resp.parsed_output = fmt.model_validate(obj)
        resp.stop_details = ""
        return resp


def _json_of(text: str) -> dict:
    """답에서 JSON 한 덩이를 꺼낸다. ```json 울타리도 벗긴다."""
    s = (text or "").strip()
    if "```" in s:
        for one in s.split("```"):
            one = one.strip()
            if one.lower().startswith("json"):
                one = one[4:].strip()
            if one.startswith("{"):
                s = one
                break
    a, b = s.find("{"), s.rfind("}")
    if a < 0 or b <= a:
        return {}
    try:
        return json.loads(s[a:b + 1])
    except ValueError:
        return {}


class Client:
    """`anthropic.Anthropic()` 자리에 끼우는 물건."""

    def __init__(self, *a, **kw) -> None:
        self.messages = _Messages()


_REAL: dict = {}


def _real_anthropic():
    return _REAL.get("cls")


def status() -> dict:
    """화면에 보여 줄 지금 상태 — 어느 쪽인지, 양쪽이 쓸 수 있는지."""
    return {
        "backend": backend(),
        "claude": exe(),
        "has_key": bool(os.getenv("ANTHROPIC_API_KEY")
                        or os.getenv("ANTHROPIC_AUTH_TOKEN")),
    }


def install() -> bool:
    """`anthropic.Anthropic` 을 이 물건으로 바꿔 끼운다. 이미 했으면 False.

    호출부는 `anthropic.Anthropic()` 을 그대로 부른다 — 무엇이 끼워졌는지 모른다.
    """
    # **어느 쪽을 골랐든 끼운다.** 끼워 둬야 화면에서 바꿨을 때 다음 호출부터 바로
    # 듣는다. API 를 고른 동안에는 이 물건이 진짜 SDK 로 그대로 넘긴다.
    try:
        import anthropic
    except Exception:  # noqa: BLE001
        return False
    if getattr(anthropic.Anthropic, "_via_cli", False):
        return False
    _REAL["cls"] = anthropic.Anthropic
    Client._via_cli = True
    anthropic.Anthropic = Client
    return True
