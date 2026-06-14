#!/usr/bin/env python3
"""Regression checks for timestamped stream logging helpers."""

from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import stream_manager  # noqa: E402


def assert_winsock_reset_is_decoded() -> None:
    returncode = 4294957242
    assert stream_manager.signed_returncode(returncode) == -10054
    reason = stream_manager.describe_returncode(returncode)
    assert "WSAECONNRESET" in reason
    assert "remote host" in reason


def assert_stop_request_overrides_signal_exit() -> None:
    reason = stream_manager.describe_returncode(-1073741510, stop_requested=True)
    assert reason == "stopped by user request"


def assert_session_command_masks_output_url() -> None:
    url = "rtmp://example.invalid/live2/private-stream-key"
    command = [
        "ffmpeg",
        "-i",
        "playlist.txt",
        "-f",
        "flv",
        url,
        "-f",
        "hls",
        "preview.m3u8",
    ]
    text = stream_manager.command_as_text_with_masked_url(command, url, "rtmp://example.invalid/live2/***")
    assert "private-stream-key" not in text
    assert "preview.m3u8" in text


def main() -> int:
    assert_winsock_reset_is_decoded()
    assert_stop_request_overrides_signal_exit()
    assert_session_command_masks_output_url()
    print("stream_logging_test: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
