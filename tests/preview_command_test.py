#!/usr/bin/env python3
"""Regression checks for preview output FFmpeg command construction."""

from __future__ import annotations

import tempfile
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import stream_manager  # noqa: E402


def make_config() -> dict:
    return {
        "defaults": {
            "ffmpeg_path": "ffmpeg",
            "rtmp_base": "rtmp://example.invalid/live2",
            "runtime_dir": ".runtime",
            "normalized_dir": "Go Live",
        },
        "channels": [
            {
                "name": "channel_1",
                "enabled": True,
                "stream_key_env": "abcd-efgh-ijkl",
                "playlist": ["Go Live/channel_1/video-001.mp4"],
                "live_profile": {
                    "mode": "copy",
                },
            }
        ],
    }


def write_fixture_files(root: Path) -> None:
    media = root / "Go Live" / "channel_1" / "video-001.mp4"
    media.parent.mkdir(parents=True, exist_ok=True)
    media.write_bytes(b"fixture")


def build(config: dict, mode: str) -> tuple[list[str], str | None]:
    channel = dict(config["channels"][0])
    live_profile = dict(channel.get("live_profile") or {})
    live_profile["mode"] = mode
    channel["live_profile"] = live_profile
    preview_manifest = stream_manager.preview_manifest_path(Path("."), config, channel)
    command, _, _url, note = stream_manager.build_command(Path("."), config, channel, preview_manifest=preview_manifest)
    return command, note


def assert_transcode_preview_uses_transcode_args() -> None:
    with tempfile.TemporaryDirectory(prefix="castarro-preview-test-", dir=str(ROOT)) as temp_dir:
        temp_root = Path(temp_dir)
        write_fixture_files(temp_root)
        previous_cwd = Path.cwd()
        try:
            # Build command with relative config paths as runtime does.
            import os

            os.chdir(temp_root)
            config = make_config()
            command, _note = build(config, "transcode")
        finally:
            os.chdir(previous_cwd)

    assert command.count("-c:v") == 2, "Expected transcode video encoder flags for both outputs."
    assert "-c copy" not in " ".join(command), "Transcode preview must not fall back to stream copy."


def assert_copy_preview_still_uses_copy() -> None:
    with tempfile.TemporaryDirectory(prefix="castarro-preview-test-", dir=str(ROOT)) as temp_dir:
        temp_root = Path(temp_dir)
        write_fixture_files(temp_root)
        previous_cwd = Path.cwd()
        try:
            import os

            os.chdir(temp_root)
            config = make_config()
            command, _note = build(config, "copy")
        finally:
            os.chdir(previous_cwd)

    copy_tokens = sum(1 for i in range(len(command) - 1) if command[i] == "-c" and command[i + 1] == "copy")
    assert copy_tokens == 2, "Expected stream copy for both outputs in copy mode."


def assert_copy_mode_sets_warning_when_incompatible() -> None:
    with tempfile.TemporaryDirectory(prefix="castarro-preview-test-", dir=str(ROOT)) as temp_dir:
        temp_root = Path(temp_dir)
        write_fixture_files(temp_root)
        previous_cwd = Path.cwd()
        try:
            import os

            os.chdir(temp_root)
            config = make_config()
            # Corrupt the media fixture to trigger compatibility check failure.
            broken_media = temp_root / "Go Live" / "channel_1" / "video-001.mp4"
            broken_media.write_bytes(b"not-a-real-video")
            command, note = build(config, "copy")
        finally:
            os.chdir(previous_cwd)

    copy_tokens = sum(1 for i in range(len(command) - 1) if command[i] == "-c" and command[i + 1] == "copy")
    assert copy_tokens == 2, "Copy mode should remain copy even when preview compatibility fails."
    assert note and note.startswith("Provided video is not fully compatible"), "Expected preview compatibility warning."


def main() -> int:
    assert_transcode_preview_uses_transcode_args()
    assert_copy_preview_still_uses_copy()
    assert_copy_mode_sets_warning_when_incompatible()
    print("preview_command_test: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
