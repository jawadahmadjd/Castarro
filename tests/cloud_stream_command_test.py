#!/usr/bin/env python3
"""Check desktop stream command construction for prepared cloud playlist URLs."""

from __future__ import annotations

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import stream_manager  # noqa: E402


def main() -> int:
    config = {
        "defaults": {
            "ffmpeg_path": "ffmpeg",
            "runtime_dir": ".runtime",
            "rtmp_base": "rtmps://a.rtmps.youtube.com/live2",
        },
        "live_profile": {"mode": "copy"},
    }
    channel = {
        "name": "channel_1",
        "stream_key_env": "xxxx-xxxx-xxxx-xxxx",
        "cloud_playlist": [
            {
                "provider_id": "google-drive-main",
                "file_id": "drive-file-ready",
                "display_name": "ready.mp4",
                "proxy_url": "http://127.0.0.1:8876/assets/session/ready",
            }
        ],
        "live_profile": {"mode": "copy"},
    }
    command, playlist_path, _url, _warning = stream_manager.build_command(ROOT, config, channel)
    command_text = " ".join(command)
    playlist_text = playlist_path.read_text(encoding="utf-8")
    assert "-c copy" in command_text, command_text
    assert "-protocol_whitelist file,http,https,tcp,tls,crypto" in command_text, command_text
    assert "http://127.0.0.1:8876/assets/session/ready" in playlist_text, playlist_text

    blocked_channel = {
        **channel,
        "cloud_playlist": [
            {
                "provider_id": "google-drive-main",
                "file_id": "drive-file-not-prepared",
                "display_name": "not-prepared.mp4",
            }
        ],
    }
    try:
        stream_manager.build_command(ROOT, config, blocked_channel)
    except SystemExit as exc:
        assert "source proxy" in str(exc), exc
    else:
        raise AssertionError("Unprepared cloud source should be blocked.")

    print("cloud_stream_command_test: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
