#!/usr/bin/env python3
"""Normalize source media once so live streaming can use cheap `-c copy`.

This is the backend "make it clean" stage: every source file is transcoded into
one consistent H.264/AAC MP4 profile, then a ready-to-stream config is written.
"""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import Any

import runtime_paths


DEFAULT_PROFILE: dict[str, Any] = {
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "video_encoder": "libx264",
    "rate_control": "vbr",
    "video_bitrate": "6000k",
    "video_minrate": "4500k",
    "video_maxrate": "6800k",
    "video_bufsize": "12000k",
    "audio_bitrate": "160k",
    "audio_sample_rate": 48000,
    "x264_preset": "medium",
    "x264_profile": "high",
}


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


def concat_escape(path: Path) -> str:
    text = path.resolve().as_posix()
    return "file '" + text.replace("'", "'\\''") + "'"


def channel_sources(config_dir: Path, channel: dict[str, Any]) -> list[Path]:
    playlist = channel.get("raw_playlist") or channel.get("playlist")
    if isinstance(playlist, list):
        return [resolve_path(config_dir, str(item)) for item in playlist]

    if isinstance(playlist, str):
        playlist_path = resolve_path(config_dir, playlist)
        if not playlist_path.exists():
            raise SystemExit(f"Playlist file does not exist: {playlist_path}")

        sources: list[Path] = []
        for raw in playlist_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("file "):
                value = line[5:].strip().strip("'").strip('"')
                sources.append(resolve_path(config_dir, value))
            else:
                sources.append(resolve_path(config_dir, line))
        return sources

    raise SystemExit(
        f"Channel '{channel.get('name')}' raw_playlist or playlist must be a list or file path."
    )


def profile(config: dict[str, Any], channel: dict[str, Any] | None = None) -> dict[str, Any]:
    merged = dict(DEFAULT_PROFILE)
    merged.update(config.get("normalize_profile", {}))
    if channel:
        merged.update(channel.get("normalize_profile", {}))
    return merged


def build_ffmpeg_command(
    ffmpeg_path: str,
    source: Path,
    output: Path,
    selected_profile: dict[str, Any],
) -> list[str]:
    width = int(selected_profile["width"])
    height = int(selected_profile["height"])
    fps = int(selected_profile["fps"])
    video_encoder = str(selected_profile.get("video_encoder", "libx264") or "libx264")
    rate_control = normalize_rate_control_mode(selected_profile.get("rate_control"))
    video_bitrate = str(selected_profile["video_bitrate"])
    video_minrate = str(selected_profile.get("video_minrate") or "")
    video_maxrate = str(selected_profile.get("video_maxrate") or "")
    video_bufsize = str(selected_profile.get("video_bufsize") or bitrate_times_two(video_bitrate))
    audio_bitrate = str(selected_profile["audio_bitrate"])
    audio_sample_rate = str(selected_profile["audio_sample_rate"])
    keyframe_interval = fps * 2
    vf = (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,"
        f"fps={fps},format=yuv420p"
    )

    if rate_control == "cbr":
        video_minrate = video_bitrate
        video_maxrate = video_bitrate
    else:
        if not video_minrate:
            video_minrate = video_bitrate
        if not video_maxrate:
            video_maxrate = video_bitrate

    return [
        ffmpeg_path,
        "-hide_banner",
        "-y",
        "-progress",
        "pipe:1",
        "-nostats",
        "-i",
        str(source),
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-vf",
        vf,
        "-c:v",
        video_encoder,
        "-preset",
        str(selected_profile["x264_preset"]),
        "-profile:v",
        str(selected_profile["x264_profile"]),
        "-b:v",
        video_bitrate,
        "-minrate",
        video_minrate,
        "-maxrate",
        video_maxrate,
        "-bufsize",
        video_bufsize,
        "-g",
        str(keyframe_interval),
        "-keyint_min",
        str(keyframe_interval),
        "-sc_threshold",
        "0",
        "-c:a",
        "aac",
        "-b:a",
        audio_bitrate,
        "-ar",
        audio_sample_rate,
        "-ac",
        "2",
        "-movflags",
        "+faststart",
        str(output),
    ]


def probe_duration(ffprobe_path: str, source: Path) -> float | None:
    command = [
        ffprobe_path,
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(source),
    ]
    try:
        completed = subprocess.run(command, capture_output=True, text=True, check=False)
    except OSError:
        return None
    if completed.returncode != 0:
        return None
    try:
        return float(completed.stdout.strip())
    except ValueError:
        return None


def run_ffmpeg_with_progress(command: list[str], duration_seconds: float | None, file_index: int, total_files: int) -> int:
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    assert process.stdout is not None
    last_percent = -1
    for raw_line in process.stdout:
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("out_time_ms=") and duration_seconds and duration_seconds > 0:
            try:
                out_time_seconds = int(line.split("=", 1)[1]) / 1_000_000
            except ValueError:
                continue
            file_percent = max(0, min(99, int((out_time_seconds / duration_seconds) * 100)))
            if file_percent != last_percent:
                print(f"PROGRESS file={file_index} total={total_files} percent={file_percent}", flush=True)
                last_percent = file_percent
        elif line.startswith("progress=end"):
            print(f"PROGRESS file={file_index} total={total_files} percent=100", flush=True)
        elif not line.startswith(("frame=", "fps=", "stream_", "bitrate=", "total_size=", "out_time=", "dup_frames=", "drop_frames=", "speed=", "progress=")):
            print(line, flush=True)
    return process.wait()


def bitrate_times_two(value: str) -> str:
    suffix = ""
    digits = value
    if value[-1:].isalpha():
        suffix = value[-1]
        digits = value[:-1]
    try:
        return f"{int(float(digits) * 2)}{suffix}"
    except ValueError:
        return value


def normalize_rate_control_mode(value: Any) -> str:
    mode = str(value or "vbr").strip().lower()
    return "cbr" if mode == "cbr" else "vbr"


def relative_or_absolute(config_dir: Path, path: Path) -> str:
    try:
        return path.resolve().relative_to(config_dir).as_posix()
    except ValueError:
        return str(path.resolve())


def normalize_channel(
    config: dict[str, Any],
    config_dir: Path,
    channel: dict[str, Any],
    force: bool,
    dry_run: bool,
) -> tuple[dict[str, Any], list[Path]]:
    defaults = config.get("defaults", {})
    ffmpeg_path = str(defaults.get("ffmpeg_path", "ffmpeg"))
    ffprobe_path = str(defaults.get("ffprobe_path", "ffprobe"))
    normalized_root = resolve_path(config_dir, defaults.get("normalized_dir", "Go Live"))
    channel_dir = normalized_root / str(channel["name"])
    channel_dir.mkdir(parents=True, exist_ok=True)
    selected_profile = profile(config, channel)

    normalized_files: list[Path] = []
    sources = channel_sources(config_dir, channel)
    if not sources:
        raise SystemExit(f"Channel '{channel.get('name')}' has no source media.")

    print(f"\n[{channel['name']}] normalizing {len(sources)} file(s)", flush=True)
    print(f"TASK channel={channel['name']} total={len(sources)}", flush=True)
    for index, source in enumerate(sources, start=1):
        if not source.exists():
            raise SystemExit(f"Source file does not exist: {source}")

        output = channel_dir / f"{index:04d}-{source.stem}.mp4"
        normalized_files.append(output)

        if output.exists() and not force:
            print(f"FILE {index}/{len(sources)} skip {source.name}", flush=True)
            print(f"PROGRESS file={index} total={len(sources)} percent=100", flush=True)
            continue

        command = build_ffmpeg_command(ffmpeg_path, source, output, selected_profile)
        print(f"FILE {index}/{len(sources)} encode {source.name} -> {output.name}", flush=True)
        if dry_run:
            print("  " + subprocess.list2cmdline(command), flush=True)
            print(f"PROGRESS file={index} total={len(sources)} percent=100", flush=True)
            continue

        duration_seconds = probe_duration(ffprobe_path, source)
        returncode = run_ffmpeg_with_progress(command, duration_seconds, index, len(sources))
        if returncode != 0:
            raise SystemExit(f"FFmpeg failed for {source} with exit code {returncode}")

    ready_channel = dict(channel)
    ready_channel["playlist"] = [
        relative_or_absolute(config_dir, path) for path in normalized_files
    ]
    return ready_channel, normalized_files


def write_ready_config(
    config: dict[str, Any],
    config_dir: Path,
    ready_channels: list[dict[str, Any]],
    output_config: Path,
) -> None:
    ready_config = dict(config)
    ready_config["channels"] = ready_channels
    output_config.parent.mkdir(parents=True, exist_ok=True)
    output_config.write_text(json.dumps(ready_config, indent=2) + "\n", encoding="utf-8")
    print(f"\nReady config written: {output_config}", flush=True)


def write_concat_playlists(
    config: dict[str, Any],
    config_dir: Path,
    ready_channels: list[dict[str, Any]],
) -> None:
    defaults = config.get("defaults", {})
    playlist_dir = resolve_path(config_dir, defaults.get("normalized_playlist_dir", "playlists"))
    playlist_dir.mkdir(parents=True, exist_ok=True)

    for channel in ready_channels:
        path = playlist_dir / f"{channel['name']}.normalized.txt"
        lines = [concat_escape(resolve_path(config_dir, item)) for item in channel["playlist"]]
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"Normalized playlist written: {path}", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Normalize videos once for copy-mode live streaming.")
    parser.add_argument("--config", default="config.json", help="Source config JSON.")
    parser.add_argument("--output-config", default="config.ready.json", help="Ready-to-stream config JSON.")
    parser.add_argument("--channel", help="Normalize one channel by name.")
    parser.add_argument("--force", action="store_true", help="Re-encode even if output files already exist.")
    parser.add_argument("--dry-run", action="store_true", help="Print FFmpeg commands without encoding.")
    parser.add_argument(
        "--include-disabled",
        action="store_true",
        help="Normalize disabled channels too.",
    )
    args = parser.parse_args()

    config_path = Path(args.config).resolve()
    config, config_dir = load_config(config_path)

    channels = config.get("channels", [])
    if args.channel:
        channels = [ch for ch in channels if ch.get("name") == args.channel]
        if not channels:
            raise SystemExit(f"Unknown channel: {args.channel}")
    elif not args.include_disabled:
        channels = [ch for ch in channels if ch.get("enabled", True)]

    if not channels:
        raise SystemExit("No channels selected for normalization.")

    ready_channels: list[dict[str, Any]] = []
    for channel in channels:
        ready_channel, _files = normalize_channel(config, config_dir, channel, args.force, args.dry_run)
        ready_channels.append(ready_channel)

    if not args.dry_run:
        write_concat_playlists(config, config_dir, ready_channels)
        write_ready_config(config, config_dir, ready_channels, Path(args.output_config).resolve())

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
