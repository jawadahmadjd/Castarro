#!/usr/bin/env python3
"""Regression checks for scheduler windows and mobile remote control actions."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import web_ui  # noqa: E402


class FakeProcess:
    def __init__(self, pid: int, returncode: int | None = None) -> None:
        self.pid = pid
        self.returncode = returncode

    def poll(self) -> int | None:
        return self.returncode


def fake_running_stream(channel_name: str, *, log_dir: Path, pid: int, returncode: int | None = None) -> web_ui.stream_manager.RunningStream:
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{channel_name}-{pid}.log"
    log_path.write_text("frame=10 fps=30.0 speed=1.0x\n", encoding="utf-8")
    return web_ui.stream_manager.RunningStream(
        channel={"name": channel_name},
        process=FakeProcess(pid, returncode),
        log_handle=log_path.open("a", encoding="utf-8", buffering=1),
        command=["ffmpeg"],
    )


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
        web_ui.stop_stream = lambda channel_name, **_kwargs: calls.append(("stop", str(channel_name))) or [str(channel_name)]  # type: ignore[assignment]
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


def assert_stream_cycle_restarts_after_duration() -> None:
    original_state = web_ui.STATE
    original_load_config = web_ui.stream_manager.load_config
    original_stop_stream = web_ui.stream_manager.stop_stream
    original_start_stream = web_ui.stream_manager.start_stream
    original_assert_match = web_ui.assert_youtube_channel_keys_match
    original_record_event = web_ui.app_db.record_event
    original_record_stream_start = web_ui.app_db.record_stream_start
    original_record_stream_stop = web_ui.app_db.record_stream_stop
    original_unregister_cloud_assets = web_ui.unregister_cloud_assets
    original_runtime_file = web_ui.STREAM_CYCLE_RUNTIME_FILE

    events: list[str] = []
    with tempfile.TemporaryDirectory(prefix="castarro-stream-cycle-", dir=str(ROOT)) as temp_dir:
        temp_root = Path(temp_dir)
        old_running = fake_running_stream("Inside Us", log_dir=temp_root / "logs", pid=1001)
        old_state = web_ui.StreamState("config.ready.json", old_running)
        old_state.started_at = time.time() - 61
        config = {
            "stream_cycles": {
                "enabled": True,
                "restart_delay_seconds": 0,
                "channels": [
                    {"channel": "Inside Us", "enabled": True, "duration_seconds": 60},
                ],
            },
            "channels": [
                {"name": "Inside Us", "enabled": True, "stream_key_env": "abcd-efgh-ijkl"},
            ],
        }

        def fake_stop_stream(running: web_ui.stream_manager.RunningStream) -> None:
            running.stop_requested = True
            running.process.returncode = 0

        def fake_start_stream(_config_dir: Path, _config: dict, channel: dict):
            return fake_running_stream(str(channel.get("name") or ""), log_dir=temp_root / "logs", pid=2002)

        try:
            web_ui.STATE = web_ui.AppState()
            web_ui.STREAM_CYCLE_RUNTIME_FILE = temp_root / "stream-cycle-runtime.json"
            web_ui.STATE.streams["Inside Us"] = old_state
            web_ui.stream_manager.load_config = lambda _path: (config, temp_root)
            web_ui.stream_manager.stop_stream = fake_stop_stream
            web_ui.stream_manager.start_stream = fake_start_stream
            web_ui.assert_youtube_channel_keys_match = lambda _config_name, _channel_name: None
            web_ui.app_db.record_event = lambda event, *_args, **_kwargs: events.append(event)
            web_ui.app_db.record_stream_start = lambda *_args, **_kwargs: None
            web_ui.app_db.record_stream_stop = lambda *_args, **_kwargs: None
            web_ui.unregister_cloud_assets = lambda _asset_ids: None

            web_ui.evaluate_stream_cycles_for_config("config.ready.json", config)
            assert old_running.process.poll() == 0, "Expired cycle should stop the current FFmpeg process."
            assert web_ui.STATE.stream_cycle_channels[("config.ready.json", "Inside Us")]["phase"] == "waiting_restart"

            web_ui.evaluate_stream_cycles_for_config("config.ready.json", config)
            restarted = web_ui.STATE.streams["Inside Us"].running
            runtime = web_ui.STATE.stream_cycle_channels[("config.ready.json", "Inside Us")]
            assert restarted.process.pid == 2002, "Cycle restart should launch a fresh FFmpeg process."
            assert runtime["cycle_count"] == 1, "Cycle count should increment after the fresh start."
            assert "stream_cycle_stopped" in events
            assert "stream_cycle_restarted" in events
        finally:
            for state in list(web_ui.STATE.streams.values()):
                if state.running.log_handle and not state.running.log_handle.closed:
                    state.running.log_handle.close()
            if old_running.log_handle and not old_running.log_handle.closed:
                old_running.log_handle.close()
            web_ui.STATE = original_state
            web_ui.stream_manager.load_config = original_load_config
            web_ui.stream_manager.stop_stream = original_stop_stream
            web_ui.stream_manager.start_stream = original_start_stream
            web_ui.assert_youtube_channel_keys_match = original_assert_match
            web_ui.app_db.record_event = original_record_event
            web_ui.app_db.record_stream_start = original_record_stream_start
            web_ui.app_db.record_stream_stop = original_record_stream_stop
            web_ui.unregister_cloud_assets = original_unregister_cloud_assets
            web_ui.STREAM_CYCLE_RUNTIME_FILE = original_runtime_file


def assert_stream_cycle_uses_random_duration_and_cooldown_minutes() -> None:
    original_state = web_ui.STATE
    original_stop_stream = web_ui.stream_manager.stop_stream
    original_randint = web_ui.random.randint
    original_record_event = web_ui.app_db.record_event
    original_record_stream_stop = web_ui.app_db.record_stream_stop
    original_unregister_cloud_assets = web_ui.unregister_cloud_assets
    original_runtime_file = web_ui.STREAM_CYCLE_RUNTIME_FILE

    events: list[tuple[str, dict]] = []
    with tempfile.TemporaryDirectory(prefix="castarro-random-cycle-", dir=str(ROOT)) as temp_dir:
        temp_root = Path(temp_dir)
        running = fake_running_stream("Inside Us", log_dir=temp_root / "logs", pid=3001)
        stream_state = web_ui.StreamState("config.ready.json", running)
        stream_state.started_at = time.time() - 91
        config = {
            "stream_cycles": {
                "enabled": True,
                "randomized": True,
                "restart_delay_seconds": 10,
                "restart_delay_random_minutes": 2,
                "channels": [
                    {
                        "channel": "Inside Us",
                        "enabled": True,
                        "duration_seconds": 30,
                        "duration_random_minutes": 1,
                    },
                ],
            },
            "channels": [
                {"name": "Inside Us", "enabled": True, "stream_key_env": "abcd-efgh-ijkl"},
            ],
        }

        def fake_stop_stream(running_stream: web_ui.stream_manager.RunningStream) -> None:
            running_stream.stop_requested = True
            running_stream.process.returncode = 0

        try:
            web_ui.STATE = web_ui.AppState()
            web_ui.STREAM_CYCLE_RUNTIME_FILE = temp_root / "stream-cycle-runtime.json"
            web_ui.STATE.streams["Inside Us"] = stream_state
            web_ui.stream_manager.stop_stream = fake_stop_stream
            web_ui.random.randint = lambda _start, end: end
            web_ui.app_db.record_event = lambda event, _config, _channel, details: events.append((event, details))
            web_ui.app_db.record_stream_stop = lambda *_args, **_kwargs: None
            web_ui.unregister_cloud_assets = lambda _asset_ids: None

            web_ui.evaluate_stream_cycles_for_config("config.ready.json", config)
            runtime = web_ui.STATE.stream_cycle_channels[("config.ready.json", "Inside Us")]
            assert runtime["duration_seconds"] == 90, "Randomized duration should add up to the configured extra minutes."
            assert running.process.poll() == 0, "Expired randomized cycle should stop the stream."
            assert runtime["restart_delay_seconds"] == 130, "Randomized cooldown should add up to the configured extra minutes."
            assert any(
                event == "stream_cycle_stopped" and details.get("restart_delay_seconds") == 130
                for event, details in events
            )
        finally:
            for state in list(web_ui.STATE.streams.values()):
                if state.running.log_handle and not state.running.log_handle.closed:
                    state.running.log_handle.close()
            if running.log_handle and not running.log_handle.closed:
                running.log_handle.close()
            web_ui.STATE = original_state
            web_ui.stream_manager.stop_stream = original_stop_stream
            web_ui.random.randint = original_randint
            web_ui.app_db.record_event = original_record_event
            web_ui.app_db.record_stream_stop = original_record_stream_stop
            web_ui.unregister_cloud_assets = original_unregister_cloud_assets
            web_ui.STREAM_CYCLE_RUNTIME_FILE = original_runtime_file


def assert_stream_cycle_cooldown_runtime_is_restored() -> None:
    original_state = web_ui.STATE
    original_runtime_file = web_ui.STREAM_CYCLE_RUNTIME_FILE

    with tempfile.TemporaryDirectory(prefix="castarro-cycle-restore-", dir=str(ROOT)) as temp_dir:
        temp_root = Path(temp_dir)
        runtime_file = temp_root / "stream-cycle-runtime.json"
        restart_at = time.time() + 3600
        runtime_file.write_text(
            json.dumps(
                {
                    "version": 1,
                    "channels": [
                        {
                            "config": "config.ready.json",
                            "channel": "Inside Us",
                            "runtime": {
                                "phase": "waiting_restart",
                                "restart_at": restart_at,
                                "restart_delay_seconds": 3600,
                                "last_action": "stopped_for_cycle",
                            },
                        },
                        {
                            "config": "config.ready.json",
                            "channel": "Running Channel",
                            "runtime": {
                                "phase": "running",
                                "restart_at": 0,
                            },
                        },
                    ],
                }
            ),
            encoding="utf-8",
        )

        try:
            web_ui.STATE = web_ui.AppState()
            web_ui.STREAM_CYCLE_RUNTIME_FILE = runtime_file
            web_ui.load_stream_cycle_runtime()
            restored = web_ui.STATE.stream_cycle_channels
            assert ("config.ready.json", "Inside Us") in restored
            assert restored[("config.ready.json", "Inside Us")]["restart_at"] == restart_at
            assert ("config.ready.json", "Running Channel") not in restored
        finally:
            web_ui.STATE = original_state
            web_ui.STREAM_CYCLE_RUNTIME_FILE = original_runtime_file


def main() -> int:
    assert_schedule_is_active_for_daytime_window()
    assert_schedule_is_active_for_overnight_window()
    assert_remote_control_dispatches_expected_action()
    assert_stream_cycle_restarts_after_duration()
    assert_stream_cycle_uses_random_duration_and_cooldown_minutes()
    assert_stream_cycle_cooldown_runtime_is_restored()
    print("scheduler_remote_control_test: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
