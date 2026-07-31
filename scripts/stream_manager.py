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
import threading
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
    "adaptive": {
        "auto_switch": True,
        "buffer_seconds": 60,
        "hls_time": 2,
        "active_variant_id": "1080p",
        "variants": [
            {"id": "1080p", "label": "1080p", "width": 1920, "height": 1080, "video_bitrate": "6800k", "audio_bitrate": "128k", "enabled": True},
            {"id": "720p", "label": "720p", "width": 1280, "height": 720, "video_bitrate": "3500k", "audio_bitrate": "128k", "enabled": True},
            {"id": "480p", "label": "480p", "width": 854, "height": 480, "video_bitrate": "1800k", "audio_bitrate": "96k", "enabled": True},
        ],
    },
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
    log_thread: threading.Thread | None = None
    monitor_thread: threading.Thread | None = None
    started_monotonic: float = 0.0
    kind: str = "stream"
    masked_output_url: str | None = None
    log_redactions: tuple[tuple[str, str], ...] = ()
    playlist_path: Path | None = None
    stop_requested: bool = False
    stop_request_source: str = ""
    stop_request_reason: str = ""


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


def source_url(value: str) -> bool:
    text = str(value or "").strip().lower()
    return text.startswith("http://") or text.startswith("https://")


def concat_escape_source(value: str | Path) -> str:
    if isinstance(value, Path):
        return concat_escape(value)
    text = str(value or "").strip()
    if source_url(text):
        return "file '" + text.replace("'", "'\\''") + "'"
    return concat_escape(Path(text))


def cloud_playlist_sources(channel: dict[str, Any]) -> list[str]:
    sources: list[str] = []
    raw = channel.get("cloud_playlist", [])
    if not isinstance(raw, list):
        return sources
    for item in raw:
        if not isinstance(item, dict):
            continue
        source = str(
            item.get("proxy_url")
            or item.get("source_url")
            or item.get("sourceUri")
            or item.get("source_uri")
            or ""
        ).strip()
        if source_url(source):
            sources.append(source)
            continue
        provider_id = str(item.get("provider_id") or item.get("providerId") or "").strip()
        file_id = str(item.get("file_id") or item.get("provider_file_id") or item.get("providerFileId") or "").strip()
        label = str(item.get("display_name") or item.get("displayName") or file_id or "cloud video").strip()
        if provider_id or file_id:
            raise SystemExit(
                f"Cloud video '{label}' for channel '{channel.get('name')}' has not been prepared by the source proxy yet."
            )
    return sources


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
    stream_item: dict[str, Any] | None = None,
) -> tuple[Path, bool]:
    stream_id = str(stream_item.get("id") or "") if isinstance(stream_item, dict) else ""
    playlist = stream_item.get("playlist") if isinstance(stream_item, dict) and stream_item.get("playlist") else channel.get("playlist")
    network_inputs = False
    if not playlist:
        cloud_sources = cloud_playlist_sources(channel)
        if cloud_sources:
            playlist = cloud_sources
            network_inputs = True
        discovered = [] if playlist else discover_go_live_files(config_dir, defaults, channel)
        if not discovered:
            if not playlist:
                raise SystemExit(
                    f"Channel '{channel.get('name')}' has no playlist and no videos in "
                    f"{defaults.get('normalized_dir', 'Go Live')}/{channel.get('name')}."
                )
        if not playlist:
            playlist = [str(path) for path in discovered]

    if isinstance(playlist, str):
        playlist_path = resolve_path(config_dir, playlist)
        if not playlist_path.exists():
            raise SystemExit(f"Playlist file does not exist: {playlist_path}")
        return playlist_path, False

    if not isinstance(playlist, list):
        raise SystemExit(f"Channel '{channel.get('name')}' playlist must be a list or file path.")

    runtime_dir.mkdir(parents=True, exist_ok=True)
    suffix = f"_{stream_id}" if stream_id else ""
    playlist_path = runtime_dir / f"{channel['name']}{suffix}.ffconcat.txt"

    lines: list[str] = []
    missing: list[Path] = []
    for item in playlist:
        text = str(item)
        if source_url(text):
            network_inputs = True
            lines.append(concat_escape_source(text))
            continue
        media_path = resolve_path(config_dir, text)
        if not media_path.exists():
            missing.append(media_path)
        lines.append(concat_escape_source(media_path))

    if missing:
        formatted = "\n".join(f"  - {path}" for path in missing)
        raise SystemExit(f"Missing media files for '{channel.get('name')}':\n{formatted}")

    playlist_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return playlist_path, network_inputs


def output_url(channel: dict[str, Any], defaults: dict[str, Any], stream_item: dict[str, Any] | None = None) -> str:
    # Primary flow: user fills "stream_key_env" with either an env var name
    # or a direct stream key; app builds final RTMP URL automatically.
    target_obj = stream_item if isinstance(stream_item, dict) and (stream_item.get("stream_key") or stream_item.get("stream_key_env")) else channel
    stream_key = str(target_obj.get("stream_key") or "").strip()
    key_env = str(target_obj.get("stream_key_env") or "").strip()
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


def stream_key_reference(channel_name: Any) -> str:
    name = str(channel_name or "channel").strip() or "channel"
    return f"[{name} stream key]"


def mask_url(url: str, replacement: str = "***") -> str:
    if "/" not in url:
        return replacement
    prefix, _key = url.rsplit("/", 1)
    return f"{prefix}/{replacement}"


def stream_log_redactions(url: str, channel_name: Any) -> tuple[tuple[str, str], ...]:
    key_ref = stream_key_reference(channel_name)
    redactions: list[tuple[str, str]] = []
    if url:
        redactions.append((url, mask_url(url, key_ref)))
        if "/" in url:
            _prefix, key = url.rsplit("/", 1)
            if key:
                redactions.append((key, key_ref))
    return tuple(redactions)


def sanitize_stream_log_message(message: str, redactions: tuple[tuple[str, str], ...]) -> str:
    safe = message
    for secret, replacement in redactions:
        if secret:
            safe = safe.replace(secret, replacement)
    return safe


def stream_log_level(config: dict[str, Any], channel: dict[str, Any]) -> str:
    defaults = config.get("defaults", {})
    value = str(channel.get("stream_log_level") or defaults.get("stream_log_level") or "").strip()
    return value or "repeat+level+verbose"


def log_timestamp() -> str:
    return datetime.now().astimezone().isoformat(timespec="milliseconds")


def write_log_line(log_handle: Any, line: str) -> None:
    text = str(line)
    if not text.endswith("\n"):
        text += "\n"
    try:
        log_handle.write(text)
    except TypeError:
        log_handle.write(text.encode("utf-8", errors="replace"))
    log_handle.flush()


def write_timestamped_log_line(log_handle: Any, message: str) -> None:
    write_log_line(log_handle, f"{log_timestamp()} | {message}")


def signed_returncode(returncode: int | None) -> int | None:
    if returncode is None:
        return None
    if returncode > 0x7FFFFFFF:
        return returncode - 0x100000000
    return returncode


RECOVERABLE_NETWORK_RETURNCODES = {-10053, -10054, -10060}
RECOVERABLE_NETWORK_LOG_PATTERNS = (
    "broken pipe",
    "connection reset",
    "connection timed out",
    "connection refused",
    "connection aborted",
    "error writing trailer",
    "failed to update header",
    "i/o error",
    "network is unreachable",
    "no route to host",
    "server returned 5",
    "wsaeconnaborted",
    "wsaeconnreset",
    "wsaetimedout",
)


def is_recoverable_network_exit(returncode: int | None, log_tail: str = "") -> bool:
    signed = signed_returncode(returncode)
    if signed in RECOVERABLE_NETWORK_RETURNCODES:
        return True
    if signed == 0 or returncode is None:
        return False
    lowered = str(log_tail or "").lower()
    return any(pattern in lowered for pattern in RECOVERABLE_NETWORK_LOG_PATTERNS)


def describe_returncode(returncode: int | None, *, stop_requested: bool = False) -> str:
    if returncode is None:
        return "still running"

    signed = signed_returncode(returncode)
    if signed == 0:
        return "stopped by user request" if stop_requested else "completed successfully"

    windows_errors = {
        -10053: "network connection aborted locally (WSAECONNABORTED)",
        -10054: "network connection reset by remote host (WSAECONNRESET)",
        -10060: "network connection timed out (WSAETIMEDOUT)",
        -1073741510: "interrupted by console control signal",
    }
    if signed in windows_errors:
        if stop_requested and signed == -1073741510:
            return "stopped by user request"
        return windows_errors[signed]

    if stop_requested:
        return "stopped by user request"

    if signed is not None and signed < 0:
        return f"windows error {signed}"
    return f"exit code {signed}"


def log_session_header(
    stream: RunningStream,
    *,
    channel_name: str,
    log_path: Path,
    command_text: str,
) -> None:
    write_timestamped_log_line(
        stream.log_handle,
        f"SESSION_START kind={stream.kind} channel={json.dumps(channel_name)} pid={stream.process.pid}",
    )
    write_timestamped_log_line(stream.log_handle, f"SESSION_LOG_PATH {log_path}")
    if stream.masked_output_url:
        write_timestamped_log_line(stream.log_handle, f"SESSION_OUTPUT {stream.masked_output_url}")
    if stream.playlist_path:
        write_timestamped_log_line(stream.log_handle, f"SESSION_PLAYLIST {stream.playlist_path}")
    if stream.preview_manifest:
        write_timestamped_log_line(stream.log_handle, f"SESSION_PREVIEW_MANIFEST {stream.preview_manifest}")
    write_timestamped_log_line(stream.log_handle, f"SESSION_COMMAND {command_text}")
    if stream.preview_warning:
        write_timestamped_log_line(stream.log_handle, f"PREVIEW_WARNING {stream.preview_warning}")


def pump_process_output(stream: RunningStream) -> None:
    stdout = stream.process.stdout
    if stdout is None:
        return
    try:
        for raw_line in stdout:
            line = raw_line.rstrip("\r\n")
            if not line:
                continue
            line = sanitize_stream_log_message(line, stream.log_redactions)
            write_timestamped_log_line(stream.log_handle, line)
    finally:
        try:
            stdout.close()
        except Exception:
            pass


def monitor_stream_exit(stream: RunningStream) -> None:
    returncode = stream.process.wait()
    if stream.log_thread and stream.log_thread.is_alive():
        stream.log_thread.join(timeout=2)
    duration_seconds = max(0.0, time.monotonic() - stream.started_monotonic)
    signed = signed_returncode(returncode)
    reason = describe_returncode(returncode, stop_requested=stream.stop_requested)
    write_timestamped_log_line(
        stream.log_handle,
        "SESSION_EXIT "
        f"kind={stream.kind} "
        f"channel={json.dumps(str(stream.channel.get('name') or '<unnamed>'))} "
        f"pid={stream.process.pid} "
        f"returncode={returncode} "
        f"signed_returncode={signed} "
        f"reason={json.dumps(reason)} "
        f"duration_seconds={duration_seconds:.3f}",
    )


def close_stream_log(stream: RunningStream) -> None:
    if stream.monitor_thread and stream.monitor_thread.is_alive():
        stream.monitor_thread.join(timeout=3)
    if stream.log_thread and stream.log_thread.is_alive():
        stream.log_thread.join(timeout=1)
    if not getattr(stream.log_handle, "closed", False):
        stream.log_handle.close()


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


def adaptive_profile(profile: dict[str, Any]) -> dict[str, Any]:
    raw = profile.get("adaptive") if isinstance(profile.get("adaptive"), dict) else {}
    defaults = DEFAULT_LIVE_PROFILE["adaptive"]
    merged = {**defaults, **(raw if isinstance(raw, dict) else {})}
    merged["buffer_seconds"] = parse_int(merged.get("buffer_seconds"), 60, minimum=10, maximum=60)
    merged["hls_time"] = parse_int(merged.get("hls_time"), 2, minimum=1, maximum=10)
    variants = merged.get("variants")
    if not isinstance(variants, list):
        variants = defaults["variants"]
    cleaned: list[dict[str, Any]] = []
    for index, raw_variant in enumerate(variants):
        if not isinstance(raw_variant, dict):
            continue
        width = parse_int(raw_variant.get("width"), 1920, minimum=16)
        height = parse_int(raw_variant.get("height"), 1080, minimum=16)
        label = str(raw_variant.get("label") or f"{height}p").strip() or f"{height}p"
        variant_id = str(raw_variant.get("id") or label.lower().replace(" ", "-") or f"rung-{index + 1}").strip()
        cleaned.append({
            **raw_variant,
            "id": re.sub(r"[^A-Za-z0-9._-]+", "-", variant_id).strip("-") or f"rung-{index + 1}",
            "label": label,
            "width": width,
            "height": height,
            "video_bitrate": str(raw_variant.get("video_bitrate") or raw_variant.get("bitrate") or "3500k").strip(),
            "minrate": str(raw_variant.get("minrate") or raw_variant.get("video_bitrate") or raw_variant.get("bitrate") or "3500k").strip(),
            "maxrate": str(raw_variant.get("maxrate") or raw_variant.get("video_bitrate") or raw_variant.get("bitrate") or "3500k").strip(),
            "bufsize": str(raw_variant.get("bufsize") or raw_variant.get("video_bufsize") or "7000k").strip(),
            "audio_bitrate": str(raw_variant.get("audio_bitrate") or profile.get("audio_bitrate") or "128k").strip(),
            "enabled": raw_variant.get("enabled") is not False,
        })
    cleaned = [variant for variant in cleaned if variant["enabled"]]
    cleaned.sort(key=lambda item: (parse_int(item.get("height"), 0), parse_int(item.get("width"), 0)), reverse=True)
    if not cleaned:
        cleaned = [dict(item) for item in defaults["variants"]]
    active_id = str(merged.get("active_variant_id") or "").strip()
    if active_id not in {variant["id"] for variant in cleaned}:
        active_id = cleaned[0]["id"]
    merged["variants"] = cleaned
    merged["active_variant_id"] = active_id
    merged["auto_switch"] = merged.get("auto_switch") is not False
    return merged


def live_profile(config: dict[str, Any], channel: dict[str, Any]) -> dict[str, Any]:
    defaults = config.get("live_profile", {})
    overrides = channel.get("live_profile", {})
    merged = {
        **DEFAULT_LIVE_PROFILE,
        **(defaults if isinstance(defaults, dict) else {}),
        **(overrides if isinstance(overrides, dict) else {}),
    }
    mode = str(merged.get("mode", "copy")).strip().lower()
    merged["mode"] = mode if mode in {"copy", "transcode", "adaptive"} else "copy"
    merged["adaptive"] = adaptive_profile(merged)
    return merged


def transcode_enabled(config: dict[str, Any], channel: dict[str, Any]) -> bool:
    return live_profile(config, channel).get("mode") in {"transcode", "adaptive"}


def transcode_args(config: dict[str, Any], channel: dict[str, Any], variant: dict[str, Any] | None = None) -> list[str]:
    profile = live_profile(config, channel)
    variant = variant or {}
    encoder = str(profile.get("video_encoder") or "libx264").strip()
    preset = str(profile.get("preset") or "").strip()
    video_profile = str(profile.get("profile") or "").strip()
    pixel_format = str(profile.get("pixel_format") or "yuv420p").strip()
    audio_codec = str(profile.get("audio_codec") or "aac").strip()
    video_bitrate = str(variant.get("video_bitrate") or profile.get("video_bitrate") or "6800k").strip()
    minrate = str(variant.get("minrate") or profile.get("minrate") or video_bitrate).strip()
    maxrate = str(variant.get("maxrate") or profile.get("maxrate") or video_bitrate).strip()
    bufsize = str(variant.get("bufsize") or profile.get("bufsize") or "13600k").strip()
    audio_bitrate = str(variant.get("audio_bitrate") or profile.get("audio_bitrate") or "128k").strip()
    width = parse_int(variant.get("width") or profile.get("width"), 1920, minimum=16)
    height = parse_int(variant.get("height") or profile.get("height"), 1080, minimum=16)
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


def adaptive_buffer_dir(config_dir: Path, config: dict[str, Any], channel: dict[str, Any]) -> Path:
    defaults = config.get("defaults", {})
    runtime_dir = resolve_path(config_dir, defaults.get("runtime_dir", ".runtime"))
    channel_name = str(channel.get("name") or "channel").strip()
    safe_channel = re.sub(r"[^A-Za-z0-9._-]+", "-", channel_name).strip("-") or "channel"
    return runtime_dir / "adaptive-buffer" / safe_channel


def active_adaptive_variant(profile: dict[str, Any]) -> dict[str, Any]:
    adaptive = adaptive_profile(profile)
    active_id = str(adaptive.get("active_variant_id") or "")
    variants = list(adaptive.get("variants") or [])
    return next((variant for variant in variants if str(variant.get("id")) == active_id), variants[0])


def adaptive_hls_output_args(
    config_dir: Path,
    config: dict[str, Any],
    channel: dict[str, Any],
    variant: dict[str, Any],
) -> list[str]:
    profile = live_profile(config, channel)
    adaptive = adaptive_profile(profile)
    hls_time = parse_int(adaptive.get("hls_time"), 2, minimum=1, maximum=10)
    buffer_seconds = parse_int(adaptive.get("buffer_seconds"), 60, minimum=10, maximum=60)
    list_size = max(1, int((buffer_seconds + hls_time - 1) / hls_time))
    variant_id = str(variant.get("id") or "rung").strip() or "rung"
    buffer_dir = adaptive_buffer_dir(config_dir, config, channel) / variant_id
    buffer_dir.mkdir(parents=True, exist_ok=True)
    manifest = buffer_dir / "index.m3u8"
    segment_pattern = buffer_dir / "segment_%05d.ts"
    return [
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        *transcode_args(config, channel, variant),
        "-hls_time",
        str(hls_time),
        "-hls_list_size",
        str(list_size),
        "-hls_delete_threshold",
        "1",
        "-hls_flags",
        "delete_segments+omit_endlist+independent_segments",
        "-hls_segment_type",
        "mpegts",
        "-hls_segment_filename",
        str(segment_pattern),
        "-f",
        "hls",
        str(manifest),
    ]


def write_adaptive_master_manifest(config_dir: Path, config: dict[str, Any], channel: dict[str, Any]) -> Path:
    profile = live_profile(config, channel)
    variants = adaptive_profile(profile).get("variants") or []
    root = adaptive_buffer_dir(config_dir, config, channel)
    root.mkdir(parents=True, exist_ok=True)
    lines = ["#EXTM3U", "#EXT-X-VERSION:3"]
    for variant in variants:
        bitrate = parse_bitrate_for_manifest(variant.get("video_bitrate")) + parse_bitrate_for_manifest(variant.get("audio_bitrate"))
        resolution = f"{parse_int(variant.get('width'), 0)}x{parse_int(variant.get('height'), 0)}"
        lines.append(f"#EXT-X-STREAM-INF:BANDWIDTH={max(1, bitrate)},RESOLUTION={resolution}")
        lines.append(f"{variant.get('id')}/index.m3u8")
    manifest = root / "master.m3u8"
    manifest.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return manifest


def parse_bitrate_for_manifest(value: Any) -> int:
    text = str(value or "").strip().lower()
    match = re.match(r"^([0-9]+(?:\.[0-9]+)?)\s*([kmg]?)", text)
    if not match:
        return 0
    amount = float(match.group(1))
    suffix = match.group(2)
    return int(amount * {"": 1, "k": 1000, "m": 1000 ** 2, "g": 1000 ** 3}.get(suffix, 1))


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
    stream_item: dict[str, Any] | None = None,
) -> tuple[list[str], Path, str, str | None]:
    defaults = config.get("defaults", {})
    runtime_dir = resolve_path(config_dir, defaults.get("runtime_dir", ".runtime"))
    playlist_path, has_network_inputs = write_concat_playlist(defaults, config_dir, runtime_dir, channel, stream_item=stream_item)
    ffmpeg = str(channel.get("ffmpeg_path") or defaults.get("ffmpeg_path", "ffmpeg"))
    url = output_url(channel, defaults, stream_item=stream_item)
    profile = live_profile(config, channel)
    if has_network_inputs and transcode_enabled(config, channel):
        raise SystemExit(
            f"Channel '{channel.get('name')}' uses cloud/network source inputs, so live transcoding is blocked. "
            "Use copy mode or normalize the videos before streaming."
        )

    command = [
        ffmpeg,
        "-loglevel",
        stream_log_level(config, channel),
        "-nostdin",
        "-progress",
        "pipe:1",
        "-stats_period",
        "1",
        "-thread_queue_size",
        "10240",
        "-re",
    ]

    if channel.get("loop", True):
        command += ["-stream_loop", "-1"]

    command += [
        *(["-protocol_whitelist", "file,http,https,tcp,tls,crypto"] if has_network_inputs else []),
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(playlist_path),
    ]

    stream_output_args = ["-c", "copy"]
    if profile.get("mode") == "adaptive":
        stream_output_args = transcode_args(config, channel, active_adaptive_variant(profile))
    elif transcode_enabled(config, channel):
        stream_output_args = transcode_args(config, channel)
    preview_warning: str | None = None

    if preview_manifest is None:
        command += [
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            *stream_output_args,
            "-flvflags",
            "no_duration_filesize",
            "-f",
            "flv",
            url,
        ]
        if profile.get("mode") == "adaptive":
            buffer_root = adaptive_buffer_dir(config_dir, config, channel)
            clear_directory(buffer_root)
            write_adaptive_master_manifest(config_dir, config, channel)
            for variant in adaptive_profile(profile).get("variants") or []:
                command += adaptive_hls_output_args(config_dir, config, channel, variant)
        return command, playlist_path, url, preview_warning

    if not transcode_enabled(config, channel):
        copy_safe, issues = preview_copy_compatibility(config, channel, defaults, playlist_path)
        if not copy_safe:
            preview_warning = (
                "Provided video is not fully compatible and you have to normalize the video first to get live preview."
            )

    segment_pattern = preview_manifest.parent / "segment_%05d.ts"
    command += [
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
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


def log_path(
    config_dir: Path,
    config: dict[str, Any],
    channel: dict[str, Any],
    *,
    suffix: str = "",
) -> Path:
    defaults = config.get("defaults", {})
    log_dir = resolve_path(config_dir, defaults.get("log_dir", "logs"))
    log_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    safe_suffix = f"-{suffix}" if suffix else ""
    return log_dir / f"{channel['name']}{safe_suffix}-{stamp}.log"


def build_preview_command(
    config_dir: Path,
    config: dict[str, Any],
    channel: dict[str, Any],
    preview_manifest: Path,
) -> tuple[list[str], Path, str | None]:
    defaults = config.get("defaults", {})
    runtime_dir = resolve_path(config_dir, defaults.get("runtime_dir", ".runtime"))
    playlist_path, has_network_inputs = write_concat_playlist(defaults, config_dir, runtime_dir, channel)
    ffmpeg = str(channel.get("ffmpeg_path") or defaults.get("ffmpeg_path", "ffmpeg"))

    command = [
        ffmpeg,
        "-loglevel",
        stream_log_level(config, channel),
        "-nostdin",
        "-progress",
        "pipe:1",
        "-stats_period",
        "1",
        "-thread_queue_size",
        "10240",
        "-re",
    ]

    if channel.get("loop", True):
        command += ["-stream_loop", "-1"]

    command += [
        *(["-protocol_whitelist", "file,http,https,tcp,tls,crypto"] if has_network_inputs else []),
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

    output_args = ["-c", "copy"]
    if transcode_enabled(config, channel):
        output_args = transcode_args(config, channel)
    preview_warning: str | None = None

    if not transcode_enabled(config, channel):
        copy_safe, _issues = preview_copy_compatibility(config, channel, defaults, playlist_path)
        if not copy_safe:
            preview_warning = (
                "Provided video is not fully compatible and you have to normalize the video first to get live preview."
            )

    segment_pattern = preview_manifest.parent / "segment_%05d.ts"
    command += [
        *output_args,
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
    return command, playlist_path, preview_warning


def start_stream(
    config_dir: Path,
    config: dict[str, Any],
    channel: dict[str, Any],
    preview_manifest: Path | None = None,
    stream_item: dict[str, Any] | None = None,
) -> RunningStream:
    if preview_manifest is not None:
        preview_manifest.parent.mkdir(parents=True, exist_ok=True)
        clear_directory(preview_manifest.parent)
    command, playlist_path, url, preview_warning = build_command(config_dir, config, channel, preview_manifest, stream_item=stream_item)
    suffix = str(stream_item.get("id") or "") if isinstance(stream_item, dict) else ""
    path = log_path(config_dir, config, channel, suffix=suffix)
    log_handle = path.open("a", encoding="utf-8", buffering=1)
    channel_name = str(channel["name"])
    key_ref = stream_key_reference(channel_name)
    masked_url = mask_url(url, key_ref)
    log_redactions = stream_log_redactions(url, channel_name)

    print(f"[{channel_name}] starting -> {masked_url}")
    print(f"[{channel_name}] log: {path}")

    process = subprocess.Popen(
        command,
        cwd=str(config_dir),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        creationflags=windows_creation_flags(new_process_group=True),
    )
    running = RunningStream(
        channel=channel,
        process=process,
        log_handle=log_handle,
        command=command,
        preview_manifest=preview_manifest,
        preview_warning=preview_warning,
        started_monotonic=time.monotonic(),
        kind="stream",
        masked_output_url=masked_url,
        log_redactions=log_redactions,
        playlist_path=playlist_path,
    )
    log_session_header(
        running,
        channel_name=channel_name,
        log_path=path,
        command_text=command_as_text_with_masked_url(command, url, masked_url),
    )
    running.log_thread = threading.Thread(target=pump_process_output, args=(running,), daemon=True)
    running.monitor_thread = threading.Thread(target=monitor_stream_exit, args=(running,), daemon=True)
    running.log_thread.start()
    running.monitor_thread.start()
    print(f"[{channel_name}] pid: {process.pid}")
    return running


def start_preview_stream(
    config_dir: Path,
    config: dict[str, Any],
    channel: dict[str, Any],
    preview_manifest: Path,
) -> RunningStream:
    preview_manifest.parent.mkdir(parents=True, exist_ok=True)
    clear_directory(preview_manifest.parent)
    command, playlist_path, preview_warning = build_preview_command(config_dir, config, channel, preview_manifest)
    path = log_path(config_dir, config, channel, suffix="preview")
    log_handle = path.open("a", encoding="utf-8", buffering=1)

    print(f"[{channel['name']}] preview starting")
    print(f"[{channel['name']}] preview log: {path}")

    process = subprocess.Popen(
        command,
        cwd=str(config_dir),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        creationflags=windows_creation_flags(new_process_group=True),
    )
    running = RunningStream(
        channel=channel,
        process=process,
        log_handle=log_handle,
        command=command,
        preview_manifest=preview_manifest,
        preview_warning=preview_warning,
        started_monotonic=time.monotonic(),
        kind="preview",
        playlist_path=playlist_path,
    )
    log_session_header(running, channel_name=str(channel["name"]), log_path=path, command_text=subprocess.list2cmdline(command))
    running.log_thread = threading.Thread(target=pump_process_output, args=(running,), daemon=True)
    running.monitor_thread = threading.Thread(target=monitor_stream_exit, args=(running,), daemon=True)
    running.log_thread.start()
    running.monitor_thread.start()
    print(f"[{channel['name']}] preview pid: {process.pid}")
    return running


def stop_stream(stream: RunningStream) -> None:
    name = stream.channel.get("name", "<unnamed>")
    if stream.process.poll() is None:
        stream.stop_requested = True
        print(f"[{name}] stopping pid {stream.process.pid}")
        stop_parts = [f"STOP_REQUEST kind={stream.kind}", f"pid={stream.process.pid}"]
        source = str(getattr(stream, "stop_request_source", "") or "").strip()
        reason = str(getattr(stream, "stop_request_reason", "") or "").strip()
        if source:
            stop_parts.append(f"source={json.dumps(source)}")
        if reason:
            stop_parts.append(f"reason={json.dumps(reason)}")
        write_timestamped_log_line(stream.log_handle, " ".join(stop_parts))
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

    close_stream_log(stream)


def command_as_text(command: list[str], masked_url: str) -> str:
    safe = command[:-1] + [masked_url]
    return subprocess.list2cmdline(safe)


def command_as_text_with_masked_url(command: list[str], url: str, masked_url: str) -> str:
    safe = [masked_url if part == url else part for part in command]
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
                    close_stream_log(stream)
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
        final_url = url if reveal_keys else mask_url(url, stream_key_reference(channel.get("name")))
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
