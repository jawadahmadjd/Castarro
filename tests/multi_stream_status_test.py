#!/usr/bin/env python3
"""Test to verify multi-stream tracking and status payload mapping."""

from __future__ import annotations

from pathlib import Path
import sys
import unittest.mock as mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import web_ui  # noqa: E402


class DummyProcess:
    def __init__(self, pid: int = 12345):
        self.pid = pid
        self.returncode = None

    def poll(self):
        return self.returncode

    def send_signal(self, sig):
        self.returncode = 0

    def terminate(self):
        self.returncode = 0

    def wait(self, timeout=None):
        return 0


class DummyRunningStream:
    def __init__(self, channel_name: str, pid: int = 12345):
        self.channel = {"name": channel_name}
        self.process = DummyProcess(pid)
        self.log_handle = mock.MagicMock()
        self.log_handle.name = "dummy.log"
        self.preview_manifest = None
        self.preview_warning = None
        self.command = ["ffmpeg"]
        self.stop_requested = False
        self.kind = "live"
        self.monitor_thread = None
        self.log_thread = None


def test_multi_stream_status_tracking() -> None:
    config_name = "config.ready.json"
    dummy_config = {
        "channels": [
            {
                "name": "Inside Us",
                "streams": [
                    {"id": "stream_1", "name": "Stream 1", "enabled": True},
                    {"id": "stream_2", "name": "Stream 2", "enabled": True},
                ],
            }
        ]
    }

    rs1 = DummyRunningStream("Inside Us", pid=101)
    rs2 = DummyRunningStream("Inside Us", pid=102)

    st1 = web_ui.StreamState(config_name, rs1)
    st2 = web_ui.StreamState(config_name, rs2)

    with web_ui.STATE.lock:
        web_ui.STATE.streams["Inside Us:stream_1"] = st1
        web_ui.STATE.streams["Inside Us:stream_2"] = st2
        web_ui.STATE.streams["Inside Us"] = st2

    with mock.patch("web_ui.load_config_or_none", return_value=(dummy_config, None)), \
         mock.patch("web_ui.ensure_media_folders", return_value=None), \
         mock.patch("web_ui.available_configs", return_value=["config.ready.json"]), \
         mock.patch("web_ui.tail_file", return_value=""), \
         mock.patch("web_ui.app_db.recent_stream_sessions", return_value=[]), \
         mock.patch("web_ui.app_db.stream_transfer_today_bytes", return_value=0), \
         mock.patch("web_ui.app_db.stream_transfer_month_bytes", return_value=0), \
         mock.patch("web_ui.app_db.stats", return_value={}), \
         mock.patch("web_ui.app_db.recent_app_events", return_value=[]), \
         mock.patch("web_ui.runtime_paths.runtime_binary_status", return_value={}):

        payload = web_ui.status_payload(config_name)
        assert "Inside Us" in payload["streams"]
        assert "Inside Us:stream_1" in payload["streams"]
        assert "Inside Us:stream_2" in payload["streams"]
        assert payload["streams"]["Inside Us"]["running"] is True

        # Stop stream 2 and ensure channel "Inside Us" still resolves to running stream 1
        stopped = web_ui.stop_stream("Inside Us", stream_id="stream_2")
        assert "Inside Us:stream_2" in stopped

        payload_after = web_ui.status_payload(config_name)
        assert "Inside Us" in payload_after["streams"]
        assert payload_after["streams"]["Inside Us"]["pid"] == 101

        # Clean up
        with web_ui.STATE.lock:
            web_ui.STATE.streams.clear()


if __name__ == "__main__":
    test_multi_stream_status_tracking()
    print("Multi-stream status test passed.")
