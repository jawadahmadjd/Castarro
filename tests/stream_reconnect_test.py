#!/usr/bin/env python3
"""Regression checks for YouTube-aware stream reconnects."""

from __future__ import annotations

import tempfile
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import app_db  # noqa: E402
import stream_manager  # noqa: E402
import web_ui  # noqa: E402
import youtube_service  # noqa: E402


class FakeProcess:
    def __init__(self, pid: int, returncode: int | None = None) -> None:
        self.pid = pid
        self.returncode = returncode

    def poll(self) -> int | None:
        return self.returncode


def fake_running_stream(channel_name: str, *, log_dir: Path, pid: int, returncode: int | None) -> stream_manager.RunningStream:
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{channel_name}-{pid}.log"
    log_path.write_text("frame=10 fps=30.0 speed=1.0x\n", encoding="utf-8")
    return stream_manager.RunningStream(
        channel={"name": channel_name},
        process=FakeProcess(pid, returncode),
        log_handle=log_path.open("a", encoding="utf-8", buffering=1),
        command=["ffmpeg"],
    )


def base_config() -> dict:
    return {
        "defaults": {"restart_delay_seconds": 2},
        "youtube": {
            "accounts": [
                {"id": "acct-a", "label": "Account A", "tokens_file": ".runtime/youtube_tokens_acct-a.json"},
            ],
        },
        "channels": [
            {
                "name": "Inside Us",
                "enabled": True,
                "stream_key_env": "abcd-efgh-ijkl",
                "youtube_account_id": "acct-a",
                "youtube_broadcast_id": "broadcast-a",
                "restart_on_exit": True,
            }
        ],
    }


def run_with_reconnect_fakes(broadcast_status: str) -> tuple[list, list, web_ui.StreamState]:
    original_state = web_ui.STATE
    original_load_config_or_none = web_ui.load_config_or_none
    original_valid_access_token = youtube_service.valid_access_token
    original_broadcast_by_id = youtube_service.broadcast_by_id
    original_start_stream = stream_manager.start_stream
    original_record_event = app_db.record_event
    original_record_stream_stop = app_db.record_stream_stop
    original_unregister_cloud_assets = web_ui.unregister_cloud_assets

    events: list[tuple[str, dict]] = []
    stops: list[tuple[str, int | None]] = []

    with tempfile.TemporaryDirectory(prefix="castarro-stream-reconnect-", dir=str(ROOT)) as temp_dir:
        temp_root = Path(temp_dir)
        config = base_config()
        old_running = fake_running_stream("Inside Us", log_dir=temp_root / "logs", pid=1001, returncode=4294957242)
        state = web_ui.StreamState("config.ready.json", old_running)

        def fake_load_config_or_none(_config_name: str):
            return config, None

        def fake_broadcast_by_id(_access_token: str, _broadcast_id: str):
            return {
                "id": "broadcast-a",
                "life_cycle_status": broadcast_status,
                "stream": {"stream_status": "inactive"},
            }

        def fake_start_stream(_config_dir: Path, _config: dict, channel: dict):
            return fake_running_stream(str(channel.get("name") or ""), log_dir=temp_root / "logs", pid=2002, returncode=None)

        try:
            web_ui.STATE = web_ui.AppState()
            web_ui.STATE.streams["Inside Us"] = state
            web_ui.load_config_or_none = fake_load_config_or_none
            youtube_service.valid_access_token = lambda *_args, **_kwargs: ("token", {})
            youtube_service.broadcast_by_id = fake_broadcast_by_id
            stream_manager.start_stream = fake_start_stream
            app_db.record_event = lambda event, _config, _channel, payload=None: events.append((event, dict(payload or {})))
            app_db.record_stream_stop = lambda _config, channel, returncode, _bytes=None: stops.append((channel, returncode))
            web_ui.unregister_cloud_assets = lambda _asset_ids: None

            web_ui.finalize_stream_lifecycle()
            return events, stops, state
        finally:
            if state.running.log_handle and not state.running.log_handle.closed:
                state.running.log_handle.close()
            web_ui.STATE = original_state
            web_ui.load_config_or_none = original_load_config_or_none
            youtube_service.valid_access_token = original_valid_access_token
            youtube_service.broadcast_by_id = original_broadcast_by_id
            stream_manager.start_stream = original_start_stream
            app_db.record_event = original_record_event
            app_db.record_stream_stop = original_record_stream_stop
            web_ui.unregister_cloud_assets = original_unregister_cloud_assets


def assert_network_exit_reconnects_when_youtube_is_live() -> None:
    events, stops, state = run_with_reconnect_fakes("live")
    assert not stops, "Recoverable YouTube streams should not be recorded as stopped."
    assert state.running.process.pid == 2002, "FFmpeg should be restarted while YouTube is still live."
    assert state.running.process.poll() is None, "Replacement FFmpeg process should be active."
    assert any(event == "stream_reconnected" for event, _payload in events), "Reconnect event should be recorded."


def assert_network_exit_stops_when_youtube_is_complete() -> None:
    events, stops, state = run_with_reconnect_fakes("complete")
    assert stops == [("Inside Us", 4294957242)], "Completed YouTube broadcasts should finalize the app stream."
    assert state.running.process.pid == 1001, "FFmpeg should not restart after YouTube is complete."
    assert any(event == "stream_reconnect_abandoned" for event, _payload in events), "Terminal YouTube state should be logged."


def main() -> int:
    assert stream_manager.is_recoverable_network_exit(4294957242)
    assert_network_exit_reconnects_when_youtube_is_live()
    assert_network_exit_stops_when_youtube_is_complete()
    print("stream_reconnect_test: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
