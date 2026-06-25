#!/usr/bin/env python3
"""Regression checks for preview output FFmpeg command construction."""

from __future__ import annotations

import tempfile
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import stream_manager  # noqa: E402
import normalize_media  # noqa: E402


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


def build_preview_only(config: dict, mode: str) -> tuple[list[str], str | None]:
    channel = dict(config["channels"][0])
    live_profile = dict(channel.get("live_profile") or {})
    live_profile["mode"] = mode
    channel["live_profile"] = live_profile
    preview_manifest = stream_manager.preview_manifest_path(Path("."), config, channel)
    command, _, note = stream_manager.build_preview_command(Path("."), config, channel, preview_manifest)
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


def assert_preview_only_copy_uses_single_copy_output() -> None:
    with tempfile.TemporaryDirectory(prefix="castarro-preview-test-", dir=str(ROOT)) as temp_dir:
        temp_root = Path(temp_dir)
        write_fixture_files(temp_root)
        previous_cwd = Path.cwd()
        try:
            import os

            os.chdir(temp_root)
            config = make_config()
            command, _note = build_preview_only(config, "copy")
        finally:
            os.chdir(previous_cwd)

    copy_tokens = sum(1 for i in range(len(command) - 1) if command[i] == "-c" and command[i + 1] == "copy")
    assert copy_tokens == 1, "Preview-only sidecar should only emit one copy output."
    assert "-f" in command and "hls" in command, "Preview-only sidecar should target HLS output."


def assert_adaptive_stream_builds_bounded_ladder_buffer() -> None:
    with tempfile.TemporaryDirectory(prefix="castarro-adaptive-test-", dir=str(ROOT)) as temp_dir:
        temp_root = Path(temp_dir)
        write_fixture_files(temp_root)
        previous_cwd = Path.cwd()
        try:
            import os

            os.chdir(temp_root)
            config = make_config()
            channel = dict(config["channels"][0])
            channel["live_profile"] = {
                "mode": "adaptive",
                "video_encoder": "libx264",
                "fps": 30,
                "adaptive": {
                    "auto_switch": True,
                    "buffer_seconds": 60,
                    "hls_time": 2,
                    "active_variant_id": "720p",
                    "variants": [
                        {"id": "1080p", "label": "1080p", "width": 1920, "height": 1080, "video_bitrate": "6800k", "audio_bitrate": "128k", "enabled": True},
                        {"id": "720p", "label": "720p", "width": 1280, "height": 720, "video_bitrate": "3500k", "audio_bitrate": "128k", "enabled": True},
                        {"id": "480p", "label": "480p", "width": 854, "height": 480, "video_bitrate": "1800k", "audio_bitrate": "96k", "enabled": True},
                    ],
                },
            }
            command, _playlist, _url, _note = stream_manager.build_command(Path("."), config, channel)
            master = temp_root / ".runtime" / "adaptive-buffer" / "channel_1" / "master.m3u8"
        finally:
            os.chdir(previous_cwd)

        command_text = " ".join(command)
        assert "-hls_list_size 30" in command_text, command_text
        assert command_text.count("-f hls") == 3, command_text
        assert "-hls_flags delete_segments+omit_endlist+independent_segments" in command_text, command_text
        assert "-s 1280x720" in command_text, "Active YouTube output should use the selected rung."
        assert master.exists(), "Adaptive mode should write a local master playlist for the rolling buffer."
        assert "480p/index.m3u8" in master.read_text(encoding="utf-8")


def assert_renditions_only_prints_lower_resolution_commands() -> None:
    with tempfile.TemporaryDirectory(prefix="castarro-renditions-test-", dir=str(ROOT)) as temp_dir:
        temp_root = Path(temp_dir)
        source = temp_root / "Go Live" / "channel_1" / "ready-1080.mp4"
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_bytes(b"fixture")
        config = make_config()
        channel = dict(config["channels"][0])
        channel["playlist"] = ["Go Live/channel_1/ready-1080.mp4"]
        channel["live_profile"] = {
            "mode": "adaptive",
            "adaptive": {
                "variants": [
                    {"id": "1080p", "label": "1080p", "width": 1920, "height": 1080, "video_bitrate": "6800k", "audio_bitrate": "128k", "enabled": True},
                    {"id": "720p", "label": "720p", "width": 1280, "height": 720, "video_bitrate": "3500k", "audio_bitrate": "128k", "enabled": True},
                    {"id": "480p", "label": "480p", "width": 854, "height": 480, "video_bitrate": "1800k", "audio_bitrate": "96k", "enabled": True},
                ],
            },
        }
        ready_channel, outputs = normalize_media.normalize_channel_renditions(config, temp_root, channel, False, True)

    output_text = "\n".join(str(path) for path in outputs)
    assert "720p" in output_text and "480p" in output_text, output_text
    assert "1080p" not in output_text, output_text
    assert len(ready_channel["rendition_playlist"]) == 2


def assert_renditions_only_encodes_single_selected_lower_rung() -> None:
    with tempfile.TemporaryDirectory(prefix="castarro-renditions-single-test-", dir=str(ROOT)) as temp_dir:
        temp_root = Path(temp_dir)
        source = temp_root / "Go Live" / "channel_1" / "ready-1080.mp4"
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_bytes(b"fixture")
        config = make_config()
        channel = dict(config["channels"][0])
        channel["playlist"] = ["Go Live/channel_1/ready-1080.mp4"]
        channel["live_profile"] = {
            "mode": "adaptive",
            "adaptive": {
                "variants": [
                    {"id": "1080p", "label": "1080p", "width": 1920, "height": 1080, "video_bitrate": "6800k", "audio_bitrate": "128k", "enabled": False},
                    {"id": "720p", "label": "720p", "width": 1280, "height": 720, "video_bitrate": "3500k", "audio_bitrate": "128k", "enabled": True},
                    {"id": "480p", "label": "480p", "width": 854, "height": 480, "video_bitrate": "1800k", "audio_bitrate": "96k", "enabled": False},
                ],
            },
        }
        ready_channel, outputs = normalize_media.normalize_channel_renditions(config, temp_root, channel, False, True)

    output_text = "\n".join(str(path) for path in outputs)
    assert "720p" in output_text, output_text
    assert "1080p" not in output_text and "480p" not in output_text, output_text
    assert len(ready_channel["rendition_playlist"]) == 1


def main() -> int:
    assert_transcode_preview_uses_transcode_args()
    assert_copy_preview_still_uses_copy()
    assert_copy_mode_sets_warning_when_incompatible()
    assert_preview_only_copy_uses_single_copy_output()
    assert_adaptive_stream_builds_bounded_ladder_buffer()
    assert_renditions_only_prints_lower_resolution_commands()
    assert_renditions_only_encodes_single_selected_lower_rung()
    print("preview_command_test: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
