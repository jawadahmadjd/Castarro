#!/usr/bin/env python3
"""Validate media files for FFmpeg `-c copy` YouTube Live streaming."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import runtime_paths


VIDEO_EXTENSIONS = {".mp4", ".m4v", ".mov", ".flv"}


@dataclass(frozen=True)
class MediaSignature:
    video_codec: str | None
    width: int | None
    height: int | None
    pix_fmt: str | None
    fps: str | None
    audio_codec: str | None
    sample_rate: str | None
    channels: int | None


def load_config(config_path: Path) -> tuple[dict[str, Any], Path]:
    if not config_path.exists():
        raise SystemExit(f"Config not found: {config_path}")
    with config_path.open("r", encoding="utf-8-sig") as fh:
        return runtime_paths.apply_runtime_defaults(json.load(fh)), config_path.parent.resolve()


def resolve_path(config_dir: Path, value: str) -> Path:
    path = Path(value)
    if path.is_absolute():
        return path
    return (config_dir / path).resolve()


def discover_go_live_files(config_dir: Path, config: dict[str, Any], channel: dict[str, Any]) -> list[Path]:
    defaults = config.get("defaults", {})
    go_live_root = resolve_path(config_dir, defaults.get("normalized_dir", "Go Live"))
    channel_dir = go_live_root / str(channel.get("name", ""))
    if not channel_dir.exists():
        return []
    return sorted(
        path for path in channel_dir.iterdir()
        if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS
    )


def media_files(config_dir: Path, config: dict[str, Any], channel: dict[str, Any]) -> list[Path]:
    playlist = channel.get("playlist")
    if not playlist:
        return discover_go_live_files(config_dir, config, channel)
    if isinstance(playlist, list):
        return [resolve_path(config_dir, str(item)) for item in playlist]
    if isinstance(playlist, str):
        playlist_path = resolve_path(config_dir, playlist)
        files: list[Path] = []
        for raw in playlist_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("file "):
                value = line[5:].strip().strip("'").strip('"')
                files.append(resolve_path(config_dir, value))
        return files
    return []


def ffprobe(ffprobe_path: str, path: Path) -> dict[str, Any]:
    command = [
        ffprobe_path,
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_streams",
        str(path),
    ]
    completed = subprocess.run(command, capture_output=True, text=True)
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or "ffprobe failed")
    return json.loads(completed.stdout)


def signature(probe: dict[str, Any]) -> MediaSignature:
    streams = probe.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), {})
    audio = next((s for s in streams if s.get("codec_type") == "audio"), {})
    return MediaSignature(
        video_codec=video.get("codec_name"),
        width=video.get("width"),
        height=video.get("height"),
        pix_fmt=video.get("pix_fmt"),
        fps=video.get("avg_frame_rate"),
        audio_codec=audio.get("codec_name"),
        sample_rate=audio.get("sample_rate"),
        channels=audio.get("channels"),
    )


def print_signature(path: Path, sig: MediaSignature) -> None:
    print(f"  {path.name}")
    print(f"    video: {sig.video_codec} {sig.width}x{sig.height} {sig.pix_fmt} fps={sig.fps}")
    print(f"    audio: {sig.audio_codec or 'none'} sample_rate={sig.sample_rate or '-'} channels={sig.channels or '-'}")


def validate_channel(config_dir: Path, config: dict[str, Any], ffprobe_path: str, channel: dict[str, Any]) -> bool:
    name = channel.get("name", "<unnamed>")
    files = media_files(config_dir, config, channel)
    print(f"\n[{name}]")

    if not files:
        print("  FAIL: no media files configured")
        return False

    ok = True
    signatures: list[MediaSignature] = []
    for path in files:
        if not path.exists():
            print(f"  FAIL: missing file {path}")
            ok = False
            continue

        try:
            sig = signature(ffprobe(ffprobe_path, path))
            signatures.append(sig)
            print_signature(path, sig)
        except Exception as exc:
            print(f"  FAIL: ffprobe failed for {path}: {exc}")
            ok = False
            continue

        if sig.video_codec != "h264":
            print("    WARN: video is not H.264, so YouTube RTMP copy mode is unlikely to work.")
            ok = False
        if sig.audio_codec != "aac":
            print("    WARN: audio is not AAC. YouTube Live strongly expects AAC audio.")
            ok = False

    if len(set(signatures)) > 1:
        print("  WARN: playlist files do not have identical stream settings.")
        print("        For concat + -c copy, keep codec, resolution, fps, pixel format, and audio settings identical.")
        ok = False

    if ok:
        print("  PASS: compatible with the no-reencode streaming path.")
    return ok


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate media for no-reencode FFmpeg streaming.")
    parser.add_argument("--config", default="config.json", help="Path to config JSON.")
    parser.add_argument("--channel", help="Validate one channel by name.")
    args = parser.parse_args()

    config_path = Path(args.config).resolve()
    config, config_dir = load_config(config_path)
    ffprobe_path = str(config.get("defaults", {}).get("ffprobe_path", "ffprobe"))

    channels = config.get("channels", [])
    if args.channel:
        channels = [ch for ch in channels if ch.get("name") == args.channel]
        if not channels:
            raise SystemExit(f"Unknown channel: {args.channel}")

    all_ok = True
    for channel in channels:
        if not channel.get("enabled", True) and not args.channel:
            continue
        all_ok = validate_channel(config_dir, config, ffprobe_path, channel) and all_ok

    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
