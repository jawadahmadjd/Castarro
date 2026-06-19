#!/usr/bin/env python3
"""Regression checks for live stream delivery stats in /api/status."""

from __future__ import annotations

import tempfile
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import app_db  # noqa: E402
import stream_manager  # noqa: E402
import web_ui  # noqa: E402


class FakeProcess:
    def __init__(self, pid: int) -> None:
        self.pid = pid
        self.returncode: int | None = None

    def poll(self) -> int | None:
        return self.returncode


def assert_progress_parser_reports_live_delivery() -> None:
    log_text = """
2026-06-14T12:00:00.000+05:00 | frame=300
2026-06-14T12:00:00.000+05:00 | fps=29.8
2026-06-14T12:00:00.000+05:00 | stream_0_0_q=-1.0
2026-06-14T12:00:00.000+05:00 | total_size=12000000
2026-06-14T12:00:00.000+05:00 | out_time_us=10000000
2026-06-14T12:00:00.000+05:00 | dup_frames=1
2026-06-14T12:00:00.000+05:00 | drop_frames=0
2026-06-14T12:00:00.000+05:00 | speed=1.00x
2026-06-14T12:00:00.000+05:00 | progress=continue
""".strip()
    stats = web_ui.parse_stream_stats(log_text, running=True, target_fps=30, target_bitrate_bps=6928000)
    assert stats["available"] is True
    assert stats["source"] == "ffmpeg-progress"
    assert stats["output_fps"] == 30.0
    assert stats["encoder_fps"] == 29.8
    assert stats["target_fps"] == 30.0
    assert stats["speed"] == 1.0
    assert stats["average_bitrate_bps"] == 9600000
    assert stats["target_bitrate_bps"] == 6928000
    assert stats["health_label"] == "Excellent"


def assert_timestamped_stats_line_still_parses() -> None:
    log_text = """
2026-06-14T12:00:01.000+05:00 | frame=  603 fps=29.9 q=-1.0 size=    6144KiB time=00:00:20.10 bitrate=2502.4kbits/s speed=0.99x
2026-06-14T12:00:02.000+05:00 | SESSION_EXIT kind=stream channel="Inside Us" pid=4242 returncode=4294957242 signed_returncode=-10054 reason="network connection reset by remote host (WSAECONNRESET)" duration_seconds=20.500
""".strip()
    stats = web_ui.parse_stream_stats(log_text, running=False, target_fps=30, target_bitrate_bps=6928000)
    assert stats["available"] is True
    assert stats["source"] == "ffmpeg-stats-line"
    assert stats["output_fps"] == 30.0
    assert stats["speed"] == 0.99


def assert_status_payload_includes_target_fps_for_running_stream() -> None:
    original_state = web_ui.STATE
    original_load_config = web_ui.load_config_or_none
    original_ensure_media_folders = web_ui.ensure_media_folders
    original_recent_stream_sessions = app_db.recent_stream_sessions
    original_recent_app_events = app_db.recent_app_events
    original_stream_transfer_today_bytes = app_db.stream_transfer_today_bytes
    original_stats = app_db.stats

    with tempfile.TemporaryDirectory(prefix="castarro-live-stream-stats-", dir=str(ROOT)) as temp_dir:
        temp_root = Path(temp_dir)
        log_path = temp_root / "logs" / "inside-us.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text(
            "\n".join(
                [
                    "frame=150",
                    "fps=30.2",
                    "total_size=4500000",
                    "out_time_us=5000000",
                    "dup_frames=0",
                    "drop_frames=0",
                    "speed=1.01x",
                    "progress=continue",
                ]
            ),
            encoding="utf-8",
        )
        log_handle = log_path.open("ab")

        def fake_load_config_or_none(_config_name: str):
            return {
                "channels": [
                    {
                        "name": "Inside Us",
                        "enabled": True,
                        "stream_key_env": "abcd-efgh-ijkl",
                        "live_profile": {"fps": 30},
                    }
                ]
            }, None

        try:
            web_ui.STATE = web_ui.AppState()
            running = stream_manager.RunningStream(
                channel={"name": "Inside Us"},
                process=FakeProcess(4242),
                log_handle=log_handle,
                command=["ffmpeg"],
                preview_manifest=None,
                preview_warning=None,
            )
            web_ui.STATE.streams["Inside Us"] = web_ui.StreamState("config.ready.json", running)
            web_ui.load_config_or_none = fake_load_config_or_none
            web_ui.ensure_media_folders = lambda _config: None
            app_db.recent_stream_sessions = lambda *_args, **_kwargs: []
            app_db.recent_app_events = lambda *_args, **_kwargs: []
            app_db.stream_transfer_today_bytes = lambda *_args, **_kwargs: 0
            app_db.stats = lambda: {}

            payload = web_ui.status_payload("config.ready.json")
            stats = payload["streams"]["Inside Us"]["stream_stats"]
            assert stats["target_fps"] == 30.0
            assert stats["target_bitrate_bps"] == 6928000
            assert stats["output_fps"] == 30.0
            assert stats["health_label"] == "Excellent"
            assert payload["streams"]["Inside Us"]["running"] is True
        finally:
            if not log_handle.closed:
                log_handle.close()
            web_ui.STATE = original_state
            web_ui.load_config_or_none = original_load_config
            web_ui.ensure_media_folders = original_ensure_media_folders
            app_db.recent_stream_sessions = original_recent_stream_sessions
            app_db.recent_app_events = original_recent_app_events
            app_db.stream_transfer_today_bytes = original_stream_transfer_today_bytes
            app_db.stats = original_stats


def main() -> int:
    assert_progress_parser_reports_live_delivery()
    assert_timestamped_stats_line_still_parses()
    assert_status_payload_includes_target_fps_for_running_stream()
    print("live_stream_stats_test: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
