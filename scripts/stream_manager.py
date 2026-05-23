#!/usr/bin/env python3
"""Run multiple lightweight FFmpeg file-to-RTMP streams.

The important bit is that FFmpeg uses `-c copy`, so compatible H.264/AAC files
are packetized and paced as live RTMP without being decoded and encoded again.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import signal
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import runtime_paths


VIDEO_EXTENSIONS = {".mp4", ".m4v", ".mov", ".flv"}
DEFAULT_LIVE_PROFILE = {
    "mode": "copy",
    "video_encoder": "libx264",
    "preset": "veryfast",
    "profile": "high",
    "pixel_format": "yuv420p",
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "video_bitrate": "6800k",
    "minrate": "6800k",
    "maxrate": "6800k",
    "bufsize": "13600k",
    "gop_seconds": 2,
    "audio_codec": "aac",
    "audio_bitrate": "128k",
    "audio_sample_rate": 44100,
    "audio_channels": 2,
}


def windows_creation_flags(*, new_process_group: bool = False) -> int:
    if os.name != "nt":
        return 0
    flags = subprocess.CREATE_NO_WINDOW
    if new_process_group:
        flags |= subprocess.CREATE_NEW_PROCESS_GROUP
    return flags


@dataclass
class RunningStream:
    channel: dict[str, Any]
    process: subprocess.Popen
    log_handle: Any
    command: list[str]
    preview_manifest: Path | None = None
    preview_warning: str | None = None


def load_config(config_path: Path) -> tuple[dict[str, Any], Path]:
    if not config_path.exists():
        raise SystemExit(
            f"Config not found: {config_path}\n"
            "Copy config.example.json to config.json and add your stream keys."
        )

    with config_path.open("r", encoding="utf-8-sig") as fh:
        return runtime_paths.apply_runtime_defaults(json.load(fh)), config_path.parent.resolve()


def enabled_channels(config: dict[str, Any], channel_name: str | None) -> list[dict[str, Any]]:
    channels = config.get("channels", [])
    if channel_name:
        matches = [ch for ch in channels if ch.get("name") == channel_name]
        if not matches:
            known = ", ".join(ch.get("name", "<unnamed>") for ch in channels)
            raise SystemExit(f"Unknown channel '{channel_name}'. Known channels: {known}")
        return matches

    return [ch for ch in channels if ch.get("enabled", True)]


def resolve_path(config_dir: Path, value: str) -> Path:
    path = Path(value)
    if path.is_absolute():
        return path
    return (config_dir / path).resolve()


def concat_escape(path: Path) -> str:
    # FFmpeg concat demuxer accepts forward slashes on Windows.
    text = path.resolve().as_posix()
    return "file '" + text.replace("'", "'\\''") + "'"


def discover_go_live_files(config_dir: Path, defaults: dict[str, Any], channel: dict[str, Any]) -> list[Path]:
    go_live_root = resolve_path(config_dir, defaults.get("normalized_dir", "Go Live"))
    channel_dir = go_live_root / str(channel["name"])
    if not channel_dir.exists():
        return []
    return sorted(
        path for path in channel_dir.iterdir()
        if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS
    )


def write_concat_playlist(
    defaults: dict[str, Any],
    config_dir: Path,
    runtime_dir: Path,
    channel: dict[str, Any],
) -> Path:
    playlist = channel.get("playlist")
    if not playlist:
        discovered = discover_go_live_files(config_dir, defaults, channel)
        if not discovered:
            raise SystemExit(
                f"Channel '{channel.get('name')}' has no playlist and no videos in "
                f"{defaults.get('normalized_dir', 'Go Live')}/{channel.get('name')}."
            )
        playlist = [str(path) for path in discovered]

    if isinstance(playlist, str):
        playlist_path = resolve_path(config_dir, playlist)
        if not playlist_path.exists():
            raise SystemExit(f"Playlist file does not exist: {playlist_path}")
        return playlist_path

    if not isinstance(playlist, list):
        raise SystemExit(f"Channel '{channel.get('name')}' playlist must be a list or file path.")

    runtime_dir.mkdir(parents=True, exist_ok=True)
    playlist_path = runtime_dir / f"{channel['name']}.ffconcat.txt"

    lines: list[str] = []
    missing: list[Path] = []
    for item in playlist:
        media_path = resolve_path(config_dir, str(item))
        if not media_path.exists():
            missing.append(media_path)
        lines.append(concat_escape(media_path))

    if missing:
        formatted = "\n".join(f"  - {path}" for path in missing)
        raise SystemExit(f"Missing media files for '{channel.get('name')}':\n{formatted}")

    playlist_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return playlist_path


def output_url(channel: dict[str, Any], defaults: dict[str, Any]) -> str:
    # Primary flow: user fills "stream_key_env" with either an env var name
    # or a direct stream key; app builds final RTMP URL automatically.
    stream_key = str(channel.get("stream_key") or "").strip()
    key_env = str(channel.get("stream_key_env") or "").strip()
    if key_env:
        env_stream_key = str(os.environ.get(key_env) or "").strip()
        if env_stream_key:
            stream_key = env_stream_key
        elif not stream_key:
            inferred_key = infer_inline_key_from_env_field(key_env)
            if inferred_key:
                stream_key = inferred_key
            else:
                raise SystemExit(
                    f"Environment variable {key_env} is not set for channel '{channel.get('name')}'. "
                    "Set that variable or paste the direct key in 'stream_key_env'."
                )

    if stream_key:
        base = str(channel.get("rtmp_base") or defaults.get("rtmp_base")).strip().rstrip("/")
        return f"{base}/{stream_key}"

    # Legacy fallback for old configs that only had rtmp_url.
    legacy_url = str(channel.get("rtmp_url") or "").strip()
    if legacy_url:
        if not url_has_key_segment(legacy_url):
            raise SystemExit(
                f"Channel '{channel.get('name')}' has an incomplete rtmp_url. "
                "Use 'stream_key_env' (env var name or direct key) so the app can build the full URL."
            )
        return legacy_url

    raise SystemExit(
        f"Channel '{channel.get('name')}' needs a stream key in 'stream_key_env' "
        "(env var name or direct key)."
    )


def mask_url(url: str) -> str:
    if "/" not in url:
        return "***"
    prefix, _key = url.rsplit("/", 1)
    return f"{prefix}/***"


def infer_inline_key_from_env_field(value: str | None) -> str | None:
    """Treat obvious key-like values in stream_key_env as a direct stream key."""
    text = str(value or "").strip()
    if not text:
        return None
    if re.fullmatch(r"[A-Za-z0-9_-]{6,}", text) and "-" in text:
        return text
    return None


def url_has_key_segment(url: str) -> bool:
    text = str(url or "").strip().rstrip("/")
    if "/" not in text:
        return False
    segment = text.rsplit("/", 1)[1]
    return bool(re.fullmatch(r"[A-Za-z0-9_-]{6,}", segment))


def preview_manifest_path(config_dir: Path, config: dict[str, Any], channel: dict[str, Any]) -> Path:
    defaults = config.get("defaults", {})
    runtime_dir = resolve_path(config_dir, defaults.get("runtime_dir", ".runtime"))
    channel_name = str(channel.get("name") or "channel").strip()
    safe_channel = re.sub(r"[^A-Za-z0-9._-]+", "-", channel_name).strip("-") or "channel"
    return runtime_dir / "preview" / safe_channel / "index.m3u8"


def clear_directory(path: Path) -> None:
    if not path.exists():
        return
    for child in path.iterdir():
        if child.is_dir():
            shutil.rmtree(child, ignore_errors=True)
        else:
            child.unlink(missing_ok=True)


def parse_int(
    value: Any,
    default: int,
    *,
    minimum: int | None = None,
    maximum: int | None = None,
) -> int:
    try:
        parsed = int(float(str(value)))
    except (TypeError, ValueError):
        parsed = default
    if minimum is not None:
        parsed = max(minimum, parsed)
    if maximum is not None:
        parsed = min(maximum, parsed)
    return parsed


def live_profile(config: dict[str, Any], channel: dict[str, Any]) -> dict[str, Any]:
    defaults = config.get("live_profile", {})
    overrides = channel.get("live_profile", {})
    merged = {
        **DEFAULT_LIVE_PROFILE,
        **(defaults if isinstance(defaults, dict) else {}),
        **(overrides if isinstance(overrides, dict) else {}),
    }
    mode = str(merged.get("mode", "copy")).strip().lower()
    merged["mode"] = "transcode" if mode == "transcode" else "copy"
    return merged


def transcode_enabled(config: dict[str, Any], channel: dict[str, Any]) -> bool:
    return live_profile(config, channel).get("mode") == "transcode"


def transcode_args(config: dict[str, Any], channel: dict[str, Any]) -> list[str]:
    profile = live_profile(config, channel)
    encoder = str(profile.get("video_encoder") or "libx264").strip()
    preset = str(profile.get("preset") or "").strip()
    video_profile = str(profile.get("profile") or "").strip()
    pixel_format = str(profile.get("pixel_format") or "yuv420p").strip()
    audio_codec = str(profile.get("audio_codec") or "aac").strip()
    video_bitrate = str(profile.get("video_bitrate") or "6800k").strip()
    minrate = str(profile.get("minrate") or video_bitrate).strip()
    maxrate = str(profile.get("maxrate") or video_bitrate).strip()
    bufsize = str(profile.get("bufsize") or "13600k").strip()
    audio_bitrate = str(profile.get("audio_bitrate") or "128k").strip()
    width = parse_int(profile.get("width"), 1920, minimum=16)
    height = parse_int(profile.get("height"), 1080, minimum=16)
    fps = parse_int(profile.get("fps"), 30, minimum=1, maximum=120)
    gop_seconds = parse_int(profile.get("gop_seconds"), 2, minimum=1, maximum=10)
    gop = max(1, fps * gop_seconds)
    audio_sample_rate = parse_int(profile.get("audio_sample_rate"), 44100, minimum=8000, maximum=192000)
    audio_channels = parse_int(profile.get("audio_channels"), 2, minimum=1, maximum=2)

    args: list[str] = [
        "-s",
        f"{width}x{height}",
        "-r",
        str(fps),
        "-c:v",
        encoder,
        "-pix_fmt",
        pixel_format,
        "-b:v",
        video_bitrate,
        "-minrate",
        minrate,
        "-maxrate",
        maxrate,
        "-bufsize",
        bufsize,
        "-g",
        str(gop),
        "-c:a",
        audio_codec,
        "-b:a",
        audio_bitrate,
        "-ar",
        str(audio_sample_rate),
        "-ac",
        str(audio_channels),
    ]
    if preset:
        args += ["-preset", preset]
    if video_profile:
        args += ["-profile:v", video_profile]
    return args


def concat_playlist_media_paths(playlist_path: Path) -> list[Path]:
    paths: list[Path] = []
    for raw in playlist_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line.startswith("file "):
            continue
        value = line[5:].strip()
        if value.startswith("'") and value.endswith("'") and len(value) >= 2:
            value = value[1:-1].replace("'\\''", "'")
        paths.append(Path(value))
    return paths


def ffprobe_signature(ffprobe_path: str, media_path: Path) -> tuple[tuple[Any, ...] | None, str | None]:
    command = [
        ffprobe_path,
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_streams",
        str(media_path),
    ]
    try:
        completed = subprocess.run(command, capture_output=True, text=True)
    except OSError as exc:
        return None, f"ffprobe unavailable: {exc}"
    if completed.returncode != 0:
        message = (completed.stderr or completed.stdout or "ffprobe failed").strip()
        return None, message

    try:
        payload = json.loads(completed.stdout or "{}")
    except json.JSONDecodeError:
        return None, "ffprobe returned invalid JSON."

    streams = payload.get("streams", [])
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), {})
    audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), {})
    signature = (
        video.get("codec_name"),
        video.get("width"),
        video.get("height"),
        video.get("pix_fmt"),
        video.get("avg_frame_rate"),
        audio.get("codec_name"),
        audio.get("sample_rate"),
        audio.get("channels"),
    )
    return signature, None


def preview_copy_compatibility(
    config: dict[str, Any],
    channel: dict[str, Any],
    defaults: dict[str, Any],
    playlist_path: Path,
) -> tuple[bool, list[str]]:
    ffprobe_path = str(channel.get("ffprobe_path") or defaults.get("ffprobe_path", "ffprobe")).strip() or "ffprobe"
    media_paths = concat_playlist_media_paths(playlist_path)
    if not media_paths:
        return False, ["playlist has no readable media entries"]

    issues: list[str] = []
    signatures: list[tuple[Any, ...]] = []
    for media in media_paths:
        if not media.exists():
            issues.append(f"missing file: {media}")
            continue
        signature, probe_error = ffprobe_signature(ffprobe_path, media)
        if probe_error:
            issues.append(f"{media.name}: {probe_error}")
            continue
        assert signature is not None
        signatures.append(signature)
        video_codec = signature[0]
        audio_codec = signature[5]
        if video_codec != "h264":
            issues.append(f"{media.name}: video codec is {video_codec or 'unknown'} (needs h264 for copy preview).")
        if audio_codec and audio_codec != "aac":
            issues.append(f"{media.name}: audio codec is {audio_codec} (aac is safest for preview).")

    if len(set(signatures)) > 1:
        issues.append("playlist streams are mixed (codec/resolution/fps/audio mismatch).")

    return len(issues) == 0, issues


def build_command(
    config_dir: Path,
    config: dict[str, Any],
    channel: dict[str, Any],
    preview_manifest: Path | None = None,
) -> tuple[list[str], Path, str, str | None]:
    defaults = config.get("defaults", {})
    runtime_dir = resolve_path(config_dir, defaults.get("runtime_dir", ".runtime"))
    playlist_path = write_concat_playlist(defaults, config_dir, runtime_dir, channel)
    ffmpeg = str(channel.get("ffmpeg_path") or defaults.get("ffmpeg_path", "ffmpeg"))
    url = output_url(channel, defaults)

    command = [
        ffmpeg,
        "-hide_banner",
        "-nostdin",
        "-re",
    ]

    if channel.get("loop", True):
        command += ["-stream_loop", "-1"]

    command += [
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

    stream_output_args = ["-c", "copy"]
    if transcode_enabled(config, channel):
        stream_output_args = transcode_args(config, channel)
    preview_warning: str | None = None

    if preview_manifest is None:
        command += [
            *stream_output_args,
            "-flvflags",
            "no_duration_filesize",
            "-f",
            "flv",
            url,
        ]
        return command, playlist_path, url, preview_warning

    if not transcode_enabled(config, channel):
        copy_safe, issues = preview_copy_compatibility(config, channel, defaults, playlist_path)
        if not copy_safe:
            preview_warning = (
                "Provided video is not fully compatible and you have to normalize the video first to get live preview."
            )

    segment_pattern = preview_manifest.parent / "segment_%05d.ts"
    command += [
        *stream_output_args,
        "-flvflags",
        "no_duration_filesize",
        "-f",
        "flv",
        url,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        *stream_output_args,
        "-hls_time",
        "2",
        "-hls_list_size",
        "6",
        "-hls_flags",
        "delete_segments+append_list+omit_endlist",
        "-hls_segment_type",
        "mpegts",
        "-hls_segment_filename",
        str(segment_pattern),
        "-f",
        "hls",
        str(preview_manifest),
    ]
    return command, playlist_path, url, preview_warning


def log_path(config_dir: Path, config: dict[str, Any], channel: dict[str, Any]) -> Path:
    defaults = config.get("defaults", {})
    log_dir = resolve_path(config_dir, defaults.get("log_dir", "logs"))
    log_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return log_dir / f"{channel['name']}-{stamp}.log"


def start_stream(
    config_dir: Path,
    config: dict[str, Any],
    channel: dict[str, Any],
    preview_manifest: Path | None = None,
) -> RunningStream:
    if preview_manifest is not None:
        preview_manifest.parent.mkdir(parents=True, exist_ok=True)
        clear_directory(preview_manifest.parent)
    command, _playlist_path, url, preview_warning = build_command(config_dir, config, channel, preview_manifest)
    path = log_path(config_dir, config, channel)
    log_handle = path.open("ab")
    if preview_warning:
        log_handle.write((f"PREVIEW_WARNING {preview_warning}\n").encode("utf-8", errors="replace"))
        log_handle.flush()

    print(f"[{channel['name']}] starting -> {mask_url(url)}")
    print(f"[{channel['name']}] log: {path}")

    process = subprocess.Popen(
        command,
        cwd=str(config_dir),
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        creationflags=windows_creation_flags(new_process_group=True),
    )
    print(f"[{channel['name']}] pid: {process.pid}")
    return RunningStream(
        channel=channel,
        process=process,
        log_handle=log_handle,
        command=command,
        preview_manifest=preview_manifest,
        preview_warning=preview_warning,
    )


def stop_stream(stream: RunningStream) -> None:
    name = stream.channel.get("name", "<unnamed>")
    if stream.process.poll() is None:
        print(f"[{name}] stopping pid {stream.process.pid}")
        try:
            if os.name == "nt":
                stream.process.send_signal(signal.CTRL_BREAK_EVENT)
                try:
                    stream.process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    stream.process.terminate()
            else:
                stream.process.terminate()
        except Exception:
            stream.process.terminate()

        try:
            stream.process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            stream.process.kill()

    stream.log_handle.close()


def command_as_text(command: list[str], masked_url: str) -> str:
    safe = command[:-1] + [masked_url]
    return subprocess.list2cmdline(safe)


def start_all(config_path: Path, channel_name: str | None) -> None:
    config, config_dir = load_config(config_path)
    channels = enabled_channels(config, channel_name)
    if not channels:
        raise SystemExit("No enabled channels found.")

    running: dict[str, RunningStream] = {}
    next_restart: dict[str, float] = {}
    restart_delay = float(config.get("defaults", {}).get("restart_delay_seconds", 10))

    try:
        for channel in channels:
            running[channel["name"]] = start_stream(config_dir, config, channel)

        print("All requested streams are running. Press Ctrl+C to stop.")
        while True:
            time.sleep(2)
            now = time.time()

            for channel in channels:
                name = channel["name"]
                stream = running.get(name)
                if stream and stream.process.poll() is None:
                    continue

                if stream:
                    exit_code = stream.process.returncode
                    stream.log_handle.close()
                    running.pop(name, None)
                    print(f"[{name}] exited with code {exit_code}")

                if not channel.get("restart_on_exit", True):
                    continue

                if name not in next_restart:
                    next_restart[name] = now + restart_delay
                    print(f"[{name}] restart scheduled in {restart_delay:g}s")

                if now >= next_restart[name]:
                    running[name] = start_stream(config_dir, config, channel)
                    next_restart.pop(name, None)

    except KeyboardInterrupt:
        print("\nStopping streams...")
    finally:
        for stream in list(running.values()):
            stop_stream(stream)


def print_commands(config_path: Path, channel_name: str | None, reveal_keys: bool) -> None:
    config, config_dir = load_config(config_path)
    for channel in enabled_channels(config, channel_name):
        command, _playlist_path, url, _preview_note = build_command(config_dir, config, channel)
        final_url = url if reveal_keys else mask_url(url)
        print(f"\n[{channel['name']}]")
        print(command_as_text(command, final_url))


def main() -> int:
    parser = argparse.ArgumentParser(description="Manage multiple FFmpeg RTMP streams.")
    parser.add_argument("--config", default="config.json", help="Path to config JSON.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    start_parser = subparsers.add_parser("start", help="Start enabled streams.")
    start_parser.add_argument("--channel", help="Start one channel by name.")

    command_parser = subparsers.add_parser("print-command", help="Print FFmpeg commands.")
    command_parser.add_argument("--channel", help="Print one channel by name.")
    command_parser.add_argument("--reveal-keys", action="store_true", help="Do not mask stream keys.")

    args = parser.parse_args()
    config_path = Path(args.config).resolve()

    if args.command == "start":
        start_all(config_path, args.channel)
        return 0

    if args.command == "print-command":
        print_commands(config_path, args.channel, args.reveal_keys)
        return 0

    parser.error(f"Unknown command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
