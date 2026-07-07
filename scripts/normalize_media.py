#!/usr/bin/env python3
"""Normalize source media once so live streaming can use cheap `-c copy`.

This is the backend "make it clean" stage: every source file is transcoded into
one consistent H.264/AAC MP4 profile, then a ready-to-stream config is written.
"""

from __future__ import annotations

import argparse
from collections import deque
import json
import re
import subprocess
from pathlib import Path
from typing import Any

import runtime_paths
import stream_manager


DEFAULT_PROFILE: dict[str, Any] = {
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "video_encoder": "auto",
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

AUTO_VIDEO_ENCODER = "auto"
AUTO_HARDWARE_VIDEO_ENCODER = "auto_hardware"
HARDWARE_VIDEO_ENCODERS = {"h264_nvenc", "h264_amf", "h264_qsv"}
AUTO_HARDWARE_ENCODER_ORDER = ("h264_nvenc", "h264_qsv", "h264_amf")
LIBX264_PRESETS = {
    "ultrafast",
    "superfast",
    "veryfast",
    "faster",
    "fast",
    "medium",
    "slow",
    "slower",
    "veryslow",
}
ENCODER_PRESETS = {
    "auto": {"medium"},
    "auto_hardware": {"medium"},
    "libx264": LIBX264_PRESETS,
    "h264_nvenc": {"p1", "p2", "p3", "p4", "p5", "p6", "p7"},
    "h264_amf": {"balanced", "speed", "quality"},
    "h264_qsv": {"medium", "veryfast", "faster", "fast", "slow"},
}
ENCODER_DEFAULT_PRESETS = {
    "auto": "medium",
    "auto_hardware": "medium",
    "libx264": "medium",
    "h264_nvenc": "p5",
    "h264_amf": "balanced",
    "h264_qsv": "medium",
}
ENCODER_PROBE_CACHE: dict[tuple[str, str, str, str], tuple[bool, str]] = {}

HARDWARE_ENCODER_FALLBACK_PATTERNS = (
    "driver does not support",
    "minimum required nvidia driver",
    "cannot load",
    "no capable devices found",
    "no device available",
    "device creation failed",
    "encoder not found",
    "error while opening encoder",
    "function not implemented",
)


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


def channel_normalized_sources(config: dict[str, Any], config_dir: Path, channel: dict[str, Any]) -> list[Path]:
    playlist = channel.get("playlist")
    if isinstance(playlist, list) and playlist:
        return [resolve_path(config_dir, str(item)) for item in playlist]

    defaults = config.get("defaults", {})
    normalized_root = resolve_path(config_dir, defaults.get("normalized_dir", "Go Live"))
    channel_dir = normalized_root / str(channel["name"])
    if not channel_dir.exists():
        return []
    return sorted(
        path for path in channel_dir.iterdir()
        if path.is_file() and path.suffix.lower() in stream_manager.VIDEO_EXTENSIONS
    )


def profile(config: dict[str, Any], channel: dict[str, Any] | None = None) -> dict[str, Any]:
    merged = dict(DEFAULT_PROFILE)
    merged.update(config.get("normalize_profile", {}))
    if channel:
        merged.update(channel.get("normalize_profile", {}))
    return merged


def rendition_profile(config: dict[str, Any], channel: dict[str, Any], variant: dict[str, Any]) -> dict[str, Any]:
    selected = profile(config, channel)
    live_profile = stream_manager.live_profile(config, channel)
    selected["width"] = int(variant.get("width") or selected.get("width") or 1280)
    selected["height"] = int(variant.get("height") or selected.get("height") or 720)
    selected["video_bitrate"] = str(variant.get("video_bitrate") or selected.get("video_bitrate") or "3500k")
    selected["video_minrate"] = str(variant.get("minrate") or variant.get("video_bitrate") or selected["video_bitrate"])
    selected["video_maxrate"] = str(variant.get("maxrate") or variant.get("video_bitrate") or selected["video_bitrate"])
    selected["video_bufsize"] = str(variant.get("bufsize") or bitrate_times_two(selected["video_bitrate"]))
    selected["audio_bitrate"] = str(variant.get("audio_bitrate") or selected.get("audio_bitrate") or "128k")
    selected["video_encoder"] = str(live_profile.get("video_encoder") or selected.get("video_encoder") or "libx264")
    selected["x264_preset"] = str(live_profile.get("preset") or selected.get("x264_preset") or "veryfast")
    selected["x264_profile"] = str(live_profile.get("profile") or selected.get("x264_profile") or "high")
    return selected


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

    command = [
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
    ]
    command += video_encoder_options(video_encoder, selected_profile)
    command += [
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
    return command


def video_encoder_options(video_encoder: str, selected_profile: dict[str, Any]) -> list[str]:
    preset = str(selected_profile.get("x264_preset") or ENCODER_DEFAULT_PRESETS.get(video_encoder, "medium"))
    video_profile = str(selected_profile.get("x264_profile") or "high")
    if video_encoder == "h264_amf":
        return ["-quality", preset, "-profile:v", video_profile]
    return ["-preset", preset, "-profile:v", video_profile]


def normalized_encoder_name(value: Any) -> str:
    encoder = str(value or AUTO_VIDEO_ENCODER).strip().lower()
    known = {AUTO_VIDEO_ENCODER, AUTO_HARDWARE_VIDEO_ENCODER, "libx264", *HARDWARE_VIDEO_ENCODERS}
    return encoder if encoder in known else AUTO_VIDEO_ENCODER


def preset_for_encoder(selected_profile: dict[str, Any], encoder: str) -> str:
    preset = str(selected_profile.get("x264_preset") or "").strip()
    options = ENCODER_PRESETS.get(encoder) or LIBX264_PRESETS
    if preset in options:
        return preset
    return ENCODER_DEFAULT_PRESETS.get(encoder, "medium")


def profile_for_encoder(selected_profile: dict[str, Any], encoder: str) -> dict[str, Any]:
    prepared = dict(selected_profile)
    prepared["video_encoder"] = encoder
    prepared["x264_preset"] = preset_for_encoder(selected_profile, encoder)
    prepared["x264_profile"] = str(prepared.get("x264_profile") or "high").strip() or "high"
    return prepared


def encoder_candidates(requested_encoder: str) -> list[str]:
    if requested_encoder == AUTO_VIDEO_ENCODER:
        return [*AUTO_HARDWARE_ENCODER_ORDER, "libx264"]
    if requested_encoder == AUTO_HARDWARE_VIDEO_ENCODER:
        return list(AUTO_HARDWARE_ENCODER_ORDER)
    return [requested_encoder]


def encoder_probe_command(ffmpeg_path: str, selected_profile: dict[str, Any]) -> list[str]:
    encoder = str(selected_profile.get("video_encoder") or "libx264")
    return [
        ffmpeg_path,
        "-hide_banner",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=256x256:rate=1",
        "-frames:v",
        "1",
        "-c:v",
        encoder,
        *video_encoder_options(encoder, selected_profile),
        "-f",
        "null",
        "-",
    ]


def summarize_encoder_probe_failure(output: str) -> str:
    lines = [line.strip() for line in output.splitlines() if line.strip()]
    for line in reversed(lines):
        lower = line.lower()
        if "error" in lower or "failed" in lower or "not support" in lower or "no device" in lower:
            return line
    return lines[-1] if lines else "encoder probe failed"


def probe_video_encoder(ffmpeg_path: str, selected_profile: dict[str, Any]) -> tuple[bool, str]:
    encoder = str(selected_profile.get("video_encoder") or "libx264")
    preset = str(selected_profile.get("x264_preset") or "")
    video_profile = str(selected_profile.get("x264_profile") or "")
    cache_key = (str(ffmpeg_path), encoder, preset, video_profile)
    if cache_key in ENCODER_PROBE_CACHE:
        return ENCODER_PROBE_CACHE[cache_key]
    command = encoder_probe_command(ffmpeg_path, selected_profile)
    try:
        completed = subprocess.run(command, capture_output=True, text=True, check=False, timeout=20)
    except OSError as exc:
        result = (False, str(exc))
        ENCODER_PROBE_CACHE[cache_key] = result
        return result
    except subprocess.TimeoutExpired:
        result = (False, "encoder probe timed out")
        ENCODER_PROBE_CACHE[cache_key] = result
        return result

    output = "\n".join([completed.stdout or "", completed.stderr or ""])
    if completed.returncode == 0:
        result = (True, "")
    else:
        reason = hardware_encoder_fallback_reason(encoder, output.splitlines(), completed.returncode)
        result = (False, reason or summarize_encoder_probe_failure(output))
    ENCODER_PROBE_CACHE[cache_key] = result
    return result


def resolve_encoder_profile(ffmpeg_path: str, selected_profile: dict[str, Any]) -> dict[str, Any]:
    requested = normalized_encoder_name(selected_profile.get("video_encoder"))
    failures: list[str] = []
    for encoder in encoder_candidates(requested):
        candidate = profile_for_encoder(selected_profile, encoder)
        ok, reason = probe_video_encoder(ffmpeg_path, candidate)
        if ok:
            if requested in {AUTO_VIDEO_ENCODER, AUTO_HARDWARE_VIDEO_ENCODER}:
                label = "software CPU" if encoder == "libx264" else "hardware GPU"
                print(f"HEADS-UP auto encoder selected {encoder} ({label}).", flush=True)
            return candidate
        failures.append(f"{encoder}: {reason}")

    if requested in HARDWARE_VIDEO_ENCODERS and cpu_fallback_enabled(selected_profile):
        fallback = libx264_fallback_profile(selected_profile)
        ok, reason = probe_video_encoder(ffmpeg_path, fallback)
        if ok:
            print(
                f"HEADS-UP {requested} is unavailable; retrying with libx264 CPU encoder because CPU fallback is enabled.",
                flush=True,
            )
            return fallback
        failures.append(f"libx264: {reason}")

    failure_text = "; ".join(failures)
    if requested == AUTO_HARDWARE_VIDEO_ENCODER:
        raise SystemExit(f"No compatible GPU encoder is available on this PC. Probe results: {failure_text}")
    if requested == AUTO_VIDEO_ENCODER:
        raise SystemExit(f"No compatible H.264 encoder is available on this PC. Probe results: {failure_text}")
    if requested in HARDWARE_VIDEO_ENCODERS:
        raise SystemExit(
            f"Selected GPU encoder {requested} is not available on this PC. Probe result: {failure_text}. "
            "Use Auto, choose another GPU encoder, or update the GPU driver."
        )
    raise SystemExit(f"Selected encoder {requested} is not available. Probe result: {failure_text}")


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


def run_ffmpeg_with_progress(command: list[str], duration_seconds: float | None, file_index: int, total_files: int) -> tuple[int, list[str]]:
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    assert process.stdout is not None
    last_percent = -1
    output_tail: deque[str] = deque(maxlen=120)
    for raw_line in process.stdout:
        line = raw_line.strip()
        if not line:
            continue
        output_tail.append(line)
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
        elif not line.startswith(("frame=", "fps=", "stream_", "bitrate=", "total_size=", "out_time=", "out_time_ms=", "out_time_us=", "dup_frames=", "drop_frames=", "speed=", "progress=")):
            print(line, flush=True)
    return process.wait(), list(output_tail)


def signed_return_code(returncode: int) -> int:
    if returncode > 0x7FFFFFFF:
        return returncode - 0x100000000
    return returncode


def hardware_encoder_fallback_reason(encoder: str, output_lines: list[str], returncode: int) -> str | None:
    if encoder not in HARDWARE_VIDEO_ENCODERS:
        return None
    output_text = "\n".join(output_lines).lower()
    if not any(pattern in output_text for pattern in HARDWARE_ENCODER_FALLBACK_PATTERNS):
        return None
    if "minimum required nvidia driver" in output_text:
        return "NVIDIA driver is too old for the bundled FFmpeg NVENC encoder"
    if "driver does not support" in output_text:
        return "GPU driver does not support this encoder version"
    if "no capable devices found" in output_text or "no device available" in output_text:
        return "no compatible hardware encoder device was available"
    normalized_code = signed_return_code(returncode)
    if normalized_code == -40:
        return "hardware encoder is not implemented by the current driver/device"
    return "hardware encoder could not be opened"


def libx264_fallback_profile(selected_profile: dict[str, Any]) -> dict[str, Any]:
    fallback = dict(selected_profile)
    fallback["video_encoder"] = "libx264"
    preset = str(fallback.get("x264_preset") or "medium").strip()
    if preset not in LIBX264_PRESETS:
        fallback["x264_preset"] = "medium"
    fallback["x264_profile"] = str(fallback.get("x264_profile") or "high").strip() or "high"
    return fallback


def cpu_fallback_enabled(selected_profile: dict[str, Any]) -> bool:
    return selected_profile.get("allow_cpu_fallback") is True


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


def next_versioned_output(path: Path) -> Path:
    if not path.exists():
        return path
    counter = 2
    while True:
        candidate = path.with_name(f"{path.stem}-v{counter}{path.suffix}")
        if not candidate.exists():
            return candidate
        counter += 1


def existing_versioned_output(path: Path) -> Path | None:
    candidates: list[tuple[int, Path]] = []
    if path.exists():
        candidates.append((1, path))

    pattern = f"{path.stem}-v*{path.suffix}"
    for candidate in path.parent.glob(pattern):
        match = re.search(r"-v(\d+)$", candidate.stem)
        if match:
            candidates.append((int(match.group(1)), candidate))
    if not candidates:
        return None
    return max(candidates, key=lambda item: item[0])[1]


def encoding_output_path(path: Path) -> Path:
    return path.with_name(f"{path.stem}.encoding{path.suffix}")


def remove_stale_encoding_outputs(channel_dir: Path) -> None:
    for path in channel_dir.glob("*.encoding.*"):
        if path.is_file():
            path.unlink(missing_ok=True)


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
    start_index: int = 1,
) -> tuple[dict[str, Any], list[Path]]:
    defaults = config.get("defaults", {})
    ffmpeg_path = str(defaults.get("ffmpeg_path", "ffmpeg"))
    ffprobe_path = str(defaults.get("ffprobe_path", "ffprobe"))
    normalized_root = resolve_path(config_dir, defaults.get("normalized_dir", "Go Live"))
    channel_dir = normalized_root / str(channel["name"])
    channel_dir.mkdir(parents=True, exist_ok=True)
    remove_stale_encoding_outputs(channel_dir)
    selected_profile = resolve_encoder_profile(ffmpeg_path, profile(config, channel))

    normalized_files: list[Path] = []
    sources = channel_sources(config_dir, channel)
    if not sources:
        raise SystemExit(f"Channel '{channel.get('name')}' has no source media.")

    print(f"\n[{channel['name']}] normalizing {len(sources)} file(s)", flush=True)
    print(f"TASK channel={channel['name']} total={len(sources)}", flush=True)
    for index, source in enumerate(sources, start=1):
        if not source.exists():
            raise SystemExit(f"Source file does not exist: {source}")

        default_output = channel_dir / f"{index:04d}-{source.stem}.mp4"
        if index < start_index:
            existing_output = existing_versioned_output(default_output)
            if not existing_output:
                raise SystemExit(f"Cannot resume before missing normalized video: {default_output.name}")
            normalized_files.append(existing_output)
            print(f"FILE {index}/{len(sources)} skip {source.name} -> {existing_output.name}", flush=True)
            print(f"PROGRESS file={index} total={len(sources)} percent=100", flush=True)
            continue

        output = default_output
        if default_output.exists() and not force:
            output = next_versioned_output(default_output)
            print(
                f"HEADS-UP existing normalized video: {default_output.name}; creating {output.name}",
                flush=True,
            )
        temp_output = encoding_output_path(output)
        temp_output.unlink(missing_ok=True)
        normalized_files.append(output)

        command = build_ffmpeg_command(ffmpeg_path, source, temp_output, selected_profile)
        action = "replace" if default_output.exists() and force and output == default_output else "encode"
        print(f"FILE {index}/{len(sources)} {action} {source.name} -> {output.name}", flush=True)
        if dry_run:
            print("  " + subprocess.list2cmdline(command), flush=True)
            print(f"PROGRESS file={index} total={len(sources)} percent=100", flush=True)
            continue

        duration_seconds = probe_duration(ffprobe_path, source)
        returncode, ffmpeg_lines = run_ffmpeg_with_progress(command, duration_seconds, index, len(sources))
        fallback_reason = hardware_encoder_fallback_reason(
            str(selected_profile.get("video_encoder") or ""),
            ffmpeg_lines,
            returncode,
        )
        if returncode != 0 and fallback_reason and cpu_fallback_enabled(selected_profile):
            temp_output.unlink(missing_ok=True)
            fallback_profile = libx264_fallback_profile(selected_profile)
            fallback_command = build_ffmpeg_command(ffmpeg_path, source, temp_output, fallback_profile)
            print(
                f"HEADS-UP {selected_profile.get('video_encoder')} failed: {fallback_reason}; retrying with libx264 CPU encoder.",
                flush=True,
            )
            returncode, _ffmpeg_lines = run_ffmpeg_with_progress(
                fallback_command,
                duration_seconds,
                index,
                len(sources),
            )
        if returncode != 0:
            temp_output.unlink(missing_ok=True)
            if fallback_reason:
                print(
                    f"GPU encoder failed: {fallback_reason}. Update the GPU driver or use a compatible FFmpeg build.",
                    flush=True,
                )
            raise SystemExit(f"FFmpeg failed for {source} with exit code {signed_return_code(returncode)}")
        temp_output.replace(output)

    ready_channel = dict(channel)
    ready_channel["playlist"] = [
        relative_or_absolute(config_dir, path) for path in normalized_files
    ]
    return ready_channel, normalized_files


def adaptive_lower_variants(config: dict[str, Any], channel: dict[str, Any]) -> list[dict[str, Any]]:
    live_profile = stream_manager.live_profile(config, channel)
    adaptive = stream_manager.adaptive_profile(live_profile)
    variants = list(adaptive.get("variants") or [])
    source_profile = profile(config, channel)
    try:
        source_height = int(source_profile.get("height") or DEFAULT_PROFILE["height"])
    except (TypeError, ValueError):
        source_height = int(DEFAULT_PROFILE["height"])
    return [variant for variant in variants if int(variant.get("height") or 0) < source_height]


def normalize_channel_renditions(
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
    remove_stale_encoding_outputs(channel_dir)

    sources = channel_normalized_sources(config, config_dir, channel)
    if not sources:
        raise SystemExit(
            f"Channel '{channel.get('name')}' has no existing Go Live videos. Run Encode Videos first or add videos to the Videos card."
        )
    variants = adaptive_lower_variants(config, channel)
    if not variants:
        raise SystemExit(f"Channel '{channel.get('name')}' has no enabled lower-resolution ladder rungs.")

    jobs: list[tuple[Path, dict[str, Any]]] = [(source, variant) for variant in variants for source in sources]
    total = len(jobs)
    print(f"\n[{channel['name']}] encoding {total} lower-resolution rendition(s)", flush=True)
    print(f"TASK channel={channel['name']} total={total}", flush=True)

    outputs: list[Path] = []
    for job_index, (source, variant) in enumerate(jobs, start=1):
        if not source.exists():
            raise SystemExit(f"Source file does not exist: {source}")

        variant_id = str(variant.get("id") or f"{variant.get('height', 'lower')}p").strip() or "lower"
        variant_dir = channel_dir / variant_id
        variant_dir.mkdir(parents=True, exist_ok=True)
        default_output = variant_dir / source.name
        output = default_output if force else next_versioned_output(default_output)
        if output != default_output:
            print(
                f"HEADS-UP existing rendition: {default_output.name}; creating {output.name}",
                flush=True,
            )
        temp_output = encoding_output_path(output)
        temp_output.unlink(missing_ok=True)
        outputs.append(output)

        selected_profile = resolve_encoder_profile(ffmpeg_path, rendition_profile(config, channel, variant))
        command = build_ffmpeg_command(ffmpeg_path, source, temp_output, selected_profile)
        label = str(variant.get("label") or variant_id)
        print(f"FILE {job_index}/{total} render {label} {source.name} -> {variant_id}/{output.name}", flush=True)
        if dry_run:
            print("  " + subprocess.list2cmdline(command), flush=True)
            print(f"PROGRESS file={job_index} total={total} percent=100", flush=True)
            continue

        duration_seconds = probe_duration(ffprobe_path, source)
        returncode, ffmpeg_lines = run_ffmpeg_with_progress(command, duration_seconds, job_index, total)
        fallback_reason = hardware_encoder_fallback_reason(
            str(selected_profile.get("video_encoder") or ""),
            ffmpeg_lines,
            returncode,
        )
        if returncode != 0 and fallback_reason and cpu_fallback_enabled(selected_profile):
            temp_output.unlink(missing_ok=True)
            fallback_profile = libx264_fallback_profile(selected_profile)
            fallback_command = build_ffmpeg_command(ffmpeg_path, source, temp_output, fallback_profile)
            print(
                f"HEADS-UP {selected_profile.get('video_encoder')} failed: {fallback_reason}; retrying with libx264 CPU encoder.",
                flush=True,
            )
            returncode, _ffmpeg_lines = run_ffmpeg_with_progress(
                fallback_command,
                duration_seconds,
                job_index,
                total,
            )
        if returncode != 0:
            temp_output.unlink(missing_ok=True)
            if fallback_reason:
                print(
                    f"GPU encoder failed: {fallback_reason}. Update the GPU driver or use a compatible FFmpeg build.",
                    flush=True,
                )
            raise SystemExit(f"FFmpeg failed for {source} with exit code {signed_return_code(returncode)}")
        temp_output.replace(output)

    ready_channel = dict(channel)
    ready_channel["rendition_playlist"] = [
        relative_or_absolute(config_dir, path) for path in outputs
    ]
    return ready_channel, outputs


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
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite matching output names instead of creating versioned copies.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print FFmpeg commands without encoding.")
    parser.add_argument(
        "--adaptive-renditions-only",
        action="store_true",
        help="Skip source normalization and encode only lower-resolution adaptive renditions from existing Go Live videos.",
    )
    parser.add_argument(
        "--include-disabled",
        action="store_true",
        help="Normalize disabled channels too.",
    )
    parser.add_argument(
        "--start-index",
        type=int,
        default=1,
        help="Resume by reusing normalized outputs before this 1-based source index.",
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
    start_index = max(1, int(args.start_index or 1))
    for channel in channels:
        if args.adaptive_renditions_only:
            ready_channel, _files = normalize_channel_renditions(config, config_dir, channel, args.force, args.dry_run)
        else:
            ready_channel, _files = normalize_channel(config, config_dir, channel, args.force, args.dry_run, start_index)
        ready_channels.append(ready_channel)

    if not args.dry_run and not args.adaptive_renditions_only:
        write_concat_playlists(config, config_dir, ready_channels)
        write_ready_config(config, config_dir, ready_channels, Path(args.output_config).resolve())

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
