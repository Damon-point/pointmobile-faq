# -*- coding: utf-8 -*-
"""검증 모드 — 운영 전환 전까지 외부 시스템에 쓰지 않는다.

Solution Buffer 는 Confluence(SB 스페이스)에 문서를 올리고 담당자에게 메일을 보낸다. 같은 Redmine ·
Confluence · 메일 계정을 tw-next(3080) · tw-automation(8080) 과 함께 쓰므로, 검증 중에 실제로 쓰면
같은 문서가 두 번 올라가거나 같은 메일이 두 번 나간다. 그래서 외부에 쓰는 **마지막 함수**에서 이 모듈에
묻고, 검증 모드면 보내려던 것만 work/shadow_writes.jsonl 에 남기고 성공한 것처럼 돌려준다.

운영 전환은 설정(app_settings 'live_writes')에서 한다.
"""
from __future__ import annotations

import json
import threading
from datetime import datetime

from app.database import BASE_DIR

LOG_PATH = BASE_DIR / "work" / "shadow_writes.jsonl"
_lock = threading.Lock()


def live() -> bool:
    """외부에 실제로 써도 되는가. 설정을 못 읽으면 쓰지 않는다."""
    try:
        from app import app_settings

        return app_settings.get("live_writes") == "1"
    except Exception:  # noqa: BLE001
        return False


def record(system: str, action: str, **detail) -> None:
    """보내지 않은 쓰기 하나를 남긴다. 기록이 실패해도 업무는 막지 않는다."""
    row = {"at": datetime.now().isoformat(timespec="seconds"), "system": system, "action": action}
    for k, v in detail.items():
        if isinstance(v, (bytes, bytearray)):
            v = f"<{len(v)} bytes>"
        elif not isinstance(v, (str, int, float, bool, type(None), list, dict)):
            v = str(v)
        if isinstance(v, str) and len(v) > 2000:
            v = v[:2000] + f"… (+{len(v) - 2000})"
        row[k] = v
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _lock, open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False, default=str) + "\n")
    except Exception:  # noqa: BLE001
        pass


def blocked(system: str, action: str, **detail) -> bool:
    """검증 모드면 기록하고 True(=보내지 말 것)."""
    if live():
        return False
    record(system, action, **detail)
    return True


def recent(limit: int = 200) -> list[dict]:
    if not LOG_PATH.exists():
        return []
    with _lock:
        lines = LOG_PATH.read_text(encoding="utf-8").splitlines()
    out = []
    for ln in reversed(lines[-limit:]):
        try:
            out.append(json.loads(ln))
        except ValueError:
            continue
    return out
