"""Redmine 수집 1회 · SB 한 틱 — tw-next app/background.py 의 redmine_poll_once · sb_tick_once 를 그대로 옮겼다.

api/runtime.py 가 5분마다 부른다. 수집이 성공했을 때만 SB 로 넘어간다.
"""
from __future__ import annotations

from datetime import datetime

_redmine_fail_streak = 0


def _log(msg: str) -> None:
    print(f"[sb {datetime.now():%Y-%m-%d %H:%M:%S}] {msg}", flush=True)


def redmine_poll_once() -> dict:
    """Redmine 증분 수집 1회(블로킹). 최초에는 자동으로 전수 백필로 넘어간다."""
    global _redmine_fail_streak

    from app.issuetrack import sync as it_sync

    try:
        res = it_sync.poll()
    except Exception as e:  # noqa: BLE001
        _redmine_fail_streak += 1
        if _redmine_fail_streak in (1, 5, 30) or _redmine_fail_streak % 60 == 0:
            _log(f"Redmine 수집 실패({_redmine_fail_streak}회 연속): {e}")
        return {"error": str(e)}

    if res.get("error"):
        _redmine_fail_streak += 1
        # 자격증명 미등록처럼 고쳐질 때까지 계속 실패하는 종류라 로그를 아껴 남긴다.
        if _redmine_fail_streak in (1, 5, 30) or _redmine_fail_streak % 60 == 0:
            _log(f"Redmine 수집 실패({_redmine_fail_streak}회 연속): {res['error']}")
        return res

    if _redmine_fail_streak:
        _log(f"Redmine 수집 복구됨 (연속 실패 {_redmine_fail_streak}회 후)")
    _redmine_fail_streak = 0

    if res.get("listed") is not None:                       # 백필 결과
        _log(
            f"Redmine 백필: 이슈 {res.get('listed')}건, 상세 {res.get('detail_done')}건"
            f"(실패 {res.get('detail_failed')}), 이벤트 {res.get('journals')}건"
        )
    elif res.get("detail_done"):                            # 변경분이 있었던 폴링
        msg = (f"Redmine 갱신: 이슈 {res.get('detail_done')}건, "
               f"이벤트 {res.get('journals')}건")
        if res.get("deferred"):
            msg += f" (다음 주기로 이월 {res['deferred']}건)"
        _log(msg)
    return res


def sb_tick_once() -> dict:
    """Resolved 감지 → SB 초안 생성 → 담당자 검토 요청 메일.

    한 틱에서 만드는 초안 수를 묶어 둔다(SB_PER_TICK). Claude 호출은 건당 수십 초·
    수십 원이라, 한꺼번에 몰아 치면 서버가 붙잡히고 비용도 한 번에 튄다.
    감시 시작 전에 이미 Resolved 였던 이슈는 backlog 로만 남고 여기서 건드리지 않는다.
    """
    from app.issuetrack import sb, settings

    cfg = settings.load()
    try:
        scanned = sb.scan()
    except Exception as e:  # noqa: BLE001
        _log(f"SB scan 실패: {e}")
        return {"error": str(e)}

    out: dict = dict(scanned)
    if scanned.get("first_run"):
        s = sb.summary()
        _log(f"SB 감시 시작 — 기존 Resolved {s['backlog']}건은 소급 대기(backlog)로 "
             f"남겨 둡니다. 자동 생성은 지금 이후 해결분부터입니다.")

    made: list[int] = []
    if cfg.sb_auto_generate:
        try:
            gen = sb.generate_pending(limit=cfg.sb_per_tick)
            out.update(gen)
            made = gen.get("generated_ids") or []
            if gen.get("generated"):
                _log(f"SB 초안 {gen['generated']}건 생성"
                     + (f" (실패 {gen['failed']}건)" if gen.get("failed") else ""))
        except Exception as e:  # noqa: BLE001
            _log(f"SB 초안 생성 실패: {e}")

    if cfg.sb_auto_notify:
        # 방금 만든 초안을 **곧바로** 담당자에게 알린다. 이게 이 기능의 본줄기다 —
        # 이슈가 Resolved 되면 담당자가 메일을 받고, 로그인해서 고치거나 올린다.
        try:
            res = sb.notify_many(made)
            # 앞선 틱에서 발송이 실패해 남아 있는 것도 함께 훑는다(재시도 그물).
            retry = sb.notify_pending(limit=cfg.sb_per_tick)
            sent = res.get("sent", 0) + retry.get("sent", 0)
            out["notified"] = sent
            if sent:
                _log(f"SB 검토 요청 메일 {sent}건 발송")
            for err in (res.get("errors") or []) + (retry.get("errors") or []):
                if err:
                    _log(f"SB 알림 발송 실패: {err}")
                    break
        except Exception as e:  # noqa: BLE001
            _log(f"SB 알림 발송 실패: {e}")
    elif made:
        _log(f"SB 초안 {len(made)}건 생성 — 담당자 알림은 꺼져 있습니다"
             " ([설정 → 동작]에서 켜세요)")
    return out
