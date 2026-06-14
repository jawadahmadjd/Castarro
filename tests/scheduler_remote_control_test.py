#!/usr/bin/env python3
"""Regression checks for scheduler windows and mobile remote control actions."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import web_ui  # noqa: E402


def assert_schedule_is_active_for_daytime_window() -> None:
    entry = {
        "enabled": True,
        "start_time": "09:00",
        "stop_time": "17:00",
        "days": ["mon", "tue", "wed", "thu", "fri"],
    }
    monday_noon = datetime(2026, 6, 15, 12, 0, tzinfo=timezone.utc)
    monday_evening = datetime(2026, 6, 15, 18, 0, tzinfo=timezone.utc)
    assert web_ui.schedule_is_active(entry, monday_noon) is True
    assert web_ui.schedule_is_active(entry, monday_evening) is False


def assert_schedule_is_active_for_overnight_window() -> None:
    entry = {
        "enabled": True,
        "start_time": "22:00",
        "stop_time": "02:00",
        "days": ["mon"],
    }
    monday_late = datetime(2026, 6, 15, 23, 30, tzinfo=timezone.utc)
    tuesday_early = datetime(2026, 6, 16, 1, 30, tzinfo=timezone.utc)
    tuesday_late = datetime(2026, 6, 16, 3, 0, tzinfo=timezone.utc)
    assert web_ui.schedule_is_active(entry, monday_late) is True
    assert web_ui.schedule_is_active(entry, tuesday_early) is True
    assert web_ui.schedule_is_active(entry, tuesday_late) is False


def assert_remote_control_dispatches_expected_action() -> None:
    original_record = web_ui.sync_token_record
    original_start = web_ui.start_stream
    original_stop = web_ui.stop_stream
    original_assert_match = web_ui.assert_youtube_channel_keys_match
    original_remote_status = web_ui.remote_status_for_record

    calls: list[tuple[str, str]] = []

    try:
        web_ui.sync_token_record = lambda token: {  # type: ignore[assignment]
            "configName": "config.ready.json",
            "device": {"deviceName": "Pixel 9"},
        }
        web_ui.start_stream = lambda config_name, channel_name: calls.append(("start", str(channel_name))) or [str(channel_name)]  # type: ignore[assignment]
        web_ui.stop_stream = lambda channel_name: calls.append(("stop", str(channel_name))) or [str(channel_name)]  # type: ignore[assignment]
        web_ui.assert_youtube_channel_keys_match = lambda config_name, channel_name: calls.append(("verify", str(channel_name)))  # type: ignore[assignment]
        web_ui.remote_status_for_record = lambda record: {"ok": True, "channels": []}  # type: ignore[assignment]

        payload = web_ui.handle_sync_remote_control(
            "sync-token",
            {"action": "restart", "channelName": "Inside Us"},
        )
        assert payload["ok"] is True
        assert calls == [
            ("verify", "Inside Us"),
            ("stop", "Inside Us"),
            ("start", "Inside Us"),
        ]
    finally:
        web_ui.sync_token_record = original_record  # type: ignore[assignment]
        web_ui.start_stream = original_start  # type: ignore[assignment]
        web_ui.stop_stream = original_stop  # type: ignore[assignment]
        web_ui.assert_youtube_channel_keys_match = original_assert_match  # type: ignore[assignment]
        web_ui.remote_status_for_record = original_remote_status  # type: ignore[assignment]


def main() -> int:
    assert_schedule_is_active_for_daytime_window()
    assert_schedule_is_active_for_overnight_window()
    assert_remote_control_dispatches_expected_action()
    print("scheduler_remote_control_test: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
