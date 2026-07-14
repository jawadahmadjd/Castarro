#!/usr/bin/env python3
"""Regression checks for timestamped stream logging helpers."""

from __future__ import annotations

from pathlib import Path
import sys
import tempfile

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


def assert_ffmpeg_output_url_is_redacted() -> None:
    url = "rtmp://a.rtmp.youtube.com/live2/private-stream-key"
    redactions = stream_manager.stream_log_redactions(url, "Inside Us")
    text = stream_manager.sanitize_stream_log_message(
        f"[out#0/flv] Output file #0 ({url}): private-stream-key",
        redactions,
    )
    assert "private-stream-key" not in text
    assert "rtmp://a.rtmp.youtube.com/live2/[Inside Us stream key]" in text
    assert text.endswith("[Inside Us stream key]")


class FakeProcess:
    def __init__(self) -> None:
        self.pid = 1234
        self.returncode = None

    def poll(self):
        return self.returncode

    def send_signal(self, _signal) -> None:
        self.returncode = 1

    def terminate(self) -> None:
        self.returncode = 1

    def kill(self) -> None:
        self.returncode = 1

    def wait(self, timeout=None):
        if self.returncode is None:
            self.returncode = 1
        return self.returncode


def assert_stop_request_logs_source_and_reason() -> None:
    with tempfile.TemporaryDirectory(prefix="castarro-stop-log-", dir=str(ROOT)) as temp_dir:
        log_path = Path(temp_dir) / "stream.log"
        with log_path.open("w", encoding="utf-8") as log_handle:
            running = stream_manager.RunningStream(
                channel={"name": "Inside Us"},
                process=FakeProcess(),
                log_handle=log_handle,
                command=[],
                kind="stream",
                stop_request_source="stream_cycle",
                stop_request_reason="duration reached",
            )
            stream_manager.stop_stream(running)
        text = log_path.read_text(encoding="utf-8")
        assert "STOP_REQUEST kind=stream pid=1234" in text
        assert 'source="stream_cycle"' in text
        assert 'reason="duration reached"' in text


def main() -> int:
    assert_winsock_reset_is_decoded()
    assert_stop_request_overrides_signal_exit()
    assert_session_command_masks_output_url()
    assert_ffmpeg_output_url_is_redacted()
    assert_stop_request_logs_source_and_reason()
    print("stream_logging_test: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
