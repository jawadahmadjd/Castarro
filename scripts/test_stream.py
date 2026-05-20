#!/usr/bin/env python3
"""Test a channel's stream pipeline without sending anything to YouTube."""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

import stream_manager


def playlist_media_paths(playlist_path: Path) -> list[str]:
    """Extract source media paths from an ffconcat playlist."""
    paths: list[str] = []
    for raw in playlist_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line.startswith("file "):
            continue
        value = line[5:].strip()
        if value.startswith("'") and value.endswith("'") and len(value) >= 2:
            value = value[1:-1].replace("'\\''", "'")
        paths.append(value)
    return paths


def test_channel(config_path: Path, channel_name: str, seconds: int) -> int:
    config, config_dir = stream_manager.load_config(config_path)
    channels = stream_manager.enabled_channels(config, channel_name)
    if not channels:
        raise SystemExit("No channel selected.")

    channel = channels[0]
    defaults = config.get("defaults", {})
    runtime_dir = stream_manager.resolve_path(config_dir, defaults.get("runtime_dir", ".runtime"))
    playlist_path = stream_manager.write_concat_playlist(defaults, config_dir, runtime_dir, channel)
    ffmpeg = str(channel.get("ffmpeg_path") or defaults.get("ffmpeg_path", "ffmpeg"))

    command = [
        ffmpeg,
        "-hide_banner",
        "-nostdin",
        "-t",
        str(seconds),
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(playlist_path),
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
    ]

    if stream_manager.transcode_enabled(config, channel):
        command += stream_manager.transcode_args(config, channel)
    else:
        command += [
            "-c",
            "copy",
        ]

    command += [
        "-f",
        "null",
        "-",
    ]

    print(f"TASK channel={channel['name']} total=1", flush=True)
    print(f"FILE 1/1 test local stream for {seconds}s", flush=True)
    print("This test reads the same ready-to-live files but does not send anything to YouTube.", flush=True)
    media_paths = playlist_media_paths(playlist_path)
    if media_paths:
        for index, media_path in enumerate(media_paths, start=1):
            print(f"VIDEO {index}/{len(media_paths)} path={media_path}", flush=True)
    else:
        print(f"PLAYLIST path={playlist_path}", flush=True)
    completed = subprocess.run(command)
    if completed.returncode == 0:
        print("PROGRESS file=1 total=1 percent=100", flush=True)
        print("Test stream finished successfully.", flush=True)
    return completed.returncode


def main() -> int:
    parser = argparse.ArgumentParser(description="Test stream pipeline without RTMP output.")
    parser.add_argument("--config", default="config.json", help="Config JSON file.")
    parser.add_argument("--channel", required=True, help="Channel name to test.")
    parser.add_argument("--seconds", type=int, default=20, help="Seconds to test.")
    args = parser.parse_args()
    return test_channel(Path(args.config).resolve(), args.channel, max(1, args.seconds))


if __name__ == "__main__":
    raise SystemExit(main())
