"""
API 프로세스의 기동 · 주기 작업 — Redmine 수집 → SB 초안 생성·검토 요청 → 통계 데우기.

tw-next 의 app.background 에서 Redmine/SB 부분만 옮겼다. 메일 수신·WhiteList 등은 이 프로젝트에 없다.
외부로 나가는 쓰기(Confluence·메일)는 app.shadow 가 막는다(검증 모드).
"""
from __future__ import annotations

import os
import threading
import time
import traceback
from datetime import datetime

REDMINE_POLL_SEC = int(os.getenv("SB_REDMINE_POLL_SEC", "300"))
_started = False
_lock = threading.Lock()
status: dict = {"started_at": "", "loops": {}}


def _log(msg: str) -> None:
    print(f"[sb {datetime.now():%Y-%m-%d %H:%M:%S}] {msg}", flush=True)


def _loop(name: str, every: float, first: float, fn) -> None:
    def run() -> None:
        time.sleep(first)
        while True:
            t0 = time.time()
            try:
                fn()
                status["loops"][name] = {"ok": True, "at": time.strftime("%Y-%m-%d %H:%M:%S")}
            except Exception as e:  # noqa: BLE001
                status["loops"][name] = {"ok": False, "at": time.strftime("%Y-%m-%d %H:%M:%S"), "error": str(e)[:300]}
                _log(f"{name} 오류\n" + traceback.format_exc())
            time.sleep(max(5.0, every - (time.time() - t0)))

    threading.Thread(target=run, name=f"sbn-{name}", daemon=True).start()


def _redmine_tick() -> None:
    """수집 → (성공하면) SB 초안·검토 요청 → 통계 데우기. 수집 실패 때 SB 판정을 하지 않는 것은 sb_tick 과 같다."""
    from app import sb_tick

    res = sb_tick.redmine_poll_once()
    if res.get("error"):
        return
    sb_tick.sb_tick_once()
    from routers import issues as IR

    IR.warm_stats()            # 바뀐 것이 없으면 판번호가 같아 바로 끝난다


def start() -> None:
    """한 번만."""
    global _started
    with _lock:
        if _started:
            return
        _started = True
    status["started_at"] = time.strftime("%Y-%m-%d %H:%M:%S")

    from app.database import init_db
    from app.issuetrack.db import init_issuetrack_db

    init_db()
    init_issuetrack_db()
    import app.usage

    app.usage.install()
    from app.integrations import claude_cli

    claude_cli.install()

    _loop("redmine_sb", REDMINE_POLL_SEC, 20, _redmine_tick)
    _log(f"백그라운드 시작 — Redmine 수집 {REDMINE_POLL_SEC}초 · SB 초안·검토 요청 · 통계 데우기")
