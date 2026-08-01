#!/usr/bin/env python3
"""Test to verify user/stream stats persistence across non-fetching API calls."""

from __future__ import annotations

import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import web_ui  # noqa: E402
import youtube_service  # noqa: E402


def test_user_stats_persistence(tmp_path: Path) -> None:
    config_path = tmp_path / "config.ready.json"
    config = {
        "defaults": {
            "ffmpeg_path": "ffmpeg",
            "ffprobe_path": "ffprobe",
            "rtmp_base": "rtmp://example.invalid/live2",
            "log_dir": "logs",
            "runtime_dir": ".runtime",
            "raw_dir": "Raw Videos",
            "normalized_dir": "Go Live",
            "normalized_playlist_dir": "playlists",
            "restart_delay_seconds": 10,
        },
        "youtube": {
            "client_id": "test_id",
            "client_secret": "test_secret",
            "accounts": [
                {"id": "acct_1", "label": "Account 1", "tokens_file": ".runtime/acc1.json"}
            ],
        },
        "channels": [
            {
                "name": "Test Channel",
                "folder_name": "Test Channel",
                "enabled": True,
                "youtube_account_id": "acct_1",
                "youtube_broadcast_id": "broad_123",
                "streams": [
                    {
                        "id": "stream_1",
                        "name": "Main Stream",
                        "stream_key": "test_key",
                        "enabled": True,
                    }
                ],
            }
        ],
    }
    config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")

    # Mock youtube token validation & video stats call
    youtube_service.valid_access_token = lambda *args, **kwargs: ("mock_token", False)
    youtube_service.get_video_stats_batch = lambda access_token, video_ids: {
        "broad_123": {
            "concurrent_viewers": 42,
            "total_views": 1337,
            "avg_view_duration": "05m 12s",
        }
    }

    # 1. Fetch stats with fetch_stats=True
    res_fetched = web_ui.get_channel_streams_api(str(config_path), "Test Channel", fetch_stats=True)
    assert res_fetched["ok"] is True
    s1 = res_fetched["streams"][0]
    assert s1["concurrent_viewers"] == 42
    assert s1["total_views"] == 1337
    assert s1["avg_view_duration"] == "05m 12s"

    # 2. Call again with fetch_stats=False (simulating 2.5s polling loop)
    res_polled = web_ui.get_channel_streams_api(str(config_path), "Test Channel", fetch_stats=False)
    assert res_polled["ok"] is True
    s1_polled = res_polled["streams"][0]
    # Stats MUST persist instead of resetting to None!
    assert s1_polled["concurrent_viewers"] == 42, f"Expected 42 viewers, got {s1_polled['concurrent_viewers']}"
    assert s1_polled["total_views"] == 1337, f"Expected 1337 views, got {s1_polled['total_views']}"
    assert s1_polled["avg_view_duration"] == "05m 12s", f"Expected '05m 12s', got {s1_polled['avg_view_duration']}"

    print("[PASS] User stats persistence test completed successfully!")


if __name__ == "__main__":
    import tempfile

    with tempfile.TemporaryDirectory() as tmpdir:
        test_user_stats_persistence(Path(tmpdir))
