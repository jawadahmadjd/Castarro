#!/usr/bin/env python3
"""Regression checks for on-demand preview lifecycle state."""

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


def fake_running_stream(channel_name: str, *, log_dir: Path, preview_manifest: Path | None = None) -> stream_manager.RunningStream:
    log_dir.mkdir(parents=True, exist_ok=True)
    log_handle = (log_dir / f"{channel_name}-{preview_manifest is not None}.log").open("ab")
    return stream_manager.RunningStream(
        channel={"name": channel_name},
        process=FakeProcess(1000 if preview_manifest is None else 2000),
        log_handle=log_handle,
        command=["ffmpeg"],
        preview_manifest=preview_manifest,
        preview_warning=None,
    )


def assert_preview_starts_only_for_live_channel() -> None:
    config = {
        "channels": [
            {"name": "channel_1", "enabled": True, "stream_key_env": "abcd-efgh-ijkl"},
        ]
    }

    original_state = web_ui.STATE
    original_load_config = web_ui.stream_manager.load_config
    original_preview_manifest_path = web_ui.stream_manager.preview_manifest_path
    original_start_preview_stream = web_ui.stream_manager.start_preview_stream
    original_stop_stream = web_ui.stream_manager.stop_stream
    original_clear_directory = web_ui.stream_manager.clear_directory
    original_record_event = app_db.record_event

    with tempfile.TemporaryDirectory(prefix="castarro-preview-lifecycle-", dir=str(ROOT)) as temp_dir:
        temp_root = Path(temp_dir)
        preview_manifest = temp_root / ".runtime" / "preview" / "channel_1" / "index.m3u8"

        def fake_load_config(_path: Path):
            return config, temp_root

        def fake_preview_manifest_path(_config_dir: Path, _config: dict, _channel: dict) -> Path:
            return preview_manifest

        def fake_start_preview_stream(_config_dir: Path, _config: dict, channel: dict, manifest: Path):
            return fake_running_stream(str(channel.get("name") or ""), log_dir=temp_root / "logs", preview_manifest=manifest)

        def fake_stop_stream(running: stream_manager.RunningStream) -> None:
            running.process.returncode = 0
            running.log_handle.close()

        try:
            web_ui.STATE = web_ui.AppState()
            main_running = fake_running_stream("channel_1", log_dir=temp_root / "logs")
            web_ui.STATE.streams["channel_1"] = web_ui.StreamState("config.ready.json", main_running)
            web_ui.stream_manager.load_config = fake_load_config
            web_ui.stream_manager.preview_manifest_path = fake_preview_manifest_path
            web_ui.stream_manager.start_preview_stream = fake_start_preview_stream
            web_ui.stream_manager.stop_stream = fake_stop_stream
            web_ui.stream_manager.clear_directory = lambda _path: None
            app_db.record_event = lambda *args, **kwargs: None

            preview = web_ui.start_preview("config.ready.json", "channel_1")
            assert preview["channel"] == "channel_1", "Preview should start for the requested live channel."
            assert web_ui.STATE.preview is not None, "Preview state should be retained while active."

            allowed = web_ui.preview_file_for_request("channel_1", "index.m3u8")
            blocked = web_ui.preview_file_for_request("other", "index.m3u8")
            assert allowed == preview_manifest, "Preview file routing should resolve for the active preview channel."
            assert blocked is None, "Preview file routing should reject other channels."

            stopped = web_ui.stop_preview("channel_1")
            assert stopped == "channel_1", "Preview stop should report the channel that was active."
            assert web_ui.STATE.preview is None, "Preview state should clear after stop."
        finally:
            if main_running.log_handle and not main_running.log_handle.closed:
                main_running.log_handle.close()
            web_ui.STATE = original_state
            web_ui.stream_manager.load_config = original_load_config
            web_ui.stream_manager.preview_manifest_path = original_preview_manifest_path
            web_ui.stream_manager.start_preview_stream = original_start_preview_stream
            web_ui.stream_manager.stop_stream = original_stop_stream
            web_ui.stream_manager.clear_directory = original_clear_directory
            app_db.record_event = original_record_event


def main() -> int:
    assert_preview_starts_only_for_live_channel()
    print("preview_lifecycle_test: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
