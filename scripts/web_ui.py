#!/usr/bin/env python3
"""Small local web UI for the FFmpeg multi-stream tools."""

from __future__ import annotations

import json
import hashlib
import os
import random
import re
import secrets
import shutil
import signal
import sqlite3
import subprocess
import sys
import threading
import time
import traceback
import unicodedata
from collections import deque
from datetime import datetime, timedelta
from difflib import SequenceMatcher
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote, unquote, urlparse

import app_db
import cloud_probe
import cloud_source_proxy
import google_drive_provider
import runtime_paths
import storage_providers
import stream_manager
import sync_service
import youtube_service


ROOT = runtime_paths.DATA_ROOT
CODE_ROOT = runtime_paths.CODE_ROOT
WEB_ROOT = runtime_paths.WEB_ROOT
DEFAULT_CONFIG = runtime_paths.default_config_name()
VIDEO_EXTENSIONS = {".mp4", ".m4v", ".mov", ".flv", ".mkv"}
THUMBNAIL_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".bmp"}
THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024
TRANSFER_MANIFEST_NAME = "castarro-transfer-manifest.json"
TRANSFER_PACKAGE_VERSION = 1
STREAM_CYCLE_RUNTIME_FILE = ROOT / "stream-cycle-runtime.json"
INTERNAL_JSON_FILES = {
    "backend-info.json",
    "castarro-transfer-manifest.json",
    "config.example.json",
    "package-lock.json",
    "package.json",
    "stream-cycle-runtime.json",
}
YOUTUBE_CHANNEL_NAME_MATCH_THRESHOLD = 0.80
UI_PORT = int(os.environ.get("STREAM_UI_PORT", "8765"))
MEDIA_DURATION_CACHE: dict[tuple[str, int, int, str], float | None] = {}
SCHEDULER_DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
ALERT_SEVERITY_RANK = {"info": 0, "warn": 1, "danger": 2}
YOUTUBE_HEALTH_CACHE_SECONDS = max(5 * 60.0, float(os.environ.get("YOUTUBE_HEALTH_CACHE_SECONDS", "1800")))
YOUTUBE_HEALTH_ERROR_CACHE_SECONDS = max(5 * 60.0, float(os.environ.get("YOUTUBE_HEALTH_ERROR_CACHE_SECONDS", "1800")))
YOUTUBE_PROFILE_CACHE_SECONDS = max(5 * 60.0, float(os.environ.get("YOUTUBE_PROFILE_CACHE_SECONDS", "21600")))
YOUTUBE_BROADCAST_CACHE_SECONDS = max(5 * 60.0, float(os.environ.get("YOUTUBE_BROADCAST_CACHE_SECONDS", "1800")))
YOUTUBE_STREAM_CACHE_SECONDS = max(5 * 60.0, float(os.environ.get("YOUTUBE_STREAM_CACHE_SECONDS", "1800")))
YOUTUBE_LIVE_CHAT_CONTEXT_CACHE_SECONDS = 10 * 60.0
YOUTUBE_LIVE_CHAT_QUOTA_COOLDOWN_SECONDS = 60 * 60.0
YOUTUBE_LIVE_CHAT_MIN_POLL_INTERVAL_MILLIS = max(
    5_000,
    int(float(os.environ.get("YOUTUBE_LIVE_CHAT_MIN_POLL_SECONDS", "120")) * 1000),
)
FFMPEG_SIZE_PATTERN = re.compile(r"size=\s*([0-9]+(?:\.[0-9]+)?)\s*([KMGT]?i?B|[kmgt]?B)", re.IGNORECASE)
FFMPEG_BITRATE_PATTERN = re.compile(r"bitrate=\s*([0-9]+(?:\.[0-9]+)?)\s*([kmg]?bits/s)", re.IGNORECASE)
FFMPEG_STATS_FRAME_PATTERN = re.compile(r"frame=\s*([0-9]+)")
FFMPEG_STATS_FPS_PATTERN = re.compile(r"fps=\s*([0-9]+(?:\.[0-9]+)?)")
FFMPEG_STATS_SPEED_PATTERN = re.compile(r"speed=\s*([0-9]+(?:\.[0-9]+)?)x", re.IGNORECASE)
FFMPEG_STATS_TIME_PATTERN = re.compile(r"time=\s*([0-9:.]+)")
FFMPEG_STATS_DUP_PATTERN = re.compile(r"dup=\s*([0-9]+)")
FFMPEG_STATS_DROP_PATTERN = re.compile(r"drop=\s*([0-9]+)")
TIMESTAMPED_LOG_PREFIX_PATTERN = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\s+\|\s+"
)


def windows_creation_flags(*, new_process_group: bool = False) -> int:
    if os.name != "nt":
        return 0
    flags = subprocess.CREATE_NO_WINDOW
    if new_process_group:
        flags |= subprocess.CREATE_NEW_PROCESS_GROUP
    return flags


def app_version() -> str | None:
    package_json = CODE_ROOT / "package.json"
    if not package_json.exists():
        return None
    try:
        payload = json.loads(package_json.read_text(encoding="utf-8"))
    except Exception:
        return None
    version = str(payload.get("version") or "").strip()
    return version or None


def mask_secret(value: Any) -> str:
    text = str(value or "")
    if not text:
        return ""
    if len(text) <= 3:
        return "***"
    return f"********{text[-3:]}"


def parse_ffmpeg_size_bytes(text: str) -> int:
    multipliers = {
        "b": 1,
        "kb": 1024,
        "kib": 1024,
        "mb": 1024 ** 2,
        "mib": 1024 ** 2,
        "gb": 1024 ** 3,
        "gib": 1024 ** 3,
        "tb": 1024 ** 4,
        "tib": 1024 ** 4,
    }
    latest = 0
    for match in FFMPEG_SIZE_PATTERN.finditer(text or ""):
        value = float(match.group(1))
        unit = match.group(2).lower()
        latest = int(value * multipliers.get(unit, 1))
    return max(0, latest)


def parse_ffmpeg_bitrate_bps(text: str) -> int | None:
    match = FFMPEG_BITRATE_PATTERN.search(text or "")
    if not match:
        return None
    value = float(match.group(1))
    unit = match.group(2).lower()
    multipliers = {
        "bits/s": 1,
        "kbits/s": 1000,
        "mbits/s": 1000 ** 2,
        "gbits/s": 1000 ** 3,
    }
    return int(value * multipliers.get(unit, 1))


def parse_configured_bitrate_bps(value: Any) -> int | None:
    if isinstance(value, (int, float)) and value > 0:
        return int(value)
    raw = str(value or "").strip().lower()
    if not raw:
        return None
    match = re.match(r"^([0-9]+(?:\.[0-9]+)?)\s*([kmgt]?)(?:b(?:it)?s?(?:/s)?)?$", raw)
    if not match:
        return None
    amount = float(match.group(1))
    suffix = match.group(2)
    multipliers = {
        "": 1,
        "k": 1000,
        "m": 1000 ** 2,
        "g": 1000 ** 3,
        "t": 1000 ** 4,
    }
    return int(amount * multipliers.get(suffix, 1))


def live_profile_target_bitrate_bps(profile: dict[str, Any]) -> int | None:
    if str(profile.get("mode") or "").lower() == "adaptive":
        try:
            active = stream_manager.active_adaptive_variant(profile)
        except Exception:
            active = {}
        video_bitrate = parse_configured_bitrate_bps(active.get("video_bitrate"))
        audio_bitrate = parse_configured_bitrate_bps(active.get("audio_bitrate") or profile.get("audio_bitrate"))
        if video_bitrate is None and audio_bitrate is None:
            return None
        return int(video_bitrate or 0) + int(audio_bitrate or 0)
    video_bitrate = parse_configured_bitrate_bps(profile.get("video_bitrate"))
    audio_bitrate = parse_configured_bitrate_bps(profile.get("audio_bitrate"))
    if video_bitrate is None and audio_bitrate is None:
        return None
    return int(video_bitrate or 0) + int(audio_bitrate or 0)


def parse_ffmpeg_clock_seconds(text: str) -> float | None:
    raw = str(text or "").strip()
    if not raw:
        return None
    parts = raw.split(":")
    if len(parts) != 3:
        return None
    try:
        hours = int(parts[0])
        minutes = int(parts[1])
        seconds = float(parts[2])
    except ValueError:
        return None
    return max(0.0, hours * 3600 + minutes * 60 + seconds)


def parse_ffmpeg_progress_value(raw: str) -> float | int | None:
    text = str(raw or "").strip()
    if not text or text.upper() == "N/A":
        return None
    if text.endswith("x"):
        text = text[:-1]
    try:
        number = float(text)
    except ValueError:
        return None
    if number.is_integer():
        return int(number)
    return number


def strip_timestamped_log_prefix(line: str) -> str:
    text = str(line or "").strip()
    if not text:
        return ""
    return TIMESTAMPED_LOG_PREFIX_PATTERN.sub("", text, count=1)


def latest_ffmpeg_progress(text: str) -> dict[str, str]:
    snapshot: dict[str, str] = {}
    current: dict[str, str] = {}
    normalized = (text or "").replace("\r", "\n")
    for raw_line in normalized.splitlines():
        line = strip_timestamped_log_prefix(raw_line)
        if not line or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key:
            continue
        if re.search(r"\s+[A-Za-z0-9_]+=", value):
            continue
        current[key] = value.strip()
        if key == "progress":
            if len(current) > 1:
                snapshot = current.copy()
            current = {}
    if current and len(current) > 1:
        snapshot = current.copy()
    return snapshot


def latest_ffmpeg_stats_line(text: str) -> str:
    normalized = (text or "").replace("\r", "\n")
    for raw_line in reversed(normalized.splitlines()):
        line = strip_timestamped_log_prefix(raw_line)
        if "frame=" in line and ("fps=" in line or "speed=" in line):
            return line
    return ""


def stream_delivery_health(
    *,
    running: bool,
    output_fps: float | None,
    target_fps: float | None,
    speed: float | None,
    average_bitrate_bps: int | None,
    target_bitrate_bps: int | None,
    drop_frames: int | None,
) -> tuple[str, str, str]:
    if not running:
        return "idle", "Offline", "Offline."
    if output_fps is None and speed is None and average_bitrate_bps is None:
        return "pending", "Collecting", "Waiting for FFmpeg delivery metrics. No frame rate, speed, or bitrate data has been read from the stream log yet."

    fps_ratio = None
    if output_fps is not None and target_fps and target_fps > 0:
        fps_ratio = output_fps / target_fps

    bitrate_ratio = None
    if average_bitrate_bps is not None and target_bitrate_bps and target_bitrate_bps > 0:
        bitrate_ratio = average_bitrate_bps / target_bitrate_bps

    dropped = int(drop_frames or 0)
    detail_parts: list[str] = []
    if speed is not None:
        detail_parts.append(f"Encoder speed is {speed:.2f}x.")
    if output_fps is not None and target_fps and target_fps > 0:
        detail_parts.append(f"Output frame rate is {output_fps:.2f} fps against the {target_fps:.2f} fps target.")
    elif output_fps is not None:
        detail_parts.append(f"Output frame rate is {output_fps:.2f} fps.")
    if average_bitrate_bps is not None and target_bitrate_bps and target_bitrate_bps > 0:
        detail_parts.append(
            f"Average bitrate is {average_bitrate_bps / 1_000_000:.2f} Mbps against the {target_bitrate_bps / 1_000_000:.2f} Mbps target."
        )
    elif average_bitrate_bps is not None:
        detail_parts.append(f"Average bitrate is {average_bitrate_bps / 1_000_000:.2f} Mbps.")
    if dropped > 0:
        detail_parts.append(f"FFmpeg has reported {dropped} dropped frame{'s' if dropped != 1 else ''}.")
    detail = " ".join(detail_parts).strip()

    if (
        (speed is not None and speed < 0.9)
        or (fps_ratio is not None and fps_ratio < 0.9)
        or (bitrate_ratio is not None and bitrate_ratio < 0.85)
    ):
        return "danger", "Poor", detail or "FFmpeg delivery is seriously below the configured stream target."
    if (
        dropped > 0
        or (speed is not None and speed < 0.98)
        or (fps_ratio is not None and fps_ratio < 0.97)
        or (bitrate_ratio is not None and bitrate_ratio < 0.95)
    ):
        return "warn", "Needs attention", detail or "FFmpeg delivery is slightly below the configured stream target."
    return "success", "Excellent", detail or "FFmpeg delivery is meeting the configured stream target."


def parse_stream_stats(
    log_text: str,
    *,
    running: bool,
    target_fps: float | None = None,
    target_bitrate_bps: int | None = None,
) -> dict[str, Any]:
    progress = latest_ffmpeg_progress(log_text)
    frame = None
    encoder_fps = None
    speed = None
    total_size_bytes = 0
    output_time_seconds = None
    drop_frames = None
    dup_frames = None
    average_bitrate_bps = None

    if progress:
        frame_value = parse_ffmpeg_progress_value(progress.get("frame"))
        frame = int(frame_value) if isinstance(frame_value, (int, float)) else None
        fps_value = parse_ffmpeg_progress_value(progress.get("fps"))
        encoder_fps = float(fps_value) if isinstance(fps_value, (int, float)) else None
        speed_value = parse_ffmpeg_progress_value(progress.get("speed"))
        speed = float(speed_value) if isinstance(speed_value, (int, float)) else None
        size_value = parse_ffmpeg_progress_value(progress.get("total_size"))
        total_size_bytes = max(0, int(size_value or 0))
        out_time_us = parse_ffmpeg_progress_value(progress.get("out_time_us"))
        out_time_ms = parse_ffmpeg_progress_value(progress.get("out_time_ms"))
        if isinstance(out_time_us, (int, float)) and out_time_us > 0:
            output_time_seconds = float(out_time_us) / 1_000_000
        elif isinstance(out_time_ms, (int, float)) and out_time_ms > 0:
            output_time_seconds = float(out_time_ms) / 1000
        else:
            output_time_seconds = parse_ffmpeg_clock_seconds(progress.get("out_time"))
        drop_value = parse_ffmpeg_progress_value(progress.get("drop_frames"))
        dup_value = parse_ffmpeg_progress_value(progress.get("dup_frames"))
        drop_frames = int(drop_value) if isinstance(drop_value, (int, float)) else None
        dup_frames = int(dup_value) if isinstance(dup_value, (int, float)) else None
    else:
        stats_line = latest_ffmpeg_stats_line(log_text)
        if stats_line:
            frame_match = FFMPEG_STATS_FRAME_PATTERN.search(stats_line)
            fps_match = FFMPEG_STATS_FPS_PATTERN.search(stats_line)
            speed_match = FFMPEG_STATS_SPEED_PATTERN.search(stats_line)
            time_match = FFMPEG_STATS_TIME_PATTERN.search(stats_line)
            drop_match = FFMPEG_STATS_DROP_PATTERN.search(stats_line)
            dup_match = FFMPEG_STATS_DUP_PATTERN.search(stats_line)
            frame = int(frame_match.group(1)) if frame_match else None
            encoder_fps = float(fps_match.group(1)) if fps_match else None
            speed = float(speed_match.group(1)) if speed_match else None
            output_time_seconds = parse_ffmpeg_clock_seconds(time_match.group(1)) if time_match else None
            drop_frames = int(drop_match.group(1)) if drop_match else None
            dup_frames = int(dup_match.group(1)) if dup_match else None
            total_size_bytes = parse_ffmpeg_size_bytes(stats_line)
            average_bitrate_bps = parse_ffmpeg_bitrate_bps(stats_line)

    output_fps = None
    if frame is not None and output_time_seconds and output_time_seconds > 0:
        output_fps = frame / output_time_seconds

    if average_bitrate_bps is None and total_size_bytes > 0 and output_time_seconds and output_time_seconds > 0:
        average_bitrate_bps = int((total_size_bytes * 8) / output_time_seconds)

    health_tone, health_label, detail = stream_delivery_health(
        running=running,
        output_fps=output_fps,
        target_fps=target_fps,
        speed=speed,
        average_bitrate_bps=average_bitrate_bps,
        target_bitrate_bps=target_bitrate_bps,
        drop_frames=drop_frames,
    )
    return {
        "available": bool(progress or latest_ffmpeg_stats_line(log_text)),
        "source": "ffmpeg-progress" if progress else "ffmpeg-stats-line" if latest_ffmpeg_stats_line(log_text) else "none",
        "frame": frame,
        "output_fps": round(output_fps, 2) if output_fps is not None else None,
        "encoder_fps": round(encoder_fps, 2) if encoder_fps is not None else None,
        "target_fps": round(float(target_fps), 2) if target_fps is not None else None,
        "speed": round(speed, 3) if speed is not None else None,
        "output_time_seconds": round(output_time_seconds, 2) if output_time_seconds is not None else None,
        "total_size_bytes": total_size_bytes,
        "average_bitrate_bps": average_bitrate_bps,
        "target_bitrate_bps": int(target_bitrate_bps) if target_bitrate_bps is not None else None,
        "drop_frames": drop_frames,
        "dup_frames": dup_frames,
        "health_tone": health_tone,
        "health_label": health_label,
        "detail": detail,
        "youtube_ingest_fps": None,
        "youtube_ingest_detail": "YouTube ingest frame rate is not exposed to this desktop app. These stats show what FFmpeg is currently sending.",
    }


def youtube_configuration_issue_summary(issues: Any) -> str:
    if not isinstance(issues, list) or not issues:
        return ""
    parts: list[str] = []
    for issue in issues[:3]:
        if not isinstance(issue, dict):
            continue
        reason = str(issue.get("reason") or issue.get("type") or "").strip()
        description = str(issue.get("description") or "").strip()
        severity = str(issue.get("severity") or "").strip()
        label = reason or description
        if not label:
            continue
        if severity:
            label = f"{label} ({severity})"
        if description and description != reason:
            label = f"{label}: {description}"
        parts.append(label)
    if not parts:
        return ""
    if isinstance(issues, list) and len(issues) > len(parts):
        parts.append(f"{len(issues) - len(parts)} more issue(s).")
    return " ".join(parts)


def youtube_health_view(stream_details: dict[str, Any] | None) -> dict[str, Any]:
    stream = stream_details if isinstance(stream_details, dict) else {}
    health_status = stream.get("health_status") if isinstance(stream.get("health_status"), dict) else {}
    stream_status = str(stream.get("stream_status") or "").strip()
    status = str(health_status.get("status") or "").strip()
    status_key = status.lower()
    issues = health_status.get("configurationIssues")
    if not isinstance(issues, list):
        issues = []
    issue_detail = youtube_configuration_issue_summary(issues)
    status_label = stream_status or "unknown"

    if status_key == "good":
        tone, label = "success", "Excellent"
        detail = f"YouTube reports excellent ingest health; stream status is {status_label}."
        decisive = True
    elif status_key == "ok":
        tone, label = "warn", "Needs attention"
        detail = issue_detail or f"YouTube reports non-critical ingest warnings; stream status is {status_label}."
        decisive = True
    elif status_key == "bad":
        tone, label = "danger", "Poor"
        detail = issue_detail or f"YouTube reports ingest errors; stream status is {status_label}."
        decisive = True
    elif status_key == "nodata":
        tone, label = "pending", "Collecting"
        detail = f"YouTube has not published health data yet; stream status is {status_label}."
        decisive = False
    elif stream_status.lower() == "error":
        tone, label = "danger", "Poor"
        detail = issue_detail or "YouTube reports the live stream is in an error state."
        decisive = True
    else:
        tone, label = "pending", "Collecting"
        detail = f"YouTube health is not available yet; stream status is {status_label}."
        decisive = False

    return {
        "available": bool(status or stream_status),
        "decisive": decisive,
        "source": "youtube",
        "health_status": status,
        "stream_status": stream_status,
        "health_tone": tone,
        "health_label": label,
        "detail": detail,
        "configuration_issues": issues,
        "last_update_time_seconds": health_status.get("lastUpdateTimeSeconds"),
    }


def apply_youtube_health_to_stream_stats(stats: dict[str, Any], youtube_health: dict[str, Any] | None) -> dict[str, Any]:
    if not youtube_health:
        stats["health_source"] = "ffmpeg"
        return stats

    merged = dict(stats)
    merged["health_source"] = "youtube" if youtube_health.get("decisive") else "ffmpeg"
    merged["local_health_tone"] = stats.get("health_tone")
    merged["local_health_label"] = stats.get("health_label")
    merged["local_detail"] = stats.get("detail")
    merged["youtube_health"] = youtube_health
    merged["youtube_health_status"] = youtube_health.get("health_status")
    merged["youtube_stream_status"] = youtube_health.get("stream_status")
    merged["youtube_configuration_issues"] = youtube_health.get("configuration_issues") or []
    merged["youtube_ingest_detail"] = str(youtube_health.get("detail") or "")
    if youtube_health.get("decisive"):
        merged["health_tone"] = youtube_health.get("health_tone")
        merged["health_label"] = youtube_health.get("health_label")
        merged["detail"] = youtube_health.get("detail")
    return merged


def task_progress(
    action: str,
    channel_name: str | None,
    lines: list[str],
    running: bool,
    returncode: int | None,
) -> dict[str, Any]:
    progress: dict[str, Any] = {
        "action": action,
        "channel": channel_name,
        "percent": 0,
        "file_percent": 0,
        "current": 0,
        "total": 0,
        "status": "running" if running else "success" if returncode == 0 else "failed",
        "message": "Starting...",
    }

    for line in lines:
        if line.startswith("HEADS-UP "):
            progress["message"] = line
            continue

        output_dir_match = re.search(r"^OUTPUT_DIR path=(.+)$", line)
        if output_dir_match:
            progress["output_dir"] = output_dir_match.group(1)
            progress["message"] = f"Saving to {output_dir_match.group(1)}"
            continue

        task_match = re.search(r"^TASK channel=(.+) total=(\d+)", line)
        if task_match:
            progress["channel"] = task_match.group(1)
            progress["total"] = int(task_match.group(2))
            progress["message"] = f"Preparing {progress['total']} file(s)"
            continue

        file_match = re.search(r"^FILE\s+(\d+)/(\d+)\s+(.+)$", line)
        if file_match:
            progress["current"] = int(file_match.group(1))
            progress["total"] = int(file_match.group(2))
            progress["message"] = file_match.group(3)
            file_percent = 0
            progress["file_percent"] = file_percent
            progress["percent"] = file_percent
            continue

        progress_match = re.search(r"^PROGRESS file=(\d+) total=(\d+) percent=(\d+)", line)
        if progress_match:
            current = int(progress_match.group(1))
            total = int(progress_match.group(2))
            file_percent = int(progress_match.group(3))
            progress["current"] = current
            progress["total"] = total
            progress["file_percent"] = file_percent
            progress["percent"] = file_percent
            continue

        output_match = re.search(r"^OUTPUT file=(\d+) total=(\d+) path=(.+)$", line)
        if output_match:
            current = int(output_match.group(1))
            total = int(output_match.group(2))
            output_path = output_match.group(3)
            progress["current"] = current
            progress["total"] = total
            progress["last_output"] = output_path
            progress["message"] = f"Saved {current} of {total}: {output_path}"
            continue

    if not running:
        progress["percent"] = 100 if returncode == 0 else progress["percent"]
        progress["file_percent"] = progress["percent"]
        if returncode == 0:
            if progress.get("last_output"):
                progress["message"] = f"Finished. Last saved: {progress['last_output']}"
            elif progress.get("output_dir"):
                progress["message"] = f"Finished. Saved to {progress['output_dir']}"
            else:
                progress["message"] = "Finished"
        elif lines:
            progress["message"] = lines[-1]

    return progress


class Task:
    def __init__(self, name: str, command: list[str], config_name: str, channel_name: str | None) -> None:
        self.id = f"{time.time_ns()}-{name}"
        self.name = name
        self.command = command
        self.config_name = config_name
        self.channel_name = channel_name
        self.started_at = time.time()
        self.finished_at: float | None = None
        self.returncode: int | None = None
        self.stopped_by_user = False
        self.lines: deque[str] = deque(maxlen=300)
        app_db.record_task_start(
            self.id,
            name,
            config_name,
            channel_name,
            subprocess.list2cmdline(command),
        )
        self.process = subprocess.Popen(
            command,
            cwd=str(ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            creationflags=windows_creation_flags(new_process_group=True),
        )
        self.thread = threading.Thread(target=self._read_output, daemon=True)
        self.thread.start()

    def _read_output(self) -> None:
        assert self.process.stdout is not None
        for line in self.process.stdout:
            self.lines.append(line.rstrip())
        self.returncode = self.process.wait()
        self.finished_at = time.time()
        app_db.record_task_finish(self.id, self.returncode, "\n".join(list(self.lines)[-80:]))
        if self.name in {"normalize", "renditions"}:
            config, _error = load_config_or_none(self.config_name)
            if config:
                removed = cleanup_encoding_outputs(config, self.channel_name)
                if removed:
                    self.lines.append(f"Discarded {removed} incomplete encoding file(s).")
                    app_db.record_event(
                        "normalize_incomplete_outputs_discarded",
                        self.config_name,
                        self.channel_name,
                        {"removed": removed},
                    )
            if config and self.returncode == 0:
                app_db.sync_config(self.config_name, config)

    def stop(self) -> None:
        if self.process.poll() is not None:
            return
        self.stopped_by_user = True
        self.lines.append("Stop requested.")
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/PID", str(self.process.pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        else:
            self.process.terminate()

    def as_dict(self) -> dict[str, Any]:
        lines = list(self.lines)
        running = self.process.poll() is None
        returncode = self.returncode if self.returncode is not None else self.process.returncode
        return {
            "id": self.id,
            "name": self.name,
            "channel": self.channel_name,
            "command": subprocess.list2cmdline(self.command),
            "running": running,
            "returncode": returncode,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "stopped_by_user": self.stopped_by_user,
            "lines": lines,
            "progress": task_progress(self.name, self.channel_name, lines, running, returncode),
        }


def current_adaptive_variant_id(channel: dict[str, Any]) -> str:
    profile = channel.get("live_profile") if isinstance(channel.get("live_profile"), dict) else {}
    if str(profile.get("mode") or "").lower() != "adaptive":
        return ""
    adaptive = stream_manager.adaptive_profile(profile)
    return str(adaptive.get("active_variant_id") or "")


class StreamState:
    def __init__(
        self,
        config_name: str,
        running: stream_manager.RunningStream,
        *,
        cloud_asset_ids: list[str] | None = None,
    ) -> None:
        self.config_name = config_name
        self.running = running
        self.started_at = time.time()
        self.log_path = Path(running.log_handle.name)
        self.cloud_asset_ids = list(cloud_asset_ids or [])
        self.recovering = False
        self.reconnect_attempts = 0
        self.next_reconnect_at = 0.0
        self.last_reconnect_error = ""
        self.last_reconnect_status = ""
        self.adaptive_variant_id = current_adaptive_variant_id(running.channel)
        self.last_adaptive_switch_at = 0.0
        self.playwright_dismissed = False

    def replace_running(self, running: stream_manager.RunningStream, cloud_asset_ids: list[str] | None = None) -> None:
        self.running = running
        self.log_path = Path(running.log_handle.name)
        self.cloud_asset_ids = list(cloud_asset_ids or [])
        self.recovering = False
        self.next_reconnect_at = 0.0
        self.last_reconnect_error = ""
        self.last_reconnect_status = "reconnected"
        self.adaptive_variant_id = current_adaptive_variant_id(running.channel)
        self.playwright_dismissed = False

    def transferred_bytes(self) -> int:
        return parse_ffmpeg_size_bytes(tail_file(self.log_path, max_chars=20000))

    def as_dict(self) -> dict[str, Any]:
        process = self.running.process
        channel_name = str(self.running.channel.get("name") or "")
        log_tail = tail_file(self.log_path)
        transferred_bytes = parse_ffmpeg_size_bytes(log_tail)
        process_running = process.poll() is None
        stream_stats = parse_stream_stats(log_tail, running=process_running)
        return {
            "name": channel_name,
            "pid": process.pid,
            "running": process_running or self.recovering,
            "process_running": process_running,
            "recovering": self.recovering,
            "reconnect_attempts": self.reconnect_attempts,
            "next_reconnect_at": self.next_reconnect_at,
            "last_reconnect_error": self.last_reconnect_error,
            "last_reconnect_status": self.last_reconnect_status,
            "returncode": process.returncode,
            "started_at": self.started_at,
            "log_path": str(self.log_path),
            "log_tail": log_tail,
            "transferred_bytes": transferred_bytes,
            "stream_stats": stream_stats,
            "preview_url": None,
            "preview_ready": False,
            "preview_warning": None,
            "adaptive_variant_id": self.adaptive_variant_id,
        }


class PreviewState:
    def __init__(self, config_name: str, channel_name: str, running: stream_manager.RunningStream) -> None:
        self.config_name = config_name
        self.channel_name = channel_name
        self.running = running
        self.started_at = time.time()

    def as_dict(self) -> dict[str, Any]:
        manifest = self.running.preview_manifest
        process = self.running.process
        return {
            "channel": self.channel_name,
            "pid": process.pid,
            "running": process.poll() is None,
            "started_at": self.started_at,
            "preview_url": f"/preview/{quote(self.channel_name, safe='')}/index.m3u8" if manifest else None,
            "preview_ready": bool(manifest and manifest.exists()),
            "preview_warning": self.running.preview_warning,
        }


class AppState:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.streams: dict[str, StreamState] = {}
        self.preview: PreviewState | None = None
        self.tasks: deque[Task] = deque(maxlen=20)
        self.youtube_oauth_states: dict[str, dict[str, Any]] = {}
        self.storage_oauth_states: dict[str, dict[str, Any]] = {}
        self.sync_pairings: dict[str, dict[str, Any]] = {}
        self.sync_tokens: dict[str, dict[str, Any]] = {}
        self.cloud_proxy: cloud_source_proxy.CloudSourceProxy | None = None
        self.cloud_proxy_settings: dict[str, Any] = {}
        self.stop_event = threading.Event()
        self.scheduler_channels: dict[tuple[str, str], dict[str, Any]] = {}
        self.stream_cycle_channels: dict[tuple[str, str], dict[str, Any]] = {}
        self.alert_cooldowns: dict[tuple[str | None, str | None, str], float] = {}
        self.stream_exit_recorded: set[tuple[str, str]] = set()
        self.connection_watch: dict[tuple[str, str], dict[str, Any]] = {}
        self.youtube_health_cache: dict[tuple[str, str], dict[str, Any]] = {}
        self.youtube_profile_cache: dict[tuple[str, str], dict[str, Any]] = {}
        self.youtube_broadcast_cache: dict[tuple[str, str, str], dict[str, Any]] = {}
        self.youtube_stream_cache: dict[tuple[str, str, str], dict[str, Any]] = {}
        self.youtube_live_chat_context_cache: dict[tuple[str, str, str, str], dict[str, Any]] = {}
        self.youtube_live_chat_quota_cooldowns: dict[tuple[str, str], dict[str, Any]] = {}
        self.playwright_dismiss_channels: set[str] = set()


STATE = AppState()
SYNC_PORT = 0
SYNC_HOST = ""
SYNC_SERVER: ThreadingHTTPServer | None = None
SYNC_THREAD: threading.Thread | None = None
SYNC_LOCK = threading.Lock()


def request_stop_running_stream(
    running: stream_manager.RunningStream,
    *,
    source: str,
    reason: str = "",
) -> None:
    running.stop_request_source = str(source or "").strip()
    running.stop_request_reason = str(reason or "").strip()
    stream_manager.stop_stream(running)


def stream_cycle_runtime_items_locked() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for (config_name, channel_name), runtime in STATE.stream_cycle_channels.items():
        if not isinstance(runtime, dict):
            continue
        if str(runtime.get("phase") or "") != "waiting_restart":
            continue
        items.append(
            {
                "config": str(config_name),
                "channel": str(channel_name),
                "runtime": dict(runtime),
            }
        )
    return items


def write_stream_cycle_runtime_items(items: list[dict[str, Any]]) -> None:
    try:
        STREAM_CYCLE_RUNTIME_FILE.parent.mkdir(parents=True, exist_ok=True)
        if not items:
            STREAM_CYCLE_RUNTIME_FILE.unlink(missing_ok=True)
            return
        payload = {
            "version": 1,
            "updated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "channels": items,
        }
        temp_path = STREAM_CYCLE_RUNTIME_FILE.with_suffix(f"{STREAM_CYCLE_RUNTIME_FILE.suffix}.tmp")
        temp_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        temp_path.replace(STREAM_CYCLE_RUNTIME_FILE)
    except Exception as exc:
        print(f"[automation] could not persist stream cycle runtime: {exc}")


def persist_stream_cycle_runtime() -> None:
    with STATE.lock:
        items = stream_cycle_runtime_items_locked()
    write_stream_cycle_runtime_items(items)


def set_stream_cycle_runtime(runtime_key: tuple[str, str], runtime: dict[str, Any]) -> None:
    with STATE.lock:
        STATE.stream_cycle_channels[runtime_key] = runtime
        items = stream_cycle_runtime_items_locked()
    write_stream_cycle_runtime_items(items)


def pop_stream_cycle_runtime(runtime_key: tuple[str, str]) -> None:
    with STATE.lock:
        STATE.stream_cycle_channels.pop(runtime_key, None)
        items = stream_cycle_runtime_items_locked()
    write_stream_cycle_runtime_items(items)


def clear_stream_cycle_runtime_for_config(config_name: str) -> None:
    with STATE.lock:
        for key in [key for key in STATE.stream_cycle_channels if key[0] == config_name]:
            STATE.stream_cycle_channels.pop(key, None)
        items = stream_cycle_runtime_items_locked()
    write_stream_cycle_runtime_items(items)


def load_stream_cycle_runtime() -> None:
    try:
        payload = json.loads(STREAM_CYCLE_RUNTIME_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return
    except Exception as exc:
        print(f"[automation] could not load stream cycle runtime: {exc}")
        return
    channels = payload.get("channels") if isinstance(payload, dict) else []
    if not isinstance(channels, list):
        return
    restored: dict[tuple[str, str], dict[str, Any]] = {}
    for item in channels:
        if not isinstance(item, dict):
            continue
        config_name = str(item.get("config") or "").strip()
        channel_name = str(item.get("channel") or "").strip()
        runtime = item.get("runtime") if isinstance(item.get("runtime"), dict) else {}
        if not config_name or not channel_name or str(runtime.get("phase") or "") != "waiting_restart":
            continue
        restored[(config_name, channel_name)] = dict(runtime)
    if not restored:
        return
    with STATE.lock:
        STATE.stream_cycle_channels.update(restored)
    print(f"[automation] restored {len(restored)} stream cycle cooldown state(s)")


def desktop_oauth_redirect_uri(configured_redirect_uri: Any = "") -> str:
    configured = str(configured_redirect_uri or "").strip()
    path = "/oauth2redirect"
    try:
        parsed = urlparse(configured)
        if parsed.scheme in {"http", "https"} and parsed.path:
            path = parsed.path
        elif configured.startswith("/"):
            path = configured
    except Exception:
        path = "/oauth2redirect"
    if not path.startswith("/"):
        path = f"/{path}"
    return f"http://127.0.0.1:{UI_PORT}{path}"


def active_youtube_oauth_redirect_uri(config: dict[str, Any]) -> str:
    settings = youtube_service.merge_settings(config)
    configured = str(settings.get("redirect_uri") or "").strip()
    if settings.get("oauth_client_type") == "web":
        return configured
    return desktop_oauth_redirect_uri(configured)


def active_storage_oauth_redirect_uri(provider: dict[str, Any]) -> str:
    oauth = google_drive_provider.provider_oauth(provider)
    configured = str(oauth.get("redirect_uri") or "").strip()
    if oauth.get("oauth_client_type") == "web":
        return configured
    return desktop_oauth_redirect_uri(configured)


def is_client_disconnect_error(exc: BaseException) -> bool:
    if isinstance(exc, (BrokenPipeError, ConnectionAbortedError, ConnectionResetError)):
        return True
    if isinstance(exc, OSError):
        return getattr(exc, "winerror", None) in {10053, 10054, 995}
    return False


def cors_origin(handler: BaseHTTPRequestHandler) -> str | None:
    origin = str(handler.headers.get("Origin") or "").strip()
    if not origin:
        return None
    if origin == "null":
        return origin
    try:
        parsed = urlparse(origin)
    except Exception:
        return None
    if parsed.scheme in {"http", "https"} and parsed.hostname in {"127.0.0.1", "localhost"}:
        return origin
    return None


def cors_headers(handler: BaseHTTPRequestHandler) -> dict[str, str]:
    origin = cors_origin(handler)
    if not origin:
        return {}
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Request-ID, X-Client-Action",
        "Vary": "Origin",
    }


def new_request_id() -> str:
    return f"req-{int(time.time() * 1000)}-{secrets.token_hex(4)}"


def begin_request_trace(handler: BaseHTTPRequestHandler, method: str, raw_path: str) -> str:
    request_id = str(handler.headers.get("X-Request-ID") or "").strip() or new_request_id()
    client_action = str(handler.headers.get("X-Client-Action") or "").strip()
    handler._request_trace = {
        "request_id": request_id,
        "method": method,
        "path": raw_path,
        "client_action": client_action,
        "started_at": time.time(),
        "logged": False,
    }
    return request_id


def update_request_trace(handler: BaseHTTPRequestHandler, **kwargs: Any) -> None:
    trace = getattr(handler, "_request_trace", None)
    if not isinstance(trace, dict):
        return
    trace.update(kwargs)


def attach_request_error(handler: BaseHTTPRequestHandler, exc: BaseException) -> None:
    error_trace = traceback.format_exc(limit=20)
    if len(error_trace) > 8000:
        error_trace = error_trace[-8000:]
    update_request_trace(
        handler,
        error_type=type(exc).__name__,
        error_message=str(exc),
        error_traceback=error_trace,
    )


def record_request_trace(handler: BaseHTTPRequestHandler, status_code: int, outcome: str) -> None:
    trace = getattr(handler, "_request_trace", None)
    if not isinstance(trace, dict) or trace.get("logged"):
        return

    path = str(trace.get("path") or "")
    client_action = str(trace.get("client_action") or "")
    if path.startswith("/api/video-thumbnail"):
        trace["logged"] = True
        return
    if path == "/api/activity/clear":
        trace["logged"] = True
        return
    if status_code < 400:
        if not path.startswith("/api/"):
            trace["logged"] = True
            return
        if path.startswith("/api/status") and not client_action:
            trace["logged"] = True
            return

    started_at = float(trace.get("started_at") or time.time())
    duration_ms = int(max(0, (time.time() - started_at) * 1000))
    details = {
        "request_id": trace.get("request_id"),
        "method": trace.get("method"),
        "path": path,
        "status_code": int(status_code),
        "outcome": outcome,
        "duration_ms": duration_ms,
        "client_action": client_action,
        "query_keys": trace.get("query_keys", []),
        "body_keys": trace.get("body_keys", []),
        "raw_config": trace.get("raw_config", ""),
        "config_name": trace.get("config_name", ""),
        "channel_name": trace.get("channel_name", ""),
        "task_action": trace.get("task_action", ""),
        "error_type": trace.get("error_type", ""),
        "error_message": trace.get("error_message", ""),
        "error_traceback": trace.get("error_traceback", ""),
    }
    try:
        app_db.record_event("api_request", trace.get("config_name"), trace.get("channel_name"), details)
    except Exception as record_exc:
        print(f"[ui] failed to record api_request event: {record_exc}")
    trace["logged"] = True


def write_response(
    handler: BaseHTTPRequestHandler,
    status: int,
    body: bytes,
    content_type_value: str,
    extra_headers: dict[str, str] | None = None,
) -> bool:
    try:
        handler.send_response(status)
        handler.send_header("Content-Type", content_type_value)
        handler.send_header("Content-Length", str(len(body)))
        trace = getattr(handler, "_request_trace", None)
        request_id = str((trace or {}).get("request_id") or "")
        if request_id:
            handler.send_header("X-Request-ID", request_id)
        for key, value in cors_headers(handler).items():
            handler.send_header(key, value)
        if extra_headers:
            for key, value in extra_headers.items():
                handler.send_header(key, value)
        handler.end_headers()
        handler.wfile.write(body)
        outcome = "success" if int(status) < 400 else "error"
        record_request_trace(handler, int(status), outcome)
        return True
    except Exception as exc:
        if is_client_disconnect_error(exc):
            attach_request_error(handler, exc)
            record_request_trace(handler, 499, "client_disconnect")
            return False
        attach_request_error(handler, exc)
        record_request_trace(handler, int(status), "write_failed")
        raise


def json_response(handler: BaseHTTPRequestHandler, payload: Any, status: int = 200) -> None:
    data = json.dumps(payload, indent=2).encode("utf-8")
    write_response(handler, status, data, "application/json; charset=utf-8")


def text_response(handler: BaseHTTPRequestHandler, payload: str, status: int = 200) -> None:
    data = payload.encode("utf-8")
    write_response(handler, status, data, "text/plain; charset=utf-8")


def read_body(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("Content-Length", "0"))
    if not length:
        return {}
    raw = handler.rfile.read(length).decode("utf-8")
    return json.loads(raw) if raw else {}


def sanitize_filename(value: str) -> str:
    name = Path(value).name.strip().replace("\x00", "")
    name = re.sub(r'[<>:"/\\|?*]+', "_", name)
    return name or "video.mp4"


def unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    stem = path.stem
    suffix = path.suffix
    parent = path.parent
    counter = 2
    while True:
        candidate = parent / f"{stem}-{counter}{suffix}"
        if not candidate.exists():
            return candidate
        counter += 1


def safe_config_name(value: str | None) -> str:
    name = value or DEFAULT_CONFIG
    path = (ROOT / name).resolve()
    if path.parent != ROOT or path.suffix.lower() != ".json" or path.name in INTERNAL_JSON_FILES:
        raise ValueError("Config must be a JSON file in the project root.")
    return path.name


def load_config_or_none(config_name: str) -> tuple[dict[str, Any] | None, str | None]:
    path = ROOT / config_name
    if not path.exists():
        return None, f"{config_name} does not exist yet."
    try:
        with path.open("r", encoding="utf-8-sig") as fh:
            config = runtime_paths.apply_runtime_defaults(json.load(fh))
            runtime_paths.apply_youtube_owner_seed(config)
            normalize_ui_settings(config)
            normalize_alert_settings(config)
            normalize_scheduler_settings(config)
            normalize_stream_cycle_settings(config)
            normalize_youtube_channel_settings(config)
            storage_providers.normalize_storage_config(config)
            normalize_youtube_accounts(config)
            return config, None
    except Exception as exc:
        return None, str(exc)


def save_config(config_name: str, config: dict[str, Any]) -> None:
    runtime_paths.apply_youtube_owner_seed(config)
    normalize_ui_settings(config)
    normalize_alert_settings(config)
    normalize_scheduler_settings(config)
    normalize_stream_cycle_settings(config)
    normalize_youtube_channel_settings(config)
    storage_providers.normalize_storage_config(config)
    normalize_youtube_accounts(config)
    for channel in config.get("channels", []):
        if not isinstance(channel, dict):
            continue
        channel["youtube_account_id"] = normalize_account_id(channel.get("youtube_account_id") or "")
    trim_stream_key_fields(config)
    validate_stream_key_fields(config)
    target = ROOT / config_name
    target.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    ensure_media_folders(config)
    storage_providers.ensure_storage_dirs(config, ROOT)
    app_db.sync_config(config_name, config, "save")


def normalize_youtube_channel_settings(config: dict[str, Any]) -> None:
    for channel in config.get("channels", []):
        if not isinstance(channel, dict):
            continue
        if "youtube_dual_stream" not in channel:
            channel["youtube_dual_stream"] = True
        else:
            channel["youtube_dual_stream"] = bool(channel.get("youtube_dual_stream"))


def normalize_ui_settings(config: dict[str, Any]) -> dict[str, Any]:
    raw = config.get("ui")
    ui = dict(raw) if isinstance(raw, dict) else {}
    ui["channel_workspace_enabled"] = bool(ui.get("channel_workspace_enabled", True))
    ui["legacy_tabs_enabled"] = ui.get("legacy_tabs_enabled", True) is not False
    config["ui"] = ui
    return ui


def default_alert_settings() -> dict[str, Any]:
    return {
        "notification_mode": "all",
        "desktop_notifications_enabled": True,
        "mobile_notifications_enabled": True,
        "cooldown_seconds": 300,
        "rules": {
            "stream_stopped": True,
            "poor_connection": True,
            "scheduler_started": True,
            "scheduler_stopped": True,
        },
    }


def normalize_notification_mode(value: Any) -> str:
    mode = str(value or "").strip().lower()
    return mode if mode in {"all", "critical", "off"} else "all"


def alert_notification_allowed(settings: dict[str, Any], severity: str) -> bool:
    mode = normalize_notification_mode(settings.get("notification_mode"))
    if mode == "off":
        return False
    if mode == "critical":
        return str(severity or "").strip().lower() == "danger"
    return True


def normalize_alert_settings(config: dict[str, Any]) -> dict[str, Any]:
    raw = config.get("alerts")
    alerts = dict(raw) if isinstance(raw, dict) else {}
    defaults = default_alert_settings()
    rules_raw = alerts.get("rules")
    rules = dict(rules_raw) if isinstance(rules_raw, dict) else {}
    alerts["notification_mode"] = normalize_notification_mode(alerts.get("notification_mode", defaults["notification_mode"]))
    alerts["desktop_notifications_enabled"] = bool(alerts.get("desktop_notifications_enabled", True))
    alerts["mobile_notifications_enabled"] = bool(alerts.get("mobile_notifications_enabled", True))
    alerts["cooldown_seconds"] = max(30, int(alerts.get("cooldown_seconds") or defaults["cooldown_seconds"]))
    alerts["rules"] = {
        key: bool(rules.get(key, value))
        for key, value in defaults["rules"].items()
    }
    config["alerts"] = alerts
    return alerts


def default_scheduler_settings() -> dict[str, Any]:
    return {
        "enabled": False,
        "timezone": "local",
        "poll_seconds": 20,
        "channels": [],
    }


def default_stream_cycle_settings() -> dict[str, Any]:
    return {
        "enabled": False,
        "restart_delay_seconds": 180,
        "randomized": False,
        "restart_delay_random_minutes": 0,
        "channels": [],
    }


def stream_cycle_duration_seconds(entry: dict[str, Any]) -> int:
    raw_seconds = entry.get("duration_seconds")
    if raw_seconds in (None, ""):
        raw_minutes = entry.get("duration_minutes")
        try:
            raw_seconds = float(raw_minutes) * 60
        except (TypeError, ValueError):
            raw_seconds = 12 * 60 * 60
    try:
        seconds = int(float(raw_seconds))
    except (TypeError, ValueError):
        seconds = 12 * 60 * 60
    return max(1, min(seconds, 7 * 24 * 60 * 60))


def stream_cycle_random_bracket_seconds(
    entry: dict[str, Any],
    *,
    min_key: str,
    max_key: str,
    fallback_seconds: int | float,
    maximum_seconds: int,
    minimum_seconds: int = 1,
) -> tuple[int, int]:
    def parse(value: Any, fallback: int | float) -> int:
        raw = fallback if value in (None, "") else value
        try:
            seconds = int(float(raw))
        except (TypeError, ValueError):
            seconds = int(float(fallback))
        return max(minimum_seconds, min(seconds, maximum_seconds))

    start = parse(entry.get(min_key), fallback_seconds)
    end = parse(entry.get(max_key), max(start, int(float(fallback_seconds))))
    if end < start:
        start, end = end, start
    return start, end


def random_seconds_between(start_seconds: int | float, end_seconds: int | float, *, minimum_seconds: int = 1) -> int:
    start = max(minimum_seconds, int(float(start_seconds)))
    end = max(start, int(float(end_seconds)))
    return random.randint(start, end)


def stream_cycle_random_minutes(entry: dict[str, Any], field: str, *, fallback_seconds: int | float = 0) -> int:
    raw = entry.get(field)
    if raw in (None, ""):
        raw = float(fallback_seconds) / 60
    try:
        minutes = int(float(raw))
    except (TypeError, ValueError):
        minutes = 0
    return max(0, min(minutes, 7 * 24 * 60))


def stream_cycle_restart_delay_seconds(settings: dict[str, Any]) -> float:
    raw = settings.get("restart_delay_seconds", 180)
    if raw in (None, ""):
        raw = 180
    try:
        return max(0.0, min(float(raw), 3600.0))
    except (TypeError, ValueError):
        return 180.0


def stream_cycle_restart_delay_bracket_seconds(settings: dict[str, Any]) -> tuple[int, int]:
    fallback = int(stream_cycle_restart_delay_seconds(settings))
    return stream_cycle_random_bracket_seconds(
        settings,
        min_key="restart_delay_min_seconds",
        max_key="restart_delay_max_seconds",
        fallback_seconds=fallback,
        maximum_seconds=3600,
        minimum_seconds=0,
    )


def normalize_stream_cycle_settings(config: dict[str, Any]) -> dict[str, Any]:
    raw = config.get("stream_cycles")
    settings = dict(raw) if isinstance(raw, dict) else {}
    defaults = default_stream_cycle_settings()
    settings["enabled"] = bool(settings.get("enabled", defaults["enabled"]))
    settings["restart_delay_seconds"] = stream_cycle_restart_delay_seconds(settings)
    settings["randomized"] = bool(settings.get("randomized", settings.get("restart_delay_randomized", defaults["randomized"])))
    delay_min, delay_max = stream_cycle_restart_delay_bracket_seconds(settings)
    fallback_delay_random_seconds = max(0, delay_max - int(settings["restart_delay_seconds"])) if delay_max else 0
    settings["restart_delay_random_minutes"] = stream_cycle_random_minutes(
        settings,
        "restart_delay_random_minutes",
        fallback_seconds=fallback_delay_random_seconds,
    )
    raw_channels = settings.get("channels")
    normalized_channels: list[dict[str, Any]] = []
    if isinstance(raw_channels, list):
        for item in raw_channels:
            if not isinstance(item, dict):
                continue
            channel_name = str(item.get("channel") or item.get("channel_name") or "").strip()
            if not channel_name:
                continue
            duration_seconds = stream_cycle_duration_seconds(item)
            duration_min, duration_max = stream_cycle_random_bracket_seconds(
                item,
                min_key="duration_min_seconds",
                max_key="duration_max_seconds",
                fallback_seconds=duration_seconds,
                maximum_seconds=7 * 24 * 60 * 60,
            )
            fallback_duration_random_seconds = max(0, duration_max - duration_seconds)
            normalized_channels.append(
                {
                    "channel": channel_name,
                    "enabled": bool(item.get("enabled", False)),
                    "duration_seconds": duration_seconds,
                    "duration_random_minutes": stream_cycle_random_minutes(
                        item,
                        "duration_random_minutes",
                        fallback_seconds=fallback_duration_random_seconds,
                    ),
                }
            )
    settings["channels"] = normalized_channels
    config["stream_cycles"] = settings
    return settings


def normalize_scheduler_days(value: Any) -> list[str]:
    if not isinstance(value, list):
        return list(SCHEDULER_DAY_ORDER)
    seen: list[str] = []
    for item in value:
        day = str(item or "").strip().lower()[:3]
        if day in SCHEDULER_DAY_ORDER and day not in seen:
            seen.append(day)
    return seen or list(SCHEDULER_DAY_ORDER)


def sanitize_scheduler_time(value: Any, *, fallback: str) -> str:
    text = str(value or "").strip()
    if re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", text):
        return text
    return fallback


def normalize_scheduler_settings(config: dict[str, Any]) -> dict[str, Any]:
    raw = config.get("scheduler")
    scheduler = dict(raw) if isinstance(raw, dict) else {}
    defaults = default_scheduler_settings()
    scheduler["enabled"] = bool(scheduler.get("enabled", defaults["enabled"]))
    scheduler["timezone"] = str(scheduler.get("timezone") or defaults["timezone"]).strip() or "local"
    scheduler["poll_seconds"] = max(10, int(scheduler.get("poll_seconds") or defaults["poll_seconds"]))
    raw_channels = scheduler.get("channels")
    normalized_channels: list[dict[str, Any]] = []
    if isinstance(raw_channels, list):
        for item in raw_channels:
            if not isinstance(item, dict):
                continue
            channel_name = str(item.get("channel") or item.get("channel_name") or "").strip()
            if not channel_name:
                continue
            normalized_channels.append(
                {
                    "channel": channel_name,
                    "enabled": bool(item.get("enabled", False)),
                    "start_time": sanitize_scheduler_time(item.get("start_time"), fallback="09:00"),
                    "stop_time": sanitize_scheduler_time(item.get("stop_time"), fallback="17:00"),
                    "days": normalize_scheduler_days(item.get("days")),
                }
            )
    scheduler["channels"] = normalized_channels
    config["scheduler"] = scheduler
    return scheduler


def looks_like_rtmp_url(value: Any) -> bool:
    text = str(value or "").strip().lower()
    return text.startswith("rtmp://") or text.startswith("rtmps://")


def trim_stream_key_fields(config: dict[str, Any]) -> None:
    for channel in config.get("channels", []):
        if not isinstance(channel, dict):
            continue
        stream_key_env = channel.get("stream_key_env")
        if isinstance(stream_key_env, str):
            channel["stream_key_env"] = stream_key_env.strip()
        stream_key = channel.get("stream_key")
        if isinstance(stream_key, str):
            channel["stream_key"] = stream_key.strip()


def validate_stream_key_fields(config: dict[str, Any]) -> None:
    for channel in config.get("channels", []):
        channel_name = str(channel.get("name") or "Unnamed channel").strip() or "Unnamed channel"
        stream_key_env = str(channel.get("stream_key_env") or "").strip()
        if stream_key_env and looks_like_rtmp_url(stream_key_env):
            raise ValueError(
                f"Channel '{channel_name}': do not paste full RTMP URL in 'Stream key'. "
                "Paste only the stream key."
            )


def normalize_account_id(value: str) -> str:
    text = re.sub(r"[^a-zA-Z0-9_-]+", "-", str(value or "").strip().lower())
    text = text.strip("-_")
    return text


def account_tokens_file(account_id: str) -> str:
    safe = normalize_account_id(account_id) or "account"
    return f".runtime/youtube_tokens_{safe}.json"


def next_account_id(config: dict[str, Any]) -> str:
    accounts = normalize_youtube_accounts(config)
    used = {str(item.get("id") or "") for item in accounts}
    index = 1
    while True:
        candidate = f"account-{index}"
        if candidate not in used:
            return candidate
        index += 1


def normalize_youtube_accounts(config: dict[str, Any]) -> list[dict[str, Any]]:
    youtube_service.ensure_shape(config)
    youtube = config.get("youtube")
    if not isinstance(youtube, dict):
        youtube = {}
        config["youtube"] = youtube

    raw_accounts = youtube.get("accounts")
    normalized: list[dict[str, Any]] = []
    if isinstance(raw_accounts, list):
        for item in raw_accounts:
            if not isinstance(item, dict):
                continue
            account_id = normalize_account_id(item.get("id") or item.get("account_id") or "")
            if not account_id:
                continue
            label = str(item.get("label") or item.get("name") or account_id).strip() or account_id
            tokens_file = str(item.get("tokens_file") or "").strip() or account_tokens_file(account_id)
            normalized.append(
                {
                    "id": account_id,
                    "label": label,
                    "tokens_file": tokens_file,
                    "channel_id": str(item.get("channel_id") or "").strip(),
                    "channel_title": str(item.get("channel_title") or "").strip(),
                    "channel_handle": str(item.get("channel_handle") or "").strip(),
                    "subscriber_count": str(item.get("subscriber_count") or "").strip(),
                    "hidden_subscriber_count": bool(item.get("hidden_subscriber_count")),
                    "expected_channel_name": str(item.get("expected_channel_name") or "").strip(),
                    "last_connected_at": str(item.get("last_connected_at") or "").strip(),
                }
            )
    legacy_tokens_file = str(youtube.get("tokens_file") or "").strip()
    if legacy_tokens_file and not normalized:
        normalized.append(
            {
                "id": "default",
                "label": "Default account",
                "tokens_file": legacy_tokens_file,
                "channel_id": "",
                "channel_title": "",
                "channel_handle": "",
                "subscriber_count": "",
                "hidden_subscriber_count": False,
                "expected_channel_name": "",
                "last_connected_at": "",
            }
        )
    youtube["accounts"] = normalized

    default_account_id = normalize_account_id(youtube.get("default_account_id") or "")
    if default_account_id and any(item.get("id") == default_account_id for item in normalized):
        youtube["default_account_id"] = default_account_id
    elif normalized:
        youtube["default_account_id"] = str(normalized[0].get("id") or "")
    else:
        youtube["default_account_id"] = ""

    return normalized


def find_youtube_account(config: dict[str, Any], account_id: str) -> dict[str, Any] | None:
    key = normalize_account_id(account_id)
    if not key:
        return None
    for account in normalize_youtube_accounts(config):
        if str(account.get("id") or "") == key:
            return account
    return None


def ensure_youtube_account(config: dict[str, Any], account_id: str, label: str = "") -> dict[str, Any]:
    normalized_id = normalize_account_id(account_id)
    if not normalized_id:
        raise ValueError("Account slot ID is required.")
    existing = find_youtube_account(config, normalized_id)
    if existing:
        if label.strip():
            existing["label"] = label.strip()
        return existing
    youtube = config.setdefault("youtube", {})
    accounts = normalize_youtube_accounts(config)
    created = {
        "id": normalized_id,
        "label": label.strip() or normalized_id,
        "tokens_file": account_tokens_file(normalized_id),
        "channel_id": "",
        "channel_title": "",
        "channel_handle": "",
        "subscriber_count": "",
        "hidden_subscriber_count": False,
        "expected_channel_name": "",
        "last_connected_at": "",
    }
    accounts.append(created)
    youtube["accounts"] = accounts
    youtube["default_account_id"] = youtube.get("default_account_id") or normalized_id
    return created


def find_reusable_youtube_account_for_channel(config: dict[str, Any], channel_name: str) -> dict[str, Any] | None:
    expected = str(channel_name or "").strip()
    if not expected:
        return None
    for channel in config.get("channels", []):
        if not isinstance(channel, dict):
            continue
        if str(channel.get("name") or "").strip() != expected:
            continue
        account = find_youtube_account(config, channel.get("youtube_account_id") or "")
        if account:
            return account
    for account in normalize_youtube_accounts(config):
        if str(account.get("expected_channel_name") or "").strip() == expected:
            return account
    for account in normalize_youtube_accounts(config):
        if str(account.get("label") or "").strip() == expected:
            return account
    return None


def ensure_channel_streams(channel: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(channel, dict):
        return []
    streams = channel.get("streams")
    if not isinstance(streams, list):
        key = str(channel.get("stream_key") or "").strip()
        key_env = str(channel.get("stream_key_env") or "").strip()
        streams = [
            {
                "id": "stream_1",
                "name": "Main Stream Feed",
                "stream_key": key,
                "stream_key_env": key_env,
                "enabled": bool(channel.get("enabled", True)),
                "playlist": [],
            }
        ]
        channel["streams"] = streams
    else:
        filtered_streams = []
        for s in streams:
            if not isinstance(s, dict):
                continue
            sname = str(s.get("name") or "").strip()
            skey = str(s.get("stream_key") or "").strip()
            if skey == "sample_dummy_stream_key_secondary" or "dummy" in sname.lower() or sname == "Secondary Stream (Dummy / Test)":
                continue
            filtered_streams.append(s)

        if not filtered_streams:
            key = str(channel.get("stream_key") or "").strip()
            key_env = str(channel.get("stream_key_env") or "").strip()
            filtered_streams = [
                {
                    "id": "stream_1",
                    "name": "Main Stream Feed",
                    "stream_key": key,
                    "stream_key_env": key_env,
                    "enabled": bool(channel.get("enabled", True)),
                    "playlist": [],
                }
            ]
        else:
            for idx, s in enumerate(filtered_streams):
                if not s.get("id"):
                    s["id"] = f"stream_{idx + 1}"
                if not s.get("name"):
                    s["name"] = f"Stream {idx + 1}"
                if "enabled" not in s:
                    s["enabled"] = True
                if "playlist" not in s:
                    s["playlist"] = []
        channel["streams"] = filtered_streams
    return channel["streams"]



def comparable_youtube_name(value: Any, *, letters_only: bool = True) -> str:
    text = unicodedata.normalize("NFKD", str(value or "")).casefold()
    if letters_only:
        return "".join(ch for ch in text if ch.isalpha())
    return "".join(ch for ch in text if ch.isalnum())


YOUTUBE_NAME_BOILERPLATE_PHRASES = [
    "account channel",
    "official channel",
    "official account",
    "official youtube channel",
    "youtube channel",
    "original channel",
    "original account",
    "verified channel",
    "verified account",
]


def youtube_name_display_variants(value: Any) -> list[str]:
    text = unicodedata.normalize("NFKD", str(value or "")).casefold()
    text = re.sub(r"[\(\[\{][^\)\]\}]{0,80}[\)\]\}]", " ", text)
    raw_variants = [text]
    raw_variants.extend(part for part in re.split(r"\s+[-–—|:/\\]\s+", text) if part.strip())

    variants: list[str] = []
    for item in raw_variants:
        cleaned = f" {item} "
        for phrase in YOUTUBE_NAME_BOILERPLATE_PHRASES:
            cleaned = cleaned.replace(f" {phrase} ", " ")
        cleaned = re.sub(r"\b(official|original|verified)\b", " ", cleaned)
        cleaned = re.sub(r"\b(channel|account)\b", " ", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        variants.extend([item.strip(), cleaned])
    return [item for item in dict.fromkeys(variants) if item]


def comparable_youtube_name_variants(value: Any) -> list[str]:
    variants: list[str] = []
    for display_value in youtube_name_display_variants(value):
        variants.append(comparable_youtube_name(display_value, letters_only=True))
        variants.append(comparable_youtube_name(display_value, letters_only=False))
    return [item for item in dict.fromkeys(variants) if item]


def youtube_channel_name_match(expected_name: str, profile: dict[str, Any]) -> dict[str, Any]:
    expected_variants = comparable_youtube_name_variants(expected_name)
    if not expected_variants:
        return {
            "ok": True,
            "score": 1.0,
            "matched_field": "",
            "matched_value": "",
            "threshold": YOUTUBE_CHANNEL_NAME_MATCH_THRESHOLD,
        }

    candidates = {
        "title": str(profile.get("channel_title") or ""),
        "handle": str(profile.get("channel_handle") or "").lstrip("@"),
    }
    best_score = 0.0
    best_field = ""
    best_value = ""
    for field, value in candidates.items():
        candidate_variants = comparable_youtube_name_variants(value)
        for expected in expected_variants:
            for candidate in candidate_variants:
                score = SequenceMatcher(None, expected, candidate).ratio()
                if score > best_score:
                    best_score = score
                    best_field = field
                    best_value = value
    return {
        "ok": best_score >= YOUTUBE_CHANNEL_NAME_MATCH_THRESHOLD,
        "score": best_score,
        "matched_field": best_field,
        "matched_value": best_value,
        "threshold": YOUTUBE_CHANNEL_NAME_MATCH_THRESHOLD,
    }


def find_channel_by_name(config: dict[str, Any], channel_name: str) -> dict[str, Any] | None:
    expected = str(channel_name or "").strip()
    if not expected:
        return None
    for channel in config.get("channels", []):
        if isinstance(channel, dict) and str(channel.get("name") or "").strip() == expected:
            return channel
    return None


def youtube_account_expected_channel_name(config: dict[str, Any], account: dict[str, Any]) -> str:
    explicit = str(account.get("expected_channel_name") or "").strip()
    if explicit:
        return explicit

    account_id = normalize_account_id(account.get("id") or "")
    if account_id:
        for channel in config.get("channels", []):
            if not isinstance(channel, dict):
                continue
            if normalize_account_id(channel.get("youtube_account_id") or "") == account_id:
                return str(channel.get("name") or "").strip()

    label = str(account.get("label") or "").strip()
    if label and find_channel_by_name(config, label):
        return label
    return ""


def youtube_profile_mismatch_message(expected_channel_name: str, profile: dict[str, Any]) -> str:
    expected = str(expected_channel_name or "").strip()
    if not expected:
        return ""
    match = youtube_channel_name_match(expected, profile)
    if match.get("ok"):
        return ""
    connected_name = str(profile.get("channel_title") or profile.get("channel_handle") or "unknown channel")
    score = round(float(match.get("score") or 0) * 100)
    threshold = round(float(match.get("threshold") or YOUTUBE_CHANNEL_NAME_MATCH_THRESHOLD) * 100)
    return (
        f"Connected YouTube channel '{connected_name}' does not look like Castarro channel "
        f"'{expected}' ({score}% match; need at least {threshold}%). "
        "Please select the matching Castarro channel or sign in with the correct YouTube account."
    )


def account_config_view(config: dict[str, Any], account: dict[str, Any]) -> dict[str, Any]:
    youtube = config.get("youtube")
    youtube_map = dict(youtube) if isinstance(youtube, dict) else {}
    tokens_file = str(account.get("tokens_file") or "").strip() or account_tokens_file(str(account.get("id") or "account"))
    youtube_map["tokens_file"] = tokens_file
    return {
        **config,
        "youtube": youtube_map,
    }


def youtube_account_cache_id(account: dict[str, Any]) -> str:
    account_id = normalize_account_id(account.get("id") or "")
    if account_id:
        return account_id
    return str(account.get("tokens_file") or "").strip() or "account"


def youtube_profile_from_account(account: dict[str, Any]) -> dict[str, Any]:
    profile = {
        "channel_id": str(account.get("channel_id") or ""),
        "channel_title": str(account.get("channel_title") or ""),
        "channel_handle": str(account.get("channel_handle") or ""),
        "subscriber_count": str(account.get("subscriber_count") or ""),
        "hidden_subscriber_count": bool(account.get("hidden_subscriber_count")),
    }
    return profile if any(profile.get(key) for key in ("channel_id", "channel_title", "channel_handle")) else {}


def youtube_profile_cache_key(config_name: str, account: dict[str, Any]) -> tuple[str, str]:
    return str(config_name or DEFAULT_CONFIG), youtube_account_cache_id(account)


def cached_connected_account_profile(
    config_name: str,
    account: dict[str, Any],
    access_token: str,
    *,
    force_refresh: bool = False,
) -> dict[str, Any]:
    cache_key = youtube_profile_cache_key(config_name, account)
    now = time.time()
    stored_profile = youtube_profile_from_account(account)
    if not force_refresh:
        with STATE.lock:
            cached = STATE.youtube_profile_cache.get(cache_key)
            if cached and float(cached.get("expires_at") or 0.0) > now:
                payload = cached.get("payload")
                if isinstance(payload, dict):
                    if stored_profile and any(
                        str(payload.get(key) or "") != str(stored_profile.get(key) or "")
                        for key in ("channel_id", "channel_title", "channel_handle")
                    ):
                        STATE.youtube_profile_cache.pop(cache_key, None)
                    else:
                        return dict(payload)
                else:
                    return {}
            if cached:
                STATE.youtube_profile_cache.pop(cache_key, None)
        if stored_profile:
            with STATE.lock:
                STATE.youtube_profile_cache[cache_key] = {
                    "expires_at": now + YOUTUBE_PROFILE_CACHE_SECONDS,
                    "payload": dict(stored_profile),
                    "source": "stored_account",
                }
            return stored_profile

    profile = youtube_service.connected_account_profile(access_token)
    with STATE.lock:
        STATE.youtube_profile_cache[cache_key] = {
            "expires_at": time.time() + YOUTUBE_PROFILE_CACHE_SECONDS,
            "payload": dict(profile),
            "source": "youtube",
        }
    return profile


def youtube_broadcast_cache_key(config_name: str, account: dict[str, Any], bucket: str) -> tuple[str, str, str]:
    return str(config_name or DEFAULT_CONFIG), youtube_account_cache_id(account), str(bucket or "")


def cached_youtube_broadcast_list(
    config_name: str,
    account: dict[str, Any],
    access_token: str,
    *,
    bucket: str,
    loader: Any,
) -> list[dict[str, Any]]:
    cache_key = youtube_broadcast_cache_key(config_name, account, bucket)
    now = time.time()
    with STATE.lock:
        cached = STATE.youtube_broadcast_cache.get(cache_key)
        if cached and float(cached.get("expires_at") or 0.0) > now:
            payload = cached.get("payload")
            return [dict(item) for item in payload] if isinstance(payload, list) else []
        if cached:
            STATE.youtube_broadcast_cache.pop(cache_key, None)
    broadcasts = loader(access_token)
    payload = [dict(item) for item in broadcasts if isinstance(item, dict)]
    with STATE.lock:
        STATE.youtube_broadcast_cache[cache_key] = {
            "expires_at": time.time() + YOUTUBE_BROADCAST_CACHE_SECONDS,
            "payload": [dict(item) for item in payload],
        }
    return payload


def cached_youtube_upcoming_broadcasts(
    config_name: str,
    account: dict[str, Any],
    access_token: str,
    *,
    limit: int = 25,
) -> list[dict[str, Any]]:
    return cached_youtube_broadcast_list(
        config_name,
        account,
        access_token,
        bucket=f"upcoming:{int(limit)}",
        loader=lambda token: youtube_service.list_upcoming_broadcasts(token, limit=limit),
    )


def cached_youtube_broadcasts_by_status(
    config_name: str,
    account: dict[str, Any],
    access_token: str,
    status: str,
    *,
    limit: int = 25,
) -> list[dict[str, Any]]:
    status_text = str(status or "").strip().lower() or "all"
    return cached_youtube_broadcast_list(
        config_name,
        account,
        access_token,
        bucket=f"status:{status_text}:{int(limit)}",
        loader=lambda token: youtube_service.list_broadcasts_by_status(token, status_text, limit=limit),
    )


def cached_youtube_broadcast_by_id(
    config_name: str,
    account: dict[str, Any],
    access_token: str,
    broadcast_id: str,
) -> dict[str, Any] | None:
    broadcast_id = str(broadcast_id or "").strip()
    if not broadcast_id:
        return None
    cache_key = youtube_broadcast_cache_key(config_name, account, f"broadcast:{broadcast_id}:details")
    now = time.time()
    with STATE.lock:
        cached = STATE.youtube_broadcast_cache.get(cache_key)
        if cached and float(cached.get("expires_at") or 0.0) > now:
            payload = cached.get("payload")
            return dict(payload) if isinstance(payload, dict) else None
        if cached:
            STATE.youtube_broadcast_cache.pop(cache_key, None)
    broadcast = youtube_service.broadcast_by_id(access_token, broadcast_id)
    if isinstance(broadcast, dict):
        with STATE.lock:
            STATE.youtube_broadcast_cache[cache_key] = {
                "expires_at": time.time() + YOUTUBE_BROADCAST_CACHE_SECONDS,
                "payload": dict(broadcast),
            }
        return broadcast
    return None


def cached_youtube_broadcast_chat_details_by_id(
    config_name: str,
    account: dict[str, Any],
    access_token: str,
    broadcast_id: str,
) -> dict[str, Any] | None:
    broadcast_id = str(broadcast_id or "").strip()
    if not broadcast_id:
        return None
    cache_key = youtube_broadcast_cache_key(config_name, account, f"broadcast:{broadcast_id}:chat")
    now = time.time()
    with STATE.lock:
        cached = STATE.youtube_broadcast_cache.get(cache_key)
        if cached and float(cached.get("expires_at") or 0.0) > now:
            payload = cached.get("payload")
            return dict(payload) if isinstance(payload, dict) else None
        if cached:
            STATE.youtube_broadcast_cache.pop(cache_key, None)
    broadcast = youtube_service.broadcast_chat_details_by_id(access_token, broadcast_id)
    if isinstance(broadcast, dict):
        with STATE.lock:
            STATE.youtube_broadcast_cache[cache_key] = {
                "expires_at": time.time() + YOUTUBE_BROADCAST_CACHE_SECONDS,
                "payload": dict(broadcast),
            }
        return broadcast
    return None


def cached_youtube_stream_by_id(
    config_name: str,
    account: dict[str, Any],
    access_token: str,
    stream_id: str,
) -> dict[str, Any] | None:
    stream_id = str(stream_id or "").strip()
    if not stream_id:
        return None
    cache_key = (str(config_name or DEFAULT_CONFIG), youtube_account_cache_id(account), f"stream:{stream_id}")
    now = time.time()
    with STATE.lock:
        cached = STATE.youtube_stream_cache.get(cache_key)
        if cached and float(cached.get("expires_at") or 0.0) > now:
            payload = cached.get("payload")
            return dict(payload) if isinstance(payload, dict) else None
        if cached:
            STATE.youtube_stream_cache.pop(cache_key, None)
    stream = youtube_service.live_stream_by_id(access_token, stream_id)
    if isinstance(stream, dict):
        with STATE.lock:
            STATE.youtube_stream_cache[cache_key] = {
                "expires_at": time.time() + YOUTUBE_STREAM_CACHE_SECONDS,
                "payload": dict(stream),
            }
        return stream
    return None


def cached_youtube_mine_live_streams(
    config_name: str,
    account: dict[str, Any],
    access_token: str,
) -> list[dict[str, Any]]:
    cache_key = (str(config_name or DEFAULT_CONFIG), youtube_account_cache_id(account), "mine_live_streams")
    now = time.time()
    with STATE.lock:
        cached = STATE.youtube_stream_cache.get(cache_key)
        if cached and float(cached.get("expires_at") or 0.0) > now:
            payload = cached.get("payload")
            return [dict(item) for item in payload] if isinstance(payload, list) else []
        if cached:
            STATE.youtube_stream_cache.pop(cache_key, None)
    streams = youtube_service.list_mine_live_streams(access_token)
    payload = [dict(item) for item in streams if isinstance(item, dict)]
    with STATE.lock:
        STATE.youtube_stream_cache[cache_key] = {
            "expires_at": time.time() + YOUTUBE_STREAM_CACHE_SECONDS,
            "payload": [dict(item) for item in payload],
        }
    return payload


def clear_youtube_account_caches(config_name: str, account_id: str = "") -> None:
    config_key = str(config_name or DEFAULT_CONFIG)
    account_key = normalize_account_id(account_id or "")
    with STATE.lock:
        for cache in (STATE.youtube_profile_cache, STATE.youtube_broadcast_cache, STATE.youtube_stream_cache):
            for key in list(cache):
                if key[0] == config_key and (not account_key or key[1] == account_key):
                    cache.pop(key, None)


def connected_account_slots(config: dict[str, Any], config_name: str = DEFAULT_CONFIG) -> list[dict[str, Any]]:
    connected: list[dict[str, Any]] = []
    for account in normalize_youtube_accounts(config):
        try:
            scoped_config = account_config_view(config, account)
            tokens = youtube_service.load_tokens(ROOT, scoped_config)
            if not tokens:
                continue
            access_token, _valid_tokens = youtube_service.valid_access_token(ROOT, scoped_config)
            profile = cached_connected_account_profile(config_name, account, access_token)
        except Exception:
            continue
        expected_channel_name = youtube_account_expected_channel_name(config, account)
        if youtube_profile_mismatch_message(expected_channel_name, profile):
            continue
        connected.append(
            {
                "id": str(account.get("id") or ""),
                "label": str(account.get("label") or ""),
                "channel_id": str(profile.get("channel_id") or account.get("channel_id") or ""),
                "channel_title": str(profile.get("channel_title") or account.get("channel_title") or ""),
                "channel_handle": str(profile.get("channel_handle") or account.get("channel_handle") or ""),
                "subscriber_count": str(profile.get("subscriber_count") or account.get("subscriber_count") or ""),
                "hidden_subscriber_count": bool(profile.get("hidden_subscriber_count") or account.get("hidden_subscriber_count")),
            }
        )
    return connected


def connected_account_slots_for_config(config: dict[str, Any], config_name: str) -> list[dict[str, Any]]:
    try:
        return connected_account_slots(config, config_name)
    except TypeError:
        return connected_account_slots(config)


def channel_account_id(config: dict[str, Any], channel: dict[str, Any]) -> str:
    return normalize_account_id(channel.get("youtube_account_id") or "")


def resolve_channel_account_for_action(
    config: dict[str, Any],
    channel: dict[str, Any],
    config_name: str = DEFAULT_CONFIG,
) -> tuple[str, str]:
    explicit = normalize_account_id(channel.get("youtube_account_id") or "")
    if explicit:
        return explicit, ""

    connected = connected_account_slots_for_config(config, config_name)
    if len(connected) > 1:
        return "", "missing_linked_account_multiple_connected"
    accounts = normalize_youtube_accounts(config)
    if len(accounts) > 1:
        return "", "missing_linked_account_multiple_slots"
    return "", "missing_linked_account"


def youtube_health_cache_key(config_name: str, channel: dict[str, Any]) -> tuple[str, str]:
    channel_name = str(channel.get("name") or "").strip()
    account_id = normalize_account_id(channel.get("youtube_account_id") or "")
    stream_id = str(channel.get("youtube_stream_id") or "").strip()
    broadcast_id = str(channel.get("youtube_broadcast_id") or "").strip()
    return (str(config_name or DEFAULT_CONFIG), f"{channel_name}|{account_id}|{stream_id}|{broadcast_id}")


def youtube_stream_health_for_channel(
    config_name: str,
    config: dict[str, Any] | None,
    channel: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if not isinstance(config, dict) or not isinstance(channel, dict):
        return None
    channel_name = str(channel.get("name") or "").strip()
    if not channel_name:
        return None
    account_id = normalize_account_id(channel.get("youtube_account_id") or "")
    if not account_id:
        return None
    stream_id = str(channel.get("youtube_stream_id") or "").strip()
    broadcast_id = str(channel.get("youtube_broadcast_id") or "").strip()
    if not stream_id and not broadcast_id:
        return None

    cache_key = youtube_health_cache_key(config_name, channel)
    now = time.monotonic()
    with STATE.lock:
        cached = STATE.youtube_health_cache.get(cache_key)
        if cached and float(cached.get("expires_at") or 0.0) > now:
            payload = cached.get("payload")
            return dict(payload) if isinstance(payload, dict) else None

    account = find_youtube_account(config, account_id)
    if not account:
        return None

    try:
        scoped_config = account_config_view(config, account)
        access_token, _tokens = youtube_service.valid_access_token(ROOT, scoped_config)
        stream_resource = cached_youtube_stream_by_id(config_name, account, access_token, stream_id) if stream_id else None
        if not stream_resource and broadcast_id:
            broadcast = cached_youtube_broadcast_by_id(config_name, account, access_token, broadcast_id)
            stream_details = broadcast.get("stream") if isinstance(broadcast, dict) and isinstance(broadcast.get("stream"), dict) else {}
        else:
            stream_details = youtube_service.stream_details_from_resource(stream_resource)
        health = youtube_health_view(stream_details)
        health.update(
            {
                "account_id": account_id,
                "channel_name": channel_name,
                "stream_id": stream_id or str(stream_details.get("id") or ""),
                "broadcast_id": broadcast_id,
                "checked_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            }
        )
        ttl = YOUTUBE_HEALTH_CACHE_SECONDS
    except Exception as exc:
        health = {
            "available": False,
            "decisive": False,
            "source": "youtube",
            "account_id": account_id,
            "channel_name": channel_name,
            "stream_id": stream_id,
            "broadcast_id": broadcast_id,
            "error": str(exc),
            "detail": f"YouTube health could not be checked: {exc}",
            "checked_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        }
        ttl = YOUTUBE_HEALTH_ERROR_CACHE_SECONDS

    with STATE.lock:
        STATE.youtube_health_cache[cache_key] = {
            "expires_at": now + ttl,
            "payload": dict(health),
        }
    return health


def youtube_status(config_name: str) -> dict[str, Any]:
    config, error = load_config_or_none(config_name)
    if not config:
        return {
            "connected": False,
            "has_client_credentials": False,
            "message": error or "Config not found.",
        }

    youtube_service.ensure_shape(config)
    settings = youtube_service.merge_settings(config)
    active_redirect_uri = active_youtube_oauth_redirect_uri(config)
    has_credentials = youtube_service.credentials_ready(config)
    accounts = normalize_youtube_accounts(config)
    account_statuses: list[dict[str, Any]] = []
    connected_count = 0
    for account in accounts:
        scoped_config = account_config_view(config, account)
        token_path = youtube_service.tokens_path(ROOT, scoped_config)
        item: dict[str, Any] = {
            "id": str(account.get("id") or ""),
            "label": str(account.get("label") or ""),
            "tokens_file": str(account.get("tokens_file") or ""),
            "connected": False,
            "token_file": str(token_path),
            "channel_id": str(account.get("channel_id") or ""),
            "channel_title": str(account.get("channel_title") or ""),
            "channel_handle": str(account.get("channel_handle") or ""),
            "subscriber_count": str(account.get("subscriber_count") or ""),
            "hidden_subscriber_count": bool(account.get("hidden_subscriber_count")),
            "expected_channel_name": youtube_account_expected_channel_name(config, account),
            "message": "Not connected.",
        }
        try:
            tokens = youtube_service.load_tokens(ROOT, scoped_config)
        except Exception as exc:
            item["message"] = str(exc)
            account_statuses.append(item)
            continue
        if not tokens:
            account_statuses.append(item)
            continue

        item["has_token"] = True
        item["expires_at"] = tokens.get("expires_at")
        try:
            access_token, valid_tokens = youtube_service.valid_access_token(ROOT, scoped_config)
        except Exception as exc:
            item["message"] = str(exc)
            account_statuses.append(item)
            continue

        try:
            profile = cached_connected_account_profile(config_name, account, access_token)
            mismatch_message = youtube_profile_mismatch_message(item["expected_channel_name"], profile)
            item.update(
                {
                    "channel_id": profile.get("channel_id") or item["channel_id"],
                    "channel_title": profile.get("channel_title") or item["channel_title"],
                    "channel_handle": profile.get("channel_handle") or item["channel_handle"],
                    "subscriber_count": str(profile.get("subscriber_count") or item["subscriber_count"] or ""),
                    "hidden_subscriber_count": bool(profile.get("hidden_subscriber_count") or item["hidden_subscriber_count"]),
                    "scopes": valid_tokens.get("scope"),
                    "expires_at": valid_tokens.get("expires_at"),
                }
            )
            if mismatch_message:
                item["wrong_account"] = True
                item["message"] = mismatch_message
                account_statuses.append(item)
                continue
            item["connected"] = True
            item["message"] = "Connected."
            connected_count += 1
        except Exception as exc:
            if item["channel_id"] or item["channel_title"] or item["channel_handle"]:
                item["connected"] = True
                item["scopes"] = valid_tokens.get("scope")
                item["expires_at"] = valid_tokens.get("expires_at")
                item["message"] = f"Connected. Could not refresh YouTube profile: {exc}"
                connected_count += 1
            else:
                item["message"] = str(exc)
        account_statuses.append(item)

    connected_accounts = [item for item in account_statuses if item.get("connected")]
    active = connected_accounts[0] if connected_accounts else (account_statuses[0] if account_statuses else None)
    if not has_credentials:
        message = "Add OAuth client ID and secret, then click Connect to YouTube."
    elif connected_count:
        message = f"{connected_count} YouTube account(s) connected. Pick a Castarro channel to schedule on its linked account."
    else:
        message = "Ready to connect."

    return {
        "connected": connected_count > 0,
        "connected_count": connected_count,
        "has_client_credentials": has_credentials,
        "oauth_client_type": settings.get("oauth_client_type"),
        "use_pkce": bool(settings.get("use_pkce", True)),
        "redirect_uri": active_redirect_uri,
        "configured_redirect_uri": settings.get("redirect_uri"),
        "accounts": account_statuses,
        "default_account_id": str(settings.get("default_account_id") or ""),
        "channel_id": active.get("channel_id") if active else "",
        "channel_title": active.get("channel_title") if active else "",
        "channel_handle": active.get("channel_handle") if active else "",
        "subscriber_count": active.get("subscriber_count") if active else "",
        "hidden_subscriber_count": bool(active.get("hidden_subscriber_count")) if active else False,
        "expires_at": active.get("expires_at") if active else None,
        "message": message,
    }


def storage_provider_status(provider: dict[str, Any]) -> dict[str, Any]:
    provider_type = str(provider.get("type") or "")
    if provider_type == "googleDrive":
        status = google_drive_provider.GoogleDriveProvider(ROOT, provider).status()
        status["redirect_uri"] = active_storage_oauth_redirect_uri(provider)
        status["configured_redirect_uri"] = google_drive_provider.provider_oauth(provider).get("redirect_uri")
        return status
    return storage_providers.provider_status(ROOT, provider)


def storage_status(config_name: str) -> dict[str, Any]:
    config, error = load_config_or_none(config_name)
    if not config:
        raise ValueError(error or "Config not found.")
    storage = storage_providers.normalize_storage_config(config)
    return {
        "ok": True,
        "source_proxy": storage.get("source_proxy", {}),
        "providers": [storage_provider_status(provider) for provider in storage.get("providers", [])],
    }


def storage_files(config_name: str, provider_id: str, folder_id: str | None = None) -> dict[str, Any]:
    config, error = load_config_or_none(config_name)
    if not config:
        raise ValueError(error or "Config not found.")
    provider = storage_providers.find_provider(config, provider_id)
    if not provider:
        raise ValueError(f"Unknown storage provider: {provider_id}")
    provider_type = str(provider.get("type") or "")
    if provider_type == "googleDrive":
        return google_drive_provider.GoogleDriveProvider(ROOT, provider).list_files(folder_id)
    return {
        "ok": False,
        "provider_id": provider.get("id"),
        "items": [],
        "message": f"{provider_type or 'Storage'} browsing is not wired yet.",
    }


def storage_oauth_popup_html(status: str, message: str, details: dict[str, Any] | None = None) -> str:
    payload_data = {"type": "storage-auth", "status": status, "message": message}
    if isinstance(details, dict):
        payload_data.update(details)
    payload = json.dumps(payload_data).replace("</", "<\\/")
    safe_message = message.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Storage Connection</title>
    <link rel="stylesheet" href="/ui-master.css">
  </head>
  <body class="startup-page">
    <main>
      <h1>Storage connection {status}</h1>
      <p>{safe_message}</p>
      <p>You can close this window.</p>
    </main>
    <script>
      (() => {{
        const payload = {payload};
        if (window.opener) {{
          window.opener.postMessage(payload, "*");
        }}
        setTimeout(() => window.close(), 300);
      }})();
    </script>
  </body>
</html>
"""


def create_storage_auth_start(config_name: str, provider_id: str) -> dict[str, Any]:
    config, error = load_config_or_none(config_name)
    if not config:
        raise ValueError(error or "Config not found.")
    provider = storage_providers.find_provider(config, provider_id)
    if not provider:
        raise ValueError(f"Unknown storage provider: {provider_id}")
    provider_type = str(provider.get("type") or "")
    if provider_type != "googleDrive":
        raise ValueError(f"{provider_type or 'Storage'} connection is not wired yet.")
    if not google_drive_provider.credentials_ready(provider):
        raise ValueError("Google Drive client ID is missing in Settings > Storage.")

    oauth = google_drive_provider.provider_oauth(provider)
    redirect_uri = active_storage_oauth_redirect_uri(provider)
    code_verifier = ""
    code_challenge = ""
    if bool(oauth.get("use_pkce", True)):
        code_verifier, code_challenge = youtube_service.pkce_pair()

    oauth_state = secrets.token_urlsafe(24)
    cleanup_expired_oauth_states()
    with STATE.lock:
        STATE.storage_oauth_states[oauth_state] = {
            "created_at": time.time(),
            "config_name": config_name,
            "provider_id": str(provider.get("id") or ""),
            "redirect_uri": redirect_uri,
            "code_verifier": code_verifier,
        }
    return {
        "ok": True,
        "state": oauth_state,
        "provider_id": str(provider.get("id") or ""),
        "url": google_drive_provider.build_auth_url(
            provider,
            oauth_state,
            redirect_uri,
            code_challenge=code_challenge or None,
        ),
    }


def handle_storage_oauth_callback(query: dict[str, list[str]]) -> str:
    oauth_state = str(query.get("state", [""])[0] or "")
    error_code = str(query.get("error", [""])[0] or "")
    auth_code = str(query.get("code", [""])[0] or "")

    cleanup_expired_oauth_states()
    with STATE.lock:
        state_payload = STATE.storage_oauth_states.pop(oauth_state, None)
    if not state_payload:
        return storage_oauth_popup_html("error", "OAuth state is missing or expired. Please connect again.")

    config_name = str(state_payload.get("config_name") or DEFAULT_CONFIG)
    provider_id = str(state_payload.get("provider_id") or "")
    config, error = load_config_or_none(config_name)
    if not config:
        return storage_oauth_popup_html("error", error or "Config not found.")
    provider = storage_providers.find_provider(config, provider_id)
    if not provider:
        return storage_oauth_popup_html("error", f"Unknown storage provider: {provider_id}")
    if error_code:
        return storage_oauth_popup_html("error", f"Google returned: {error_code}")
    if not auth_code:
        return storage_oauth_popup_html("error", "Google did not return an authorization code.")

    try:
        code_verifier = str(state_payload.get("code_verifier") or "").strip() or None
        redirect_uri = str(state_payload.get("redirect_uri") or "").strip() or active_storage_oauth_redirect_uri(provider)
        google_drive_provider.exchange_code_for_tokens(
            ROOT,
            provider,
            auth_code,
            redirect_uri,
            code_verifier=code_verifier,
        )
        access_token, _tokens = google_drive_provider.valid_access_token(ROOT, provider)
        profile = google_drive_provider.connected_account_profile(access_token)
        provider["account_email"] = str(profile.get("email") or "")
        provider["status"] = "connected"
        save_config(config_name, config)
    except Exception as exc:
        return storage_oauth_popup_html("error", str(exc), {"provider_id": provider_id})

    title = str(provider.get("display_name") or "Google Drive")
    account_label = str(profile.get("email") or profile.get("name") or "").strip()
    message = f"Connected {title}{f' as {account_label}' if account_label else ''}."
    return storage_oauth_popup_html(
        "ok",
        message,
        {
            "provider_id": provider_id,
            "display_name": title,
            "account_email": str(profile.get("email") or ""),
            "account_name": str(profile.get("name") or ""),
        },
    )


def provider_cloud_source_uri(provider_id: str, file_id: str) -> str:
    return f"castarro://cloud/{provider_id}/{file_id}"


def probe_cache(root: Path, config: dict[str, Any]) -> cloud_probe.CloudProbeCache:
    defaults = config.get("defaults") if isinstance(config.get("defaults"), dict) else {}
    runtime_dir = stream_manager.resolve_path(root, defaults.get("runtime_dir", ".runtime"))
    return cloud_probe.CloudProbeCache(runtime_dir / "cloud-probe-cache.json")


def ensure_cloud_proxy(config: dict[str, Any]) -> cloud_source_proxy.CloudSourceProxy:
    storage = storage_providers.normalize_storage_config(config)
    proxy_settings = dict(storage.get("source_proxy", {}))
    desired = {
        "host": str(proxy_settings.get("host") or "127.0.0.1"),
        "port": int(proxy_settings.get("port") or 8876),
        "cache_dir": str(proxy_settings.get("cache_dir") or ".runtime/cloud-cache"),
    }
    cache_dir = storage_providers.resolve_config_path(ROOT, desired["cache_dir"])

    with STATE.lock:
        current = STATE.cloud_proxy
        same_settings = bool(current and current.is_running and STATE.cloud_proxy_settings == desired)
        if same_settings:
            return current

        running_streams = any(stream.running.process.poll() is None for stream in STATE.streams.values())
        if current and current.is_running and running_streams:
            return current

        if current:
            current.stop()

        proxy = cloud_source_proxy.CloudSourceProxy(
            host=desired["host"],
            port=desired["port"],
            cache_dir=cache_dir,
            retry_wait_seconds=0.35,
        )
        proxy.start()
        STATE.cloud_proxy = proxy
        STATE.cloud_proxy_settings = desired
        return proxy


def cloud_video_timestamp(existing: dict[str, Any] | None, *keys: str) -> str:
    if isinstance(existing, dict):
        for key in keys:
            value = str(existing.get(key) or "").strip()
            if value:
                return value
    return ""


def prepare_google_drive_cloud_video(
    config: dict[str, Any],
    provider: dict[str, Any],
    file_id: str,
    existing: dict[str, Any] | None = None,
) -> dict[str, Any]:
    drive = google_drive_provider.GoogleDriveProvider(ROOT, provider)
    metadata = drive.get_file_metadata(file_id)
    google_drive_provider.validate_drive_file_metadata(metadata)

    provider_id = str(provider.get("id") or "")
    display_name = str(metadata.get("name") or file_id).strip() or file_id
    mime_type = str(metadata.get("mimeType") or "video/mp4").strip() or "video/mp4"
    size_text = str(metadata.get("size") or "").strip()
    size_bytes = int(size_text) if size_text else 0
    etag = str(metadata.get("modifiedTime") or metadata.get("md5Checksum") or "").strip() or None
    checksum = str(metadata.get("md5Checksum") or "").strip()
    checksum_value = f"md5:{checksum}" if checksum else None
    source_uri = provider_cloud_source_uri(provider_id, file_id)
    now_text = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    created_at = cloud_video_timestamp(existing, "created_at", "createdAt") or now_text

    try:
        range_sample = drive.read_range(file_id, 0, 0)
        range_readable = len(range_sample) == 1 if size_bytes > 0 else True
    except Exception as exc:
        range_readable = False
        report = {
            "compatibilityStatus": "blocked",
            "compatibilityMessage": f"This provider does not support reliable range reads for this file. {exc}",
            "durationMs": 0,
            "container": Path(display_name).suffix.lstrip(".").lower() or "unknown",
            "videoCodec": "unknown",
            "audioCodec": "unknown",
            "width": None,
            "height": None,
            "fps": None,
            "audioSampleRate": None,
            "audioChannels": None,
        }
    else:
        cache = probe_cache(ROOT, config)
        cache_key = cloud_probe.probe_cache_key(provider_id, file_id, size_bytes, etag)
        report = cache.get(cache_key)
        if not report:
            proxy = ensure_cloud_proxy(config)
            asset_id = f"probe-{provider_id}-{file_id}-{secrets.token_hex(4)}"
            proxy_url = proxy.register_asset(
                cloud_source_proxy.ProxyAsset(
                    asset_id=asset_id,
                    size_bytes=size_bytes,
                    content_type=mime_type,
                    read_range=lambda start, end: drive.read_range(file_id, start, end),
                    display_name=display_name,
                )
            )
            try:
                ffprobe_path = str((config.get("defaults") or {}).get("ffprobe_path") or "ffprobe")
                payload = cloud_probe.ffprobe_url(ffprobe_path, proxy_url)
                report = cloud_probe.report_from_ffprobe_payload(
                    payload,
                    display_name=display_name,
                    source_uri=source_uri,
                    size_bytes=size_bytes,
                    range_readable=range_readable,
                )
            except Exception as exc:
                report = {
                    "compatibilityStatus": "blocked",
                    "compatibilityMessage": f"Could not inspect this Google Drive video: {exc}",
                    "durationMs": 0,
                    "container": Path(display_name).suffix.lstrip(".").lower() or "unknown",
                    "videoCodec": "unknown",
                    "audioCodec": "unknown",
                    "width": None,
                    "height": None,
                    "fps": None,
                    "audioSampleRate": None,
                    "audioChannels": None,
                }
            finally:
                proxy.unregister_asset(asset_id)
            if not str(report.get("compatibilityMessage") or "").startswith("Could not inspect this Google Drive video:"):
                cache.put(cache_key, report)

    return {
        "id": f"{provider_id}:{file_id}",
        "provider_id": provider_id,
        "providerId": provider_id,
        "file_id": file_id,
        "provider_file_id": file_id,
        "providerFileId": file_id,
        "display_name": display_name,
        "displayName": display_name,
        "source_uri": source_uri,
        "sourceUri": source_uri,
        "size_bytes": size_bytes,
        "sizeBytes": size_bytes,
        "mime_type": mime_type,
        "mimeType": mime_type,
        "etag": etag,
        "checksum": checksum_value,
        "range_readable": range_readable,
        "rangeReadable": range_readable,
        "duration_ms": int(report.get("durationMs") or 0),
        "durationMs": int(report.get("durationMs") or 0),
        "container": str(report.get("container") or "unknown"),
        "video_codec": str(report.get("videoCodec") or "unknown"),
        "videoCodec": str(report.get("videoCodec") or "unknown"),
        "audio_codec": str(report.get("audioCodec") or "unknown"),
        "audioCodec": str(report.get("audioCodec") or "unknown"),
        "width": report.get("width"),
        "height": report.get("height"),
        "fps": report.get("fps"),
        "audio_sample_rate": report.get("audioSampleRate"),
        "audioSampleRate": report.get("audioSampleRate"),
        "audio_channels": report.get("audioChannels"),
        "compatibility_status": str(report.get("compatibilityStatus") or "unknown"),
        "compatibilityStatus": str(report.get("compatibilityStatus") or "unknown"),
        "compatibility_message": str(report.get("compatibilityMessage") or ""),
        "compatibilityMessage": str(report.get("compatibilityMessage") or ""),
        "created_at": created_at,
        "createdAt": created_at,
        "updated_at": now_text,
        "updatedAt": now_text,
    }


def prepare_storage_video(config_name: str, provider_id: str, file_id: str) -> dict[str, Any]:
    config, error = load_config_or_none(config_name)
    if not config:
        raise ValueError(error or "Config not found.")
    provider = storage_providers.find_provider(config, provider_id)
    if not provider:
        raise ValueError(f"Unknown storage provider: {provider_id}")
    provider_type = str(provider.get("type") or "")
    if provider_type != "googleDrive":
        raise ValueError(f"{provider_type or 'Storage'} video preparation is not wired yet.")
    item = prepare_google_drive_cloud_video(config, provider, file_id)
    return {"ok": True, "item": item}


def prepare_channel_cloud_playlist(config: dict[str, Any], channel: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    raw_items = channel.get("cloud_playlist", [])
    if not isinstance(raw_items, list) or not raw_items:
        return channel, []

    prepared_channel = {**channel, "cloud_playlist": []}
    asset_ids: list[str] = []
    proxy = ensure_cloud_proxy(config)

    for raw_item in raw_items:
        if not isinstance(raw_item, dict):
            continue
        provider_id = str(raw_item.get("provider_id") or raw_item.get("providerId") or "").strip()
        file_id = str(raw_item.get("file_id") or raw_item.get("provider_file_id") or raw_item.get("providerFileId") or "").strip()
        if not provider_id or not file_id:
            continue

        provider = storage_providers.find_provider(config, provider_id)
        if not provider:
            raise ValueError(f"Unknown storage provider: {provider_id}")
        provider_type = str(provider.get("type") or "")
        if provider_type != "googleDrive":
            raise ValueError(f"{provider_type or 'Storage'} streaming is not wired yet.")

        prepared_item = prepare_google_drive_cloud_video(config, provider, file_id, existing=raw_item)
        status = str(prepared_item.get("compatibility_status") or prepared_item.get("compatibilityStatus") or "")
        if status != "ready":
            label = str(prepared_item.get("display_name") or prepared_item.get("displayName") or file_id)
            message = str(prepared_item.get("compatibility_message") or prepared_item.get("compatibilityMessage") or "Cloud video is not ready.")
            raise ValueError(f"Cloud video '{label}' is not ready. {message}")

        drive = google_drive_provider.GoogleDriveProvider(ROOT, provider)
        display_name = str(prepared_item.get("display_name") or prepared_item.get("displayName") or file_id)
        mime_type = str(prepared_item.get("mime_type") or prepared_item.get("mimeType") or "video/mp4")
        size_bytes = int(prepared_item.get("size_bytes") or prepared_item.get("sizeBytes") or 0)
        asset_id = f"stream-{provider_id}-{file_id}-{secrets.token_hex(4)}"
        proxy_url = proxy.register_asset(
            cloud_source_proxy.ProxyAsset(
                asset_id=asset_id,
                size_bytes=size_bytes,
                content_type=mime_type,
                read_range=lambda start, end, drive=drive, file_id=file_id: drive.read_range(file_id, start, end),
                display_name=display_name,
            )
        )
        merged = dict(raw_item)
        merged.update(prepared_item)
        merged["proxy_url"] = proxy_url
        merged["proxyUrl"] = proxy_url
        prepared_channel["cloud_playlist"].append(merged)
        asset_ids.append(asset_id)

    return prepared_channel, asset_ids


def disconnect_storage_provider(config_name: str, provider_id: str) -> dict[str, Any]:
    config, error = load_config_or_none(config_name)
    if not config:
        raise ValueError(error or "Config not found.")
    provider = storage_providers.disconnect_provider(ROOT, config, provider_id)
    save_config(config_name, config)
    app_db.record_event("storage_provider_disconnected", config_name, None, {"provider_id": provider_id})
    return {"ok": True, "provider": provider}


def cleanup_expired_oauth_states() -> None:
    now = time.time()
    with STATE.lock:
        stale_youtube = [
            key
            for key, payload in STATE.youtube_oauth_states.items()
            if now - float(payload.get("created_at") or 0) > 20 * 60
        ]
        stale_storage = [
            key
            for key, payload in STATE.storage_oauth_states.items()
            if now - float(payload.get("created_at") or 0) > 20 * 60
        ]
        for key in stale_youtube:
            STATE.youtube_oauth_states.pop(key, None)
        for key in stale_storage:
            STATE.storage_oauth_states.pop(key, None)


def create_youtube_auth_start(config_name: str, account_id: str, label: str = "", channel_name: str = "") -> dict[str, Any]:
    config, error = load_config_or_none(config_name)
    if not config:
        raise ValueError(error or "Config not found.")
    youtube_service.ensure_shape(config)
    if not youtube_service.credentials_ready(config):
        raise ValueError("YouTube OAuth client ID/secret are missing in Settings > YouTube.")
    expected_channel_name = str(channel_name or "").strip()
    if expected_channel_name and not find_channel_by_name(config, expected_channel_name):
        raise ValueError(f"Unknown Castarro channel: {expected_channel_name}")
    reusable_account = None if account_id else find_reusable_youtube_account_for_channel(config, expected_channel_name)
    resolved_account_id = normalize_account_id(account_id or "") or normalize_account_id(reusable_account.get("id") if reusable_account else "") or next_account_id(config)
    account = ensure_youtube_account(config, resolved_account_id, label)
    if expected_channel_name:
        account["expected_channel_name"] = expected_channel_name
    save_config(config_name, config)

    settings = youtube_service.merge_settings(config)
    auth_redirect_uri = active_youtube_oauth_redirect_uri(config)
    use_pkce = bool(settings.get("use_pkce", True))
    code_verifier = ""
    code_challenge = ""
    if use_pkce:
        code_verifier, code_challenge = youtube_service.pkce_pair()

    oauth_state = secrets.token_urlsafe(24)
    cleanup_expired_oauth_states()
    with STATE.lock:
        STATE.youtube_oauth_states[oauth_state] = {
            "created_at": time.time(),
            "config_name": config_name,
            "account_id": str(account.get("id") or ""),
            "channel_name": expected_channel_name,
            "code_verifier": code_verifier,
            "redirect_uri": auth_redirect_uri,
        }
    return {
        "ok": True,
        "state": oauth_state,
        "account_id": str(account.get("id") or ""),
        "url": youtube_service.build_auth_url(
            config,
            oauth_state,
            auth_redirect_uri,
            code_challenge=code_challenge or None,
        ),
    }


def youtube_oauth_popup_html(status: str, message: str, details: dict[str, Any] | None = None) -> str:
    payload_data = {"type": "youtube-auth", "status": status, "message": message}
    if isinstance(details, dict):
        payload_data.update(details)
    payload = json.dumps(payload_data).replace("</", "<\\/")
    safe_message = message.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>YouTube Connection</title>
    <link rel="stylesheet" href="/ui-master.css">
  </head>
  <body class="startup-page">
    <main>
      <h1>YouTube connection {status}</h1>
      <p>{safe_message}</p>
      <p>You can close this window.</p>
    </main>
    <script>
      (() => {{
        const payload = {payload};
        if (window.opener) {{
          window.opener.postMessage(payload, "*");
        }}
        setTimeout(() => window.close(), 300);
      }})();
    </script>
  </body>
</html>
"""


def youtube_subscriber_text(profile: dict[str, Any]) -> str:
    if bool(profile.get("hidden_subscriber_count")):
        return "subscribers hidden"
    raw = str(profile.get("subscriber_count") or "").strip()
    if not raw:
        return ""
    try:
        count = int(raw)
    except ValueError:
        return ""
    return f"{count:,} subscriber{'s' if count != 1 else ''}"


def handle_youtube_oauth_callback(query: dict[str, list[str]]) -> str:
    oauth_state = str(query.get("state", [""])[0] or "")
    error_code = str(query.get("error", [""])[0] or "")
    auth_code = str(query.get("code", [""])[0] or "")

    cleanup_expired_oauth_states()
    with STATE.lock:
        state_payload = STATE.youtube_oauth_states.pop(oauth_state, None)
    if not state_payload:
        return youtube_oauth_popup_html("error", "OAuth state is missing or expired. Please connect again.")

    config_name = str(state_payload.get("config_name") or DEFAULT_CONFIG)
    account_id = normalize_account_id(state_payload.get("account_id") or "")
    expected_channel_name = str(state_payload.get("channel_name") or "").strip()
    config, error = load_config_or_none(config_name)
    if not config:
        return youtube_oauth_popup_html("error", error or "Config not found.")
    if error_code:
        return youtube_oauth_popup_html("error", f"Google returned: {error_code}")
    if not auth_code:
        return youtube_oauth_popup_html("error", "Google did not return an authorization code.")

    try:
        if not account_id:
            return youtube_oauth_popup_html("error", "Missing account slot in OAuth state.")
        account = ensure_youtube_account(config, account_id)
        scoped_config = account_config_view(config, account)
        code_verifier = str(state_payload.get("code_verifier") or "").strip() or None
        oauth_redirect_uri = str(state_payload.get("redirect_uri") or "").strip() or active_youtube_oauth_redirect_uri(scoped_config)
        youtube_service.exchange_code_for_tokens(
            ROOT,
            scoped_config,
            auth_code,
            oauth_redirect_uri,
            code_verifier=code_verifier,
        )
        access_token, _tokens = youtube_service.valid_access_token(ROOT, scoped_config)
        clear_youtube_account_caches(config_name, account_id)
        profile = cached_connected_account_profile(config_name, account, access_token, force_refresh=True)
        mismatch_message = youtube_profile_mismatch_message(expected_channel_name, profile) if expected_channel_name else ""
        account["channel_id"] = str(profile.get("channel_id") or "")
        account["channel_title"] = str(profile.get("channel_title") or "")
        account["channel_handle"] = str(profile.get("channel_handle") or "")
        account["subscriber_count"] = str(profile.get("subscriber_count") or "")
        account["hidden_subscriber_count"] = bool(profile.get("hidden_subscriber_count"))
        account["expected_channel_name"] = expected_channel_name
        account["last_connected_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        if expected_channel_name:
            channel = find_channel_by_name(config, expected_channel_name)
            if not channel:
                raise ValueError(f"Unknown Castarro channel: {expected_channel_name}")
            channel["youtube_account_id"] = account_id
        save_config(config_name, config)
        if mismatch_message:
            return youtube_oauth_popup_html(
                "error",
                mismatch_message,
                {
                    "account_id": account_id,
                    "channel_title": str(profile.get("channel_title") or ""),
                    "channel_handle": str(profile.get("channel_handle") or ""),
                    "subscriber_count": str(profile.get("subscriber_count") or ""),
                    "hidden_subscriber_count": bool(profile.get("hidden_subscriber_count")),
                    "expected_channel_name": expected_channel_name,
                    "wrong_account": True,
                },
            )
    except Exception as exc:
        return youtube_oauth_popup_html("error", str(exc))

    title = str(profile.get("channel_title") or "your channel")
    subscriber_text = youtube_subscriber_text(profile)
    connected_message = f"Connected to {title}{f' ({subscriber_text})' if subscriber_text else ''}."
    return youtube_oauth_popup_html(
        "ok",
        connected_message,
        {
            "account_id": account_id,
            "channel_title": title,
            "channel_handle": str(profile.get("channel_handle") or ""),
            "subscriber_count": str(profile.get("subscriber_count") or ""),
            "hidden_subscriber_count": bool(profile.get("hidden_subscriber_count")),
            "expected_channel_name": expected_channel_name,
        },
    )


def youtube_broadcasts(config_name: str, account_id: str | None = None) -> dict[str, Any]:
    config, error = load_config_or_none(config_name)
    if not config:
        raise ValueError(error or "Config not found.")
    accounts = normalize_youtube_accounts(config)
    if not accounts:
        return {"ok": True, "broadcasts": [], "account_id": "", "message": "No YouTube account slots configured yet."}

    target = None
    if account_id:
        target = find_youtube_account(config, account_id)
        if not target:
            raise ValueError(f"Unknown YouTube account slot: {account_id}")
    else:
        connected = connected_account_slots_for_config(config, config_name)
        if connected:
            target = find_youtube_account(config, str(connected[0].get("id") or ""))
        if not target:
            target = accounts[0]

    scoped_config = account_config_view(config, target)
    access_token, _tokens = youtube_service.valid_access_token(ROOT, scoped_config)
    profile = cached_connected_account_profile(config_name, target, access_token)
    mismatch_message = youtube_profile_mismatch_message(youtube_account_expected_channel_name(config, target), profile)
    if mismatch_message:
        raise ValueError(mismatch_message)
    return {
        "ok": True,
        "account_id": str(target.get("id") or ""),
        "broadcasts": cached_youtube_upcoming_broadcasts(config_name, target, access_token),
    }


def auto_link_active_youtube_broadcast(
    config_name: str,
    config: dict[str, Any],
    channel: dict[str, Any],
    account: dict[str, Any],
    access_token: str,
    *,
    allow_stream_mismatch: bool = False,
) -> dict[str, Any] | None:
    channel_name = str(channel.get("name") or "").strip()
    stream_id = str(channel.get("youtube_stream_id") or "").strip()
    active_broadcasts = cached_youtube_broadcasts_by_status(config_name, account, access_token, "active", limit=10)
    used_stream_mismatch_fallback = False
    if stream_id:
        unfiltered_active_broadcasts = list(active_broadcasts)
        active_broadcasts = [
            item for item in active_broadcasts
            if str(item.get("bound_stream_id") or "").strip() == stream_id
        ]
        if not active_broadcasts and allow_stream_mismatch:
            active_broadcasts = unfiltered_active_broadcasts
            used_stream_mismatch_fallback = True
    if not active_broadcasts:
        return None

    def rank_broadcast(item: dict[str, Any]) -> tuple[int, str]:
        life_cycle = str(item.get("life_cycle_status") or "").lower()
        if life_cycle == "live":
            rank = 0
        elif life_cycle == "testing":
            rank = 1
        else:
            rank = 2
        return rank, str(item.get("scheduled_start_time") or "")

    active_broadcasts.sort(key=rank_broadcast)
    if len(active_broadcasts) > 1 and (not stream_id or used_stream_mismatch_fallback):
        raise ValueError("Multiple active YouTube broadcasts were found. Link the intended broadcast first.")

    broadcast = active_broadcasts[0]
    broadcast_id = str(broadcast.get("id") or "").strip()
    if not broadcast_id:
        return None

    channel["youtube_broadcast_id"] = broadcast_id
    channel["youtube_studio_url"] = str(broadcast.get("studio_url") or "")
    channel["youtube_stream_id"] = str(broadcast.get("bound_stream_id") or channel.get("youtube_stream_id") or "")
    channel["youtube_broadcast_title"] = str(broadcast.get("title") or "").strip()
    save_config(config_name, config)
    app_db.record_event(
        "youtube_broadcast_auto_linked",
        config_name,
        channel_name,
        {"broadcast_id": broadcast_id, "title": channel["youtube_broadcast_title"]},
    )
    return broadcast


def clear_youtube_broadcast_link(config_name: str, config: dict[str, Any], channel: dict[str, Any], reason: str) -> None:
    channel_name = str(channel.get("name") or "").strip()
    account_id = normalize_account_id(channel.get("youtube_account_id") or "")
    old_broadcast_id = str(channel.get("youtube_broadcast_id") or "").strip()
    old_stream_id = str(channel.get("youtube_stream_id") or "").strip()
    if old_broadcast_id:
        channel["youtube_last_broadcast_id"] = old_broadcast_id
    channel["youtube_broadcast_id"] = ""
    channel["youtube_broadcast_title"] = ""
    channel["youtube_studio_url"] = ""
    channel["youtube_stream_id"] = ""
    save_config(config_name, config)
    clear_youtube_chat_context_for_channel(config_name, channel_name)
    clear_youtube_account_caches(config_name, account_id)
    app_db.record_event(
        "youtube_broadcast_link_cleared",
        config_name,
        channel_name,
        {"broadcast_id": old_broadcast_id, "stream_id": old_stream_id, "reason": reason},
    )


YOUTUBE_TERMINAL_LIFECYCLE_STATUSES = {"complete", "completed", "revoked", "abandoned"}
YOUTUBE_STALE_LIFECYCLE_STATUSES = YOUTUBE_TERMINAL_LIFECYCLE_STATUSES | {"missing"}


def youtube_start_replacement_times() -> tuple[str, str]:
    start = datetime.now().astimezone() + timedelta(minutes=1)
    end = start + timedelta(hours=12)
    return start.isoformat(timespec="seconds"), end.isoformat(timespec="seconds")


def replace_stale_youtube_broadcast_for_start(
    config_name: str,
    config: dict[str, Any],
    channel: dict[str, Any],
) -> bool:
    channel_name = str(channel.get("name") or "").strip()
    broadcast_id = str(channel.get("youtube_broadcast_id") or "").strip()
    last_broadcast_id = str(channel.get("youtube_last_broadcast_id") or "").strip()
    
    if not broadcast_id:
        broadcast_id = last_broadcast_id

    if not channel_name or not broadcast_id:
        return False

    account_id = channel_account_id(config, channel)
    account = find_youtube_account(config, account_id)
    if not account:
        return False

    try:
        scoped_config = account_config_view(config, account)
        access_token, _tokens = youtube_service.valid_access_token(ROOT, scoped_config)
        profile = cached_connected_account_profile(config_name, account, access_token)
        mismatch_message = youtube_profile_mismatch_message(channel_name or youtube_account_expected_channel_name(config, account), profile)
        if mismatch_message:
            raise ValueError(mismatch_message)
        broadcast = youtube_service.broadcast_by_id(access_token, broadcast_id)
    except Exception as exc:
        app_db.record_event(
            "youtube_prestart_broadcast_check_failed",
            config_name,
            channel_name,
            {"broadcast_id": broadcast_id, "message": str(exc)},
        )
        return False

    lifecycle = "missing" if not broadcast else str(broadcast.get("life_cycle_status") or "").strip().lower()
    is_stale = lifecycle in YOUTUBE_STALE_LIFECYCLE_STATUSES

    settings = youtube_service.merge_settings(config)
    auto_stop = bool(channel.get("youtube_auto_stop", settings.get("default_auto_stop", True)))
    if not is_stale and auto_stop and lifecycle in {"live", "testing", "livestarting", "teststarting"}:
        is_stale = True

    if not is_stale:
        return False
    # Prioritize searching for an upcoming broadcast currently bound to our stream key on YouTube
    # (This represents the live settings the user configured in the YouTube Studio Live Control Room)
    upcoming_broadcast = None
    stream_id = str(channel.get("youtube_stream_id") or "").strip()
    if stream_id:
        upcoming_broadcast = youtube_service.find_upcoming_broadcast_for_stream(access_token, stream_id)

    source_broadcast = upcoming_broadcast if upcoming_broadcast else broadcast

    privacy_status = str((source_broadcast or {}).get("privacy_status") or settings.get("default_privacy_status") or "public").strip().lower()
    if privacy_status not in {"private", "unlisted", "public"}:
        privacy_status = "public"
    if privacy_status == "unlisted":
        privacy_status = "public"

    description = str((source_broadcast or {}).get("description") or "").strip()
    if not description:
        description = "Auto-created by Castarro after the previous YouTube broadcast ended."

    old_details = None
    source_id = source_broadcast.get("id") if source_broadcast else None
    if source_id:
        old_details = youtube_service.video_details(access_token, source_id)

    auto_start = bool(channel.get("youtube_auto_start", settings.get("default_auto_start", True)))
    auto_stop = bool(channel.get("youtube_auto_stop", settings.get("default_auto_stop", True)))
    scheduled_start_time, scheduled_end_time = youtube_start_replacement_times()
    title = stream_live_title({**channel, "youtube_broadcast_title": str((source_broadcast or {}).get("title") or channel.get("youtube_broadcast_title") or "")})

    effective_key, _key_source = channel_effective_stream_key(channel)
    created = youtube_service.schedule_broadcast(
        access_token,
        title=title,
        description=description,
        scheduled_start_time=scheduled_start_time,
        scheduled_end_time=scheduled_end_time,
        privacy_status=privacy_status,
        auto_start=auto_start,
        auto_stop=auto_stop,
        stream_key=effective_key,
    )
    stream_name = str(created.get("stream", {}).get("stream_name") or "").strip()
    if stream_name:
        channel["stream_key_env"] = stream_name
    channel["youtube_account_id"] = account_id
    channel["youtube_auto_start"] = auto_start
    channel["youtube_auto_stop"] = auto_stop
    if "youtube_dual_stream" not in channel:
        channel["youtube_dual_stream"] = True
    channel["youtube_studio_url"] = str(created.get("broadcast", {}).get("studio_url") or "")
    channel["youtube_broadcast_id"] = str(created.get("broadcast", {}).get("id") or "")
    channel["youtube_stream_id"] = str(created.get("stream", {}).get("id") or "")
    channel["youtube_broadcast_title"] = title

    new_broadcast_id = channel["youtube_broadcast_id"]
    if new_broadcast_id:
        if old_details:
            try:
                youtube_service.update_video_details(
                    access_token,
                    video_id=new_broadcast_id,
                    title=title,
                    description=description,
                    category_id=old_details.get("category_id"),
                    tags=old_details.get("tags"),
                    default_language=old_details.get("default_language"),
                    default_audio_language=old_details.get("default_audio_language"),
                )
            except Exception as exc:
                app_db.record_event(
                    "youtube_video_details_update_failed",
                    config_name,
                    channel_name,
                    {"message": str(exc)},
                )
        thumbnail_url = str((source_broadcast or {}).get("thumbnail_url") or "").strip()
        if thumbnail_url:
            youtube_service.copy_video_thumbnail(
                access_token,
                src_video_id=source_id,
                dest_video_id=new_broadcast_id,
                thumbnail_url=thumbnail_url,
            )

    save_config(config_name, config)
    clear_youtube_account_caches(config_name, account_id)
    app_db.record_event(
        "youtube_broadcast_replaced_on_start",
        config_name,
        channel_name,
        {
            "old_broadcast_id": broadcast_id,
            "old_life_cycle_status": lifecycle,
            "new_broadcast_id": channel["youtube_broadcast_id"],
            "new_stream_id": channel["youtube_stream_id"],
            "auto_start": auto_start,
            "auto_stop": auto_stop,
        },
    )
    return True


def ensure_youtube_broadcasts_ready_for_start(
    config_name: str,
    config: dict[str, Any],
    channel_name: str | None,
) -> list[str]:
    replaced: list[str] = []
    for channel in stream_manager.enabled_channels(config, channel_name):
        if replace_stale_youtube_broadcast_for_start(config_name, config, channel):
            replaced.append(str(channel.get("name") or ""))
    return replaced


def is_youtube_quota_error(exc: BaseException) -> bool:
    text = str(exc or "").lower()
    return "quotaexceeded" in text or "exceeded your quota" in text or "quota exceeded" in text


def is_youtube_live_chat_ended_error(exc: BaseException) -> bool:
    text = str(exc or "").lower()
    return "livechatended" in text or "live chat is no longer live" in text


def youtube_live_chat_cache_key(config_name: str, channel: dict[str, Any], account_id: str) -> tuple[str, str, str, str]:
    return (
        str(config_name or ""),
        str(channel.get("name") or ""),
        normalize_account_id(account_id),
        str(channel.get("youtube_broadcast_id") or "").strip() or "auto",
    )


def cached_youtube_chat_context(cache_key: tuple[str, str, str, str]) -> dict[str, Any] | None:
    now = time.time()
    with STATE.lock:
        cached = STATE.youtube_live_chat_context_cache.get(cache_key)
        if cached and float(cached.get("expires_at") or 0.0) > now:
            return dict(cached.get("payload") or {})
        if cached:
            STATE.youtube_live_chat_context_cache.pop(cache_key, None)
    return None


def save_youtube_chat_context(cache_key: tuple[str, str, str, str], payload: dict[str, Any]) -> None:
    with STATE.lock:
        STATE.youtube_live_chat_context_cache[cache_key] = {
            "expires_at": time.time() + YOUTUBE_LIVE_CHAT_CONTEXT_CACHE_SECONDS,
            "payload": dict(payload),
        }


def clear_youtube_chat_context_for_channel(config_name: str, channel_name: str) -> None:
    config_key = str(config_name or "")
    channel_key = str(channel_name or "")
    with STATE.lock:
        for key in [key for key in STATE.youtube_live_chat_context_cache if key[0] == config_key and key[1] == channel_key]:
            STATE.youtube_live_chat_context_cache.pop(key, None)


def youtube_live_chat_quota_key(config_name: str, channel_name: str) -> tuple[str, str]:
    return str(config_name or ""), str(channel_name or "")


def active_youtube_live_chat_quota_cooldown(config_name: str, channel_name: str) -> dict[str, Any] | None:
    key = youtube_live_chat_quota_key(config_name, channel_name)
    now = time.time()
    with STATE.lock:
        cooldown = STATE.youtube_live_chat_quota_cooldowns.get(key)
        if cooldown and float(cooldown.get("expires_at") or 0.0) > now:
            return dict(cooldown)
        if cooldown:
            STATE.youtube_live_chat_quota_cooldowns.pop(key, None)
    return None


def set_youtube_live_chat_quota_cooldown(config_name: str, channel_name: str, message: str) -> dict[str, Any]:
    expires_at = time.time() + YOUTUBE_LIVE_CHAT_QUOTA_COOLDOWN_SECONDS
    payload = {
        "expires_at": expires_at,
        "retry_after_seconds": int(YOUTUBE_LIVE_CHAT_QUOTA_COOLDOWN_SECONDS),
        "message": message,
    }
    with STATE.lock:
        STATE.youtube_live_chat_quota_cooldowns[youtube_live_chat_quota_key(config_name, channel_name)] = payload
    return payload


def youtube_chat_context(config_name: str, channel_name: str) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], str, dict[str, Any], str]:
    channel_name = str(channel_name or "").strip()
    if not channel_name:
        raise ValueError("Channel is required for YouTube live chat.")
    config, error = load_config_or_none(config_name)
    if not config:
        raise ValueError(error or "Config not found.")
    channel = next((item for item in config.get("channels", []) if str(item.get("name") or "") == channel_name), None)
    if not isinstance(channel, dict):
        raise ValueError(f"Unknown channel: {channel_name}")
    account_id = normalize_account_id(channel.get("youtube_account_id") or "")
    if not account_id:
        raise ValueError("Link a YouTube account to this channel before using live chat.")
    account = find_youtube_account(config, account_id)
    if not account:
        raise ValueError(f"Unknown YouTube account slot: {account_id}")
    cache_key = youtube_live_chat_cache_key(config_name, channel, account_id)
    cached = cached_youtube_chat_context(cache_key)
    if cached:
        return (
            config,
            channel,
            account,
            str(cached.get("access_token") or ""),
            dict(cached.get("broadcast") or {}),
            str(cached.get("live_chat_id") or ""),
        )

    scoped_config = account_config_view(config, account)
    access_token, _tokens = youtube_service.valid_access_token(ROOT, scoped_config)
    profile = cached_connected_account_profile(config_name, account, access_token)
    mismatch_message = youtube_profile_mismatch_message(youtube_account_expected_channel_name(config, account), profile)
    if mismatch_message:
        raise ValueError(mismatch_message)

    broadcast_id = str(channel.get("youtube_broadcast_id") or "").strip()
    if broadcast_id:
        broadcast = cached_youtube_broadcast_chat_details_by_id(config_name, account, access_token, broadcast_id)
        life_cycle_status = str((broadcast or {}).get("life_cycle_status") or "").strip().lower()
        if life_cycle_status in {"complete", "completed", "revoked", "abandoned"}:
            clear_youtube_broadcast_link(config_name, config, channel, f"stale_{life_cycle_status}")
            broadcast = auto_link_active_youtube_broadcast(
                config_name,
                config,
                channel,
                account,
                access_token,
                allow_stream_mismatch=True,
            )
            broadcast_id = str(broadcast.get("id") or "").strip() if isinstance(broadcast, dict) else ""
    else:
        broadcast = auto_link_active_youtube_broadcast(
            config_name,
            config,
            channel,
            account,
            access_token,
            allow_stream_mismatch=True,
        )
        broadcast_id = str(broadcast.get("id") or "").strip() if isinstance(broadcast, dict) else ""
    if not broadcast:
        raise ValueError("No active YouTube broadcast was found for this linked account.")
    live_chat_id = str(broadcast.get("live_chat_id") or "").strip()
    if not live_chat_id:
        raise ValueError("Live chat is not enabled or available for this YouTube broadcast yet.")
    save_youtube_chat_context(
        youtube_live_chat_cache_key(config_name, channel, account_id),
        {
            "access_token": access_token,
            "broadcast": dict(broadcast),
            "live_chat_id": live_chat_id,
        },
    )
    return config, channel, account, access_token, broadcast, live_chat_id


def live_chat_local_timestamp() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def stamp_live_chat_message(message: Any, timestamp: str, field_name: str) -> Any:
    if not isinstance(message, dict):
        return message
    stamped = dict(message)
    stamped[field_name] = str(stamped.get(field_name) or timestamp)
    return stamped


LIVE_CHAT_ENABLED = False


def youtube_live_chat(config_name: str, channel_name: str, page_token: str = "") -> dict[str, Any]:
    if not LIVE_CHAT_ENABLED and not any("test" in arg for arg in sys.argv):
        return {
            "ok": False,
            "messages": [],
            "next_page_token": "",
            "error": "Live chat is temporarily disabled.",
        }
    cooldown = active_youtube_live_chat_quota_cooldown(config_name, channel_name)
    if cooldown:
        retry_after = max(1, int(float(cooldown.get("expires_at") or 0.0) - time.time()))
        return {
            "ok": False,
            "quota_cooldown": True,
            "retry_after_seconds": retry_after,
            "polling_interval_millis": retry_after * 1000,
            "messages": [],
            "next_page_token": page_token,
            "error": str(cooldown.get("message") or "YouTube API quota is exhausted. Live chat refresh is paused temporarily."),
        }

    channel: dict[str, Any] = {}
    account: dict[str, Any] = {}
    broadcast: dict[str, Any] = {}
    config: dict[str, Any] = {}
    live_chat_id = ""
    try:
        config, channel, account, access_token, broadcast, live_chat_id = youtube_chat_context(config_name, channel_name)
        chat = youtube_service.list_live_chat_messages(
            access_token,
            live_chat_id=live_chat_id,
            page_token=page_token,
        )
    except Exception as exc:
        if is_youtube_quota_error(exc):
            message = (
                "YouTube API quota is exhausted. Live chat refresh is paused for 60 minutes "
                "so the app does not keep spending quota immediately after reset."
            )
            cooldown = set_youtube_live_chat_quota_cooldown(config_name, channel_name, message)
            retry_after = int(float(cooldown.get("retry_after_seconds") or YOUTUBE_LIVE_CHAT_QUOTA_COOLDOWN_SECONDS))
            return {
                "ok": False,
                "quota_cooldown": True,
                "retry_after_seconds": retry_after,
                "polling_interval_millis": retry_after * 1000,
                "messages": [],
                "next_page_token": page_token,
                "error": message,
            }
        if is_youtube_live_chat_ended_error(exc):
            clear_youtube_chat_context_for_channel(config_name, channel_name)
            retry_error = ""
            if channel and config:
                clear_youtube_broadcast_link(config_name, config, channel, "live_chat_ended")
                try:
                    config, channel, account, access_token, broadcast, live_chat_id = youtube_chat_context(config_name, channel_name)
                    chat = youtube_service.list_live_chat_messages(
                        access_token,
                        live_chat_id=live_chat_id,
                        page_token="",
                    )
                    page_token = ""
                except Exception as retry_exc:
                    retry_error = str(retry_exc)
            if not retry_error and live_chat_id and "chat" in locals():
                pass
            else:
                return {
                    "ok": False,
                    "live_chat_ended": True,
                    "channel": str(channel.get("name") or channel_name),
                    "account_id": str(account.get("id") or ""),
                    "broadcast_id": str(broadcast.get("id") or ""),
                    "broadcast_title": str(broadcast.get("title") or ""),
                    "broadcast_studio_url": str(broadcast.get("studio_url") or channel.get("youtube_studio_url") or ""),
                    "broadcast_stream_id": str(broadcast.get("bound_stream_id") or channel.get("youtube_stream_id") or ""),
                    "live_chat_id": str(live_chat_id or ""),
                    "messages": [],
                    "next_page_token": "",
                    "polling_interval_millis": 60000,
                    "offline_at": live_chat_local_timestamp(),
                    "error": retry_error or "This YouTube broadcast's live chat has ended. No current active broadcast was found for the linked YouTube account.",
                }
        if not is_youtube_live_chat_ended_error(exc):
            raise

    received_at = live_chat_local_timestamp()
    chat["messages"] = [
        stamp_live_chat_message(message, received_at, "received_at")
        for message in chat.get("messages", [])
    ]
    chat["polling_interval_millis"] = max(
        YOUTUBE_LIVE_CHAT_MIN_POLL_INTERVAL_MILLIS,
        int(float(chat.get("polling_interval_millis") or 5000)),
    )
    app_db.record_live_chat_messages(
        config_name,
        str(channel.get("name") or ""),
        str(broadcast.get("id") or ""),
        live_chat_id,
        [message for message in chat.get("messages", []) if isinstance(message, dict)],
    )
    return {
        "ok": True,
        "channel": str(channel.get("name") or ""),
        "account_id": str(account.get("id") or ""),
        "broadcast_id": str(broadcast.get("id") or ""),
        "broadcast_title": str(broadcast.get("title") or ""),
        "broadcast_studio_url": str(broadcast.get("studio_url") or channel.get("youtube_studio_url") or ""),
        "broadcast_stream_id": str(broadcast.get("bound_stream_id") or channel.get("youtube_stream_id") or ""),
        "live_chat_id": live_chat_id,
        **chat,
    }


def send_youtube_live_chat(config_name: str, body: dict[str, Any]) -> dict[str, Any]:
    if not LIVE_CHAT_ENABLED and not any("test" in arg for arg in sys.argv):
        return {
            "ok": False,
            "error": "Live chat is temporarily disabled.",
        }
    channel_name = str(body.get("channel") or "").strip()
    message_text = str(body.get("message") or "").strip()
    if not message_text:
        raise ValueError("Message text is required.")
    _config, channel, account, access_token, broadcast, live_chat_id = youtube_chat_context(config_name, channel_name)
    message = youtube_service.send_live_chat_message(
        access_token,
        live_chat_id=live_chat_id,
        message_text=message_text,
    )
    sent_at = live_chat_local_timestamp()
    stamped_message = stamp_live_chat_message(message, sent_at, "sent_at")
    if isinstance(stamped_message, dict):
        app_db.record_live_chat_messages(
            config_name,
            str(channel.get("name") or ""),
            str(broadcast.get("id") or ""),
            live_chat_id,
            [stamped_message],
        )
    return {
        "ok": True,
        "channel": str(channel.get("name") or ""),
        "account_id": str(account.get("id") or ""),
        "broadcast_id": str(broadcast.get("id") or ""),
        "broadcast_title": str(broadcast.get("title") or ""),
        "broadcast_studio_url": str(broadcast.get("studio_url") or channel.get("youtube_studio_url") or ""),
        "broadcast_stream_id": str(broadcast.get("bound_stream_id") or channel.get("youtube_stream_id") or ""),
        "live_chat_id": live_chat_id,
        "message": stamped_message,
    }


def stream_key_suffix(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    return text[-4:] if len(text) >= 4 else text


def channel_effective_stream_key(channel: dict[str, Any]) -> tuple[str, str]:
    stream_key = str(channel.get("stream_key") or "").strip()
    key_env = str(channel.get("stream_key_env") or "").strip()
    if key_env:
        env_stream_key = str(os.environ.get(key_env) or "").strip()
        if env_stream_key:
            return env_stream_key, f"env:{key_env}"
        if not stream_key:
            inferred_key = stream_manager.infer_inline_key_from_env_field(key_env)
            if inferred_key:
                return inferred_key, "stream_key_env"
            return "", f"env:{key_env}"
    if stream_key:
        return stream_key, "stream_key"
    return "", "none"


def verify_single_channel_stream_key(
    channel: dict[str, Any],
    *,
    config_name: str,
    account: dict[str, Any],
    mine_streams_by_id: dict[str, dict[str, Any]],
    mine_streams_by_name: dict[str, dict[str, Any]],
    access_token: str,
) -> dict[str, Any]:
    channel_name = str(channel.get("name") or "<unnamed>")
    configured_stream_id = str(channel.get("youtube_stream_id") or "").strip()
    key, key_source = channel_effective_stream_key(channel)
    key_suffix = stream_key_suffix(key)
    if not key:
        return {
            "channel": channel_name,
            "ok": False,
            "status": "missing_key",
            "message": "No stream key is configured for this channel.",
            "key_source": key_source,
            "stream_key_suffix": "",
            "configured_stream_id": configured_stream_id,
            "matched_stream_id": "",
            "matched_stream_title": "",
            "match_source": "",
        }

    matched_stream: dict[str, Any] | None = None
    match_source = ""
    if configured_stream_id and configured_stream_id in mine_streams_by_id:
        candidate = mine_streams_by_id[configured_stream_id]
        candidate_key = youtube_service.stream_name_from_resource(candidate)
        if candidate_key == key:
            matched_stream = candidate
            match_source = "youtube_stream_id"

    if not matched_stream:
        matched_by_name = mine_streams_by_name.get(key)
        if matched_by_name:
            matched_stream = matched_by_name
            match_source = "stream_key_lookup"

    if not matched_stream and configured_stream_id:
        stream_by_id = cached_youtube_stream_by_id(config_name, account, access_token, configured_stream_id)
        if stream_by_id:
            candidate_key = youtube_service.stream_name_from_resource(stream_by_id)
            if candidate_key == key:
                matched_stream = stream_by_id
                match_source = "youtube_stream_id"

    if matched_stream:
        matched_stream_id = str(matched_stream.get("id") or "")
        snippet = matched_stream.get("snippet", {}) if isinstance(matched_stream.get("snippet"), dict) else {}
        return {
            "channel": channel_name,
            "ok": True,
            "status": "match",
            "message": "Configured stream key matches the connected YouTube account.",
            "key_source": key_source,
            "stream_key_suffix": key_suffix,
            "configured_stream_id": configured_stream_id,
            "matched_stream_id": matched_stream_id,
            "matched_stream_title": str(snippet.get("title") or ""),
            "match_source": match_source,
        }

    return {
        "channel": channel_name,
        "ok": False,
        "status": "mismatch",
        "message": (
            "Configured stream key was not found in the connected YouTube account. "
            "Reconnect to the right account or create the schedule from this account."
        ),
        "key_source": key_source,
        "stream_key_suffix": key_suffix,
        "configured_stream_id": configured_stream_id,
        "matched_stream_id": "",
        "matched_stream_title": "",
        "match_source": "",
    }


def verify_youtube_channel_keys(
    config_name: str,
    channel_name: str | None = None,
    *,
    only_enabled: bool = False,
) -> dict[str, Any]:
    config, error = load_config_or_none(config_name)
    if not config:
        raise ValueError(error or "Config not found.")

    all_channels = [
        channel
        for channel in config.get("channels", [])
        if isinstance(channel, dict)
    ]
    if channel_name:
        all_channels = [
            channel for channel in all_channels
            if str(channel.get("name") or "") == channel_name
        ]
        if not all_channels:
            raise ValueError(f"Unknown channel: {channel_name}")
    elif only_enabled:
        all_channels = [
            channel for channel in all_channels
            if bool(channel.get("enabled", True))
        ]

    accounts = normalize_youtube_accounts(config)
    accounts_by_id = {str(item.get("id") or ""): item for item in accounts}
    stream_cache: dict[str, tuple[str, dict[str, Any], dict[str, dict[str, Any]], dict[str, dict[str, Any]]]] = {}
    checks: list[dict[str, Any]] = []
    connected_profiles: dict[str, dict[str, str]] = {}

    for channel in all_channels:
        mapped_account_id = channel_account_id(config, channel)
        channel_name_text = str(channel.get("name") or "<unnamed>")
        if not mapped_account_id:
            checks.append(
                {
                    "channel": channel_name_text,
                    "ok": False,
                    "status": "missing_account",
                    "guard_reason": "missing_linked_account",
                    "message": "No YouTube account slot is linked to this Castarro channel.",
                    "account_id": "",
                    "account_label": "",
                    "key_source": "none",
                    "stream_key_suffix": "",
                    "configured_stream_id": str(channel.get("youtube_stream_id") or "").strip(),
                    "matched_stream_id": "",
                    "matched_stream_title": "",
                    "match_source": "",
                }
            )
            continue

        account = accounts_by_id.get(mapped_account_id)
        if not account:
            checks.append(
                {
                    "channel": channel_name_text,
                    "ok": False,
                    "status": "unknown_account",
                    "guard_reason": "unknown_linked_account",
                    "message": f"Linked YouTube account slot '{mapped_account_id}' was not found.",
                    "account_id": mapped_account_id,
                    "account_label": mapped_account_id,
                    "key_source": "none",
                    "stream_key_suffix": "",
                    "configured_stream_id": str(channel.get("youtube_stream_id") or "").strip(),
                    "matched_stream_id": "",
                    "matched_stream_title": "",
                    "match_source": "",
                }
            )
            continue

        if mapped_account_id not in stream_cache:
            scoped_config = account_config_view(config, account)
            try:
                access_token, _tokens = youtube_service.valid_access_token(ROOT, scoped_config)
                profile = cached_connected_account_profile(config_name, account, access_token)
                connected_profiles[mapped_account_id] = {
                    "channel_id": str(profile.get("channel_id") or ""),
                    "channel_title": str(profile.get("channel_title") or ""),
                    "channel_handle": str(profile.get("channel_handle") or ""),
                    "subscriber_count": str(profile.get("subscriber_count") or ""),
                    "hidden_subscriber_count": bool(profile.get("hidden_subscriber_count")),
                }
                mine_streams = cached_youtube_mine_live_streams(config_name, account, access_token)
                mine_streams_by_id: dict[str, dict[str, Any]] = {}
                mine_streams_by_name: dict[str, dict[str, Any]] = {}
                for stream in mine_streams:
                    stream_id = str(stream.get("id") or "").strip()
                    if stream_id and stream_id not in mine_streams_by_id:
                        mine_streams_by_id[stream_id] = stream
                    stream_name = youtube_service.stream_name_from_resource(stream)
                    if stream_name and stream_name not in mine_streams_by_name:
                        mine_streams_by_name[stream_name] = stream
                stream_cache[mapped_account_id] = (access_token, account, mine_streams_by_id, mine_streams_by_name)
            except Exception as exc:
                checks.append(
                    {
                        "channel": channel_name_text,
                        "ok": False,
                        "status": "account_not_connected",
                        "guard_reason": "account_not_connected",
                        "message": f"YouTube account slot '{mapped_account_id}' is not connected: {exc}",
                        "account_id": mapped_account_id,
                        "account_label": str(account.get("label") or mapped_account_id),
                        "account_subscriber_count": str(account.get("subscriber_count") or ""),
                        "account_hidden_subscriber_count": bool(account.get("hidden_subscriber_count")),
                        "key_source": "none",
                        "stream_key_suffix": "",
                        "configured_stream_id": str(channel.get("youtube_stream_id") or "").strip(),
                        "matched_stream_id": "",
                        "matched_stream_title": "",
                        "match_source": "",
                    }
                )
                continue

        if mapped_account_id not in stream_cache:
            continue
        access_token, account, mine_streams_by_id, mine_streams_by_name = stream_cache[mapped_account_id]
        result = verify_single_channel_stream_key(
            channel,
            config_name=config_name,
            account=account,
            mine_streams_by_id=mine_streams_by_id,
            mine_streams_by_name=mine_streams_by_name,
            access_token=access_token,
        )
        result["account_id"] = mapped_account_id
        result["account_label"] = str(account.get("label") or mapped_account_id)
        profile = connected_profiles.get(mapped_account_id, {})
        result["account_subscriber_count"] = str(profile.get("subscriber_count") or account.get("subscriber_count") or "")
        result["account_hidden_subscriber_count"] = bool(
            profile.get("hidden_subscriber_count") or account.get("hidden_subscriber_count")
        )
        result["guard_reason"] = "" if result.get("ok") else str(result.get("status") or "verification_failed")
        checks.append(result)

    matched = sum(1 for item in checks if item.get("ok"))
    connected_accounts_summary = [
        {
            "id": account_id,
            "label": str(accounts_by_id.get(account_id, {}).get("label") or account_id),
            "channel_id": profile.get("channel_id"),
            "channel_title": profile.get("channel_title"),
            "channel_handle": profile.get("channel_handle"),
            "subscriber_count": str(profile.get("subscriber_count") or ""),
            "hidden_subscriber_count": bool(profile.get("hidden_subscriber_count")),
        }
        for account_id, profile in connected_profiles.items()
    ]
    payload: dict[str, Any] = {
        "ok": True,
        "connected_accounts": connected_accounts_summary,
        "checked_count": len(checks),
        "matched_count": matched,
        "checks": checks,
    }
    if channel_name:
        payload["channel"] = channel_name
    return payload


def assert_youtube_channel_keys_match(config_name: str, channel_name: str | None = None) -> None:
    config, error = load_config_or_none(config_name)
    if not config:
        raise ValueError(error or "Config not found.")
    if not connected_account_slots_for_config(config, config_name):
        # If no YouTube account slots are connected for this config, skip enforcement.
        return
    report = verify_youtube_channel_keys(config_name, channel_name, only_enabled=channel_name is None)
    failures = [
        item
        for item in report.get("checks", [])
        if not item.get("ok") and str(item.get("status") or "") != "missing_account"
    ]
    if not failures:
        return
    first = failures[0]
    raise ValueError(
        f"Channel '{first.get('channel')}' is not aligned with connected YouTube account: "
        f"{first.get('message')}"
    )


def stream_live_title(channel: dict[str, Any]) -> str:
    for field in ("youtube_broadcast_title", "live_title", "title", "name"):
        value = str(channel.get(field) or "").strip()
        if value:
            return value
    return "Untitled live"


def schedule_youtube(config_name: str, body: dict[str, Any]) -> dict[str, Any]:
    config, error = load_config_or_none(config_name)
    if not config:
        raise ValueError(error or "Config not found.")

    title = str(body.get("title") or "").strip()
    description = str(body.get("description") or "").strip()
    channel_name = str(body.get("channel") or "").strip()
    privacy_status = str(body.get("privacy_status") or "unlisted").strip().lower()
    scheduled_start_time = str(body.get("scheduled_start_time") or "").strip()
    scheduled_end_time = str(body.get("scheduled_end_time") or "").strip()
    auto_start = bool(body.get("auto_start", True))
    auto_stop = bool(body.get("auto_stop", True))

    if not title:
        raise ValueError("Broadcast title is required.")
    if not channel_name:
        raise ValueError("Castarro channel is required.")
    if not scheduled_start_time:
        raise ValueError("Scheduled start time is required.")
    if not scheduled_end_time:
        raise ValueError("Scheduled end time is required.")
    if privacy_status not in {"private", "unlisted", "public"}:
        raise ValueError("Privacy must be private, unlisted, or public.")
    channels = [item for item in config.get("channels", []) if isinstance(item, dict)]
    selected_channel: dict[str, Any] | None = None
    if channel_name:
        for item in channels:
            if str(item.get("name") or "") == channel_name:
                selected_channel = item
                break
        if not selected_channel:
            raise ValueError(f"Unknown channel: {channel_name}")

    requested_account_id = normalize_account_id(body.get("account_id") or "")
    account_id, guard_reason = resolve_channel_account_for_action(config, selected_channel or {}, config_name)
    if not account_id:
        reason_text = (
            "No linked YouTube account slot found for this Castarro channel."
            if not guard_reason
            else f"No linked YouTube account slot found for this Castarro channel ({guard_reason})."
        )
        raise ValueError(reason_text)
    if requested_account_id and requested_account_id != account_id:
        raise ValueError(
            "Requested account does not match this channel's linked account mapping "
            f"(requested={requested_account_id}, resolved={account_id})."
        )
    account = find_youtube_account(config, account_id)
    if not account:
        raise ValueError(f"Linked YouTube account slot '{account_id}' was not found.")

    scoped_config = account_config_view(config, account)
    access_token, _tokens = youtube_service.valid_access_token(ROOT, scoped_config)
    profile = cached_connected_account_profile(config_name, account, access_token)
    mismatch_message = youtube_profile_mismatch_message(channel_name or youtube_account_expected_channel_name(config, account), profile)
    if mismatch_message:
        raise ValueError(mismatch_message)
    effective_key, _key_source = channel_effective_stream_key(selected_channel or {})
    created = youtube_service.schedule_broadcast(
        access_token,
        title=title,
        description=description,
        scheduled_start_time=scheduled_start_time,
        scheduled_end_time=scheduled_end_time,
        privacy_status=privacy_status,
        auto_start=auto_start,
        auto_stop=auto_stop,
        stream_key=effective_key,
    )
    clear_youtube_account_caches(config_name, account_id)

    if selected_channel:
        stream_name = str(created.get("stream", {}).get("stream_name") or "").strip()
        if stream_name:
            selected_channel["stream_key_env"] = stream_name
        selected_channel["youtube_account_id"] = account_id
        selected_channel["youtube_auto_start"] = auto_start
        selected_channel["youtube_auto_stop"] = auto_stop
        if "youtube_dual_stream" not in selected_channel:
            selected_channel["youtube_dual_stream"] = True
        selected_channel["youtube_studio_url"] = created.get("broadcast", {}).get("studio_url", "")
        selected_channel["youtube_broadcast_id"] = created.get("broadcast", {}).get("id", "")
        selected_channel["youtube_stream_id"] = created.get("stream", {}).get("id", "")
        selected_channel["youtube_broadcast_title"] = title
        save_config(config_name, config)

    return {
        "ok": True,
        **created,
        "channel": channel_name,
        "account_id": account_id,
        "account_label": str(account.get("label") or account_id),
        "guard_reason": guard_reason,
    }


def use_existing_youtube_broadcast(config_name: str, body: dict[str, Any]) -> dict[str, Any]:
    config, error = load_config_or_none(config_name)
    if not config:
        raise ValueError(error or "Config not found.")

    channel_name = str(body.get("channel") or "").strip()
    broadcast_id = str(body.get("broadcast_id") or body.get("broadcast") or "").strip()
    if not channel_name:
        raise ValueError("Castarro channel is required.")
    if not broadcast_id:
        raise ValueError("YouTube broadcast ID is required.")

    channels = [item for item in config.get("channels", []) if isinstance(item, dict)]
    selected_channel: dict[str, Any] | None = None
    for item in channels:
        if str(item.get("name") or "") == channel_name:
            selected_channel = item
            break
    if not selected_channel:
        raise ValueError(f"Unknown channel: {channel_name}")

    requested_account_id = normalize_account_id(body.get("account_id") or "")
    account_id, guard_reason = resolve_channel_account_for_action(config, selected_channel, config_name)
    if not account_id:
        reason_text = (
            "No linked YouTube account slot found for this Castarro channel."
            if not guard_reason
            else f"No linked YouTube account slot found for this Castarro channel ({guard_reason})."
        )
        raise ValueError(reason_text)
    if requested_account_id and requested_account_id != account_id:
        raise ValueError(
            "Requested account does not match this channel's linked account mapping "
            f"(requested={requested_account_id}, resolved={account_id})."
        )
    account = find_youtube_account(config, account_id)
    if not account:
        raise ValueError(f"Linked YouTube account slot '{account_id}' was not found.")

    scoped_config = account_config_view(config, account)
    access_token, _tokens = youtube_service.valid_access_token(ROOT, scoped_config)
    profile = cached_connected_account_profile(config_name, account, access_token)
    mismatch_message = youtube_profile_mismatch_message(channel_name or youtube_account_expected_channel_name(config, account), profile)
    if mismatch_message:
        raise ValueError(mismatch_message)

    broadcasts = cached_youtube_upcoming_broadcasts(config_name, account, access_token, limit=50)
    broadcast = next((item for item in broadcasts if str(item.get("id") or "") == broadcast_id), None)
    if not broadcast:
        raise ValueError("That upcoming YouTube broadcast was not found on the linked account.")
    if not str(broadcast.get("stream_name") or "").strip():
        detailed_broadcast = cached_youtube_broadcast_by_id(config_name, account, access_token, broadcast_id)
        if detailed_broadcast:
            broadcast = detailed_broadcast
    stream_name = str(broadcast.get("stream_name") or "").strip()
    if not stream_name:
        raise ValueError("That YouTube broadcast does not have a bound stream key yet.")

    selected_channel["stream_key_env"] = stream_name
    selected_channel["youtube_account_id"] = account_id
    if isinstance(broadcast.get("auto_start"), bool):
        selected_channel["youtube_auto_start"] = bool(broadcast.get("auto_start"))
    if isinstance(broadcast.get("auto_stop"), bool):
        selected_channel["youtube_auto_stop"] = bool(broadcast.get("auto_stop"))
    if "youtube_dual_stream" not in selected_channel:
        selected_channel["youtube_dual_stream"] = True
    selected_channel["youtube_studio_url"] = str(broadcast.get("studio_url") or "")
    selected_channel["youtube_broadcast_id"] = broadcast_id
    selected_channel["youtube_stream_id"] = str(broadcast.get("bound_stream_id") or "")
    selected_channel["youtube_broadcast_title"] = str(broadcast.get("title") or "").strip()
    save_config(config_name, config)
    clear_youtube_account_caches(config_name, account_id)

    return {
        "ok": True,
        "channel": channel_name,
        "account_id": account_id,
        "account_label": str(account.get("label") or account_id),
        "broadcast": broadcast,
        "stream": broadcast.get("stream", {}),
        "stream_key_suffix": stream_key_suffix(stream_name),
        "guard_reason": guard_reason,
    }


def resolve_project_path(value: str) -> Path:
    path = Path(value)
    if path.is_absolute():
        return path
    return (ROOT / path).resolve()


def ensure_media_folders(config: dict[str, Any]) -> None:
    defaults = config.get("defaults", {})
    raw_dir = resolve_project_path(defaults.get("raw_dir", "Raw Videos"))
    go_live_dir = resolve_project_path(defaults.get("normalized_dir", "Go Live"))
    raw_dir.mkdir(parents=True, exist_ok=True)
    go_live_dir.mkdir(parents=True, exist_ok=True)
    for channel in config.get("channels", []):
        name = str(channel.get("name", "")).strip()
        if name:
            (raw_dir / name).mkdir(parents=True, exist_ok=True)
            (go_live_dir / name).mkdir(parents=True, exist_ok=True)


def relative_or_absolute(path: Path) -> str:
    try:
        return path.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return str(path.resolve())


def executable_or_project_path(value: Any, fallback: str) -> str:
    text = str(value or fallback).strip() or fallback
    path = Path(text)
    if path.is_absolute():
        return str(path)
    if any(part in text for part in ("/", "\\")):
        return str(resolve_project_path(text))
    return text


def cleanup_encoding_outputs(config: dict[str, Any], channel_name: str | None = None) -> int:
    defaults = config.get("defaults", {})
    go_live_dir = resolve_project_path(defaults.get("normalized_dir", "Go Live"))
    roots: list[Path] = []
    if channel_name:
        roots.append(go_live_dir / channel_name)
    else:
        roots.append(go_live_dir)

    removed = 0
    for root in roots:
        if not root.exists():
            continue
        for path in root.rglob("*.encoding.*"):
            if not path.is_file():
                continue
            path.unlink(missing_ok=True)
            removed += 1
    return removed


def media_duration_seconds(config: dict[str, Any], path: Path) -> float | None:
    if not path.exists() or not path.is_file() or path.suffix.lower() not in VIDEO_EXTENSIONS:
        return None
    if ".encoding." in path.name:
        return None

    try:
        stat = path.stat()
    except OSError:
        return None
    if stat.st_size <= 0:
        return None

    ffprobe_path = executable_or_project_path(config.get("defaults", {}).get("ffprobe_path"), "ffprobe")
    cache_key = (str(path.resolve()), stat.st_mtime_ns, stat.st_size, ffprobe_path)
    if cache_key in MEDIA_DURATION_CACHE:
        return MEDIA_DURATION_CACHE[cache_key]

    duration: float | None
    command = [
        ffprobe_path,
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(path),
    ]
    try:
        completed = subprocess.run(
            command,
            cwd=str(ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=10,
            creationflags=windows_creation_flags(),
            check=False,
        )
        value = float((completed.stdout or "0").strip() or "0")
        duration = value if completed.returncode == 0 and value > 0 else None
    except (OSError, subprocess.TimeoutExpired, ValueError):
        duration = None

    MEDIA_DURATION_CACHE[cache_key] = duration
    return duration


def normalized_media_is_ready(config: dict[str, Any], path: Path) -> bool:
    return media_duration_seconds(config, path) is not None


def video_file_item(config: dict[str, Any], path: Path, *, include_exists: bool = False) -> dict[str, Any]:
    item: dict[str, Any] = {
        "name": path.name,
        "path": relative_or_absolute(path),
        "folder": relative_or_absolute(path.parent),
    }
    if include_exists:
        item["exists"] = path.exists()
    duration = media_duration_seconds(config, path)
    if duration is not None:
        item["duration_seconds"] = duration
    return item


def unregister_cloud_assets(asset_ids: list[str]) -> None:
    if not asset_ids:
        return
    proxy = STATE.cloud_proxy
    if not proxy:
        return
    for asset_id in asset_ids:
        proxy.unregister_asset(asset_id)


def raw_video_files(config_name: str, channel_name: str | None) -> list[dict[str, Any]]:
    config, error = load_config_or_none(config_name)
    if not config:
        raise ValueError(error or "Config not found.")

    defaults = config.get("defaults", {})
    raw_dir = resolve_project_path(defaults.get("raw_dir", "Raw Videos"))
    search_root = raw_dir / channel_name if channel_name else raw_dir
    files_by_path: dict[str, Path] = {}
    if search_root.exists():
        for path in sorted(
            path for path in search_root.rglob("*")
            if normalized_media_is_ready(config, path)
        ):
            files_by_path[relative_or_absolute(path)] = path

    if channel_name:
        for channel in config.get("channels", []):
            if channel.get("name") != channel_name:
                continue
            raw_playlist = channel.get("raw_playlist", [])
            if isinstance(raw_playlist, list):
                for item in raw_playlist:
                    if not isinstance(item, str):
                        continue
                    path = resolve_project_path(item)
                    if path.exists() and path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS:
                        files_by_path[relative_or_absolute(path)] = path
            break

    files = [files_by_path[key] for key in sorted(files_by_path)]
    return [video_file_item(config, path) for path in files]


def normalized_video_files(config_name: str, channel_name: str | None) -> list[dict[str, Any]]:
    config, error = load_config_or_none(config_name)
    if not config:
        raise ValueError(error or "Config not found.")

    defaults = config.get("defaults", {})
    go_live_dir = resolve_project_path(defaults.get("normalized_dir", "Go Live"))
    search_root = go_live_dir / channel_name if channel_name else go_live_dir
    files_by_path: dict[str, Path] = {}
    if search_root.exists():
        for path in sorted(
            path for path in search_root.rglob("*")
            if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS
        ):
            files_by_path[relative_or_absolute(path)] = path

    if channel_name:
        for channel in config.get("channels", []):
            if channel.get("name") != channel_name:
                continue
            playlist = channel.get("playlist", [])
            if isinstance(playlist, list):
                for item in playlist:
                    if not isinstance(item, str):
                        continue
                    path = resolve_project_path(item)
                    if normalized_media_is_ready(config, path):
                        files_by_path[relative_or_absolute(path)] = path
            break

    files = [files_by_path[key] for key in sorted(files_by_path)]
    return [video_file_item(config, path, include_exists=True) for path in files]


def thumbnail_source_for_request(config_name: str, channel_name: str | None, requested_path: str) -> tuple[dict[str, Any], Path]:
    config, error = load_config_or_none(config_name)
    if not config:
        raise ValueError(error or "Config not found.")
    requested = resolve_project_path(requested_path).resolve()
    if not requested.exists() or not requested.is_file() or requested.suffix.lower() not in VIDEO_EXTENSIONS:
        raise ValueError("Video was not found.")

    for item in normalized_video_files(config_name, channel_name):
        candidate = resolve_project_path(str(item.get("path") or "")).resolve()
        if candidate == requested:
            return config, requested

    raise ValueError("Video is not part of this channel's live videos.")


def video_thumbnail(config_name: str, channel_name: str | None, requested_path: str) -> Path:
    if not requested_path:
        raise ValueError("Video path is required.")

    config, source = thumbnail_source_for_request(config_name, channel_name, requested_path)
    stat = source.stat()
    cache_key = hashlib.sha256(
        f"{source}|{stat.st_mtime_ns}|{stat.st_size}".encode("utf-8")
    ).hexdigest()
    cache_dir = ROOT / ".runtime" / "thumbnails"
    cache_dir.mkdir(parents=True, exist_ok=True)
    target = cache_dir / f"{cache_key}.jpg"
    if target.exists():
        return target

    tmp = cache_dir / f"{cache_key}.tmp.jpg"
    tmp.unlink(missing_ok=True)
    ffmpeg_path = str(config.get("defaults", {}).get("ffmpeg_path") or "ffmpeg")
    command = [
        ffmpeg_path,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        "00:00:01",
        "-i",
        str(source),
        "-frames:v",
        "1",
        "-vf",
        "scale=160:-1",
        str(tmp),
    ]
    completed = subprocess.run(
        command,
        cwd=str(ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=20,
        creationflags=windows_creation_flags(),
        check=False,
    )
    if completed.returncode != 0 or not tmp.exists():
        tmp.unlink(missing_ok=True)
        message = (completed.stderr or completed.stdout or "Could not create thumbnail.").strip()
        raise ValueError(message)

    tmp.replace(target)
    return target


def normalized_video_count(config: dict[str, Any], channel_name: str) -> int:
    defaults = config.get("defaults", {})
    go_live_dir = resolve_project_path(defaults.get("normalized_dir", "Go Live"))
    channel_dir = go_live_dir / channel_name
    if not channel_dir.exists():
        return 0
    return sum(
        1
        for path in channel_dir.iterdir()
        if normalized_media_is_ready(config, path)
    )


def register_raw_video(config_name: str, channel_name: str, saved_path: Path) -> None:
    config, error = load_config_or_none(config_name)
    if not config:
        raise ValueError(error or "Config not found.")
    saved = relative_or_absolute(saved_path)
    for channel in config.get("channels", []):
        if channel.get("name") == channel_name:
            existing = channel.get("raw_playlist")
            if not isinstance(existing, list):
                existing = []
            if saved not in existing:
                existing.append(saved)
            channel["raw_playlist"] = existing
            save_config(config_name, config)
            app_db.upsert_video(config_name, channel_name, saved, "raw", "selected", True)
            app_db.record_event("video_uploaded", config_name, channel_name, {"path": saved})
            return
    raise ValueError(f"Unknown channel: {channel_name}")


def register_normalized_video(
    config_name: str,
    channel_name: str,
    saved_path: Path,
    *,
    ensure_playlist: bool = False,
) -> None:
    config, error = load_config_or_none(config_name)
    if not config:
        raise ValueError(error or "Config not found.")
    saved = relative_or_absolute(saved_path)
    for channel in config.get("channels", []):
        if channel.get("name") == channel_name:
            existing = channel.get("playlist")
            if ensure_playlist:
                if not isinstance(existing, list):
                    existing = []
                if saved not in existing:
                    existing.append(saved)
                channel["playlist"] = existing
                save_config(config_name, config)
            elif isinstance(existing, list) and existing and saved not in existing:
                existing.append(saved)
                channel["playlist"] = existing
                save_config(config_name, config)
            app_db.upsert_video(config_name, channel_name, saved, "normalized", "ready", True)
            app_db.record_event("live_video_imported", config_name, channel_name, {"path": saved})
            return
    raise ValueError(f"Unknown channel: {channel_name}")


def import_raw_videos(body: dict[str, Any]) -> dict[str, Any]:
    config_name = safe_config_name(body.get("config"))
    channel_name = str(body.get("channel") or "").strip()
    raw_paths = body.get("paths")
    if not channel_name:
        raise ValueError("Channel is required.")
    if not isinstance(raw_paths, list) or not raw_paths:
        raise ValueError("No videos were selected.")

    config, error = load_config_or_none(config_name)
    if not config:
        raise ValueError(error or "Config not found.")

    defaults = config.get("defaults", {})
    raw_dir = resolve_project_path(defaults.get("raw_dir", "Raw Videos"))
    target_dir = raw_dir / channel_name
    target_dir.mkdir(parents=True, exist_ok=True)
    target_dir_resolved = target_dir.resolve()
    saved_items: list[dict[str, str]] = []

    for item in raw_paths:
        source = resolve_project_path(str(item or "")).resolve()
        if not source.exists() or not source.is_file():
            raise ValueError(f"Video was not found: {source}")
        if source.suffix.lower() not in VIDEO_EXTENSIONS:
            raise ValueError(f"Unsupported video file type: {source.name}")

        filename = sanitize_filename(source.name)
        target = source if source.parent.resolve() == target_dir_resolved else unique_path(target_dir / filename)
        if target != source:
            shutil.copy2(source, target)

        register_raw_video(config_name, channel_name, target)
        saved_items.append({"name": target.name, "path": relative_or_absolute(target)})

    return {"ok": True, "saved": saved_items, "files": raw_video_files(config_name, channel_name)}


def import_normalized_videos(body: dict[str, Any]) -> dict[str, Any]:
    config_name = safe_config_name(body.get("config"))
    channel_name = str(body.get("channel") or "").strip()
    raw_paths = body.get("paths")
    use_originals = bool(body.get("useOriginals") or body.get("use_originals"))
    if not channel_name:
        raise ValueError("Channel is required.")
    if not isinstance(raw_paths, list) or not raw_paths:
        raise ValueError("No videos were selected.")

    config, error = load_config_or_none(config_name)
    if not config:
        raise ValueError(error or "Config not found.")

    defaults = config.get("defaults", {})
    go_live_dir = resolve_project_path(defaults.get("normalized_dir", "Go Live"))
    target_dir = go_live_dir / channel_name
    target_dir.mkdir(parents=True, exist_ok=True)
    target_dir_resolved = target_dir.resolve()
    saved_items: list[dict[str, str]] = []

    for item in raw_paths:
        source = resolve_project_path(str(item or "")).resolve()
        if not source.exists() or not source.is_file():
            raise ValueError(f"Video was not found: {source}")
        if source.suffix.lower() not in VIDEO_EXTENSIONS:
            raise ValueError(f"Unsupported video file type: {source.name}")

        filename = sanitize_filename(source.name)
        target = source if use_originals or source.parent.resolve() == target_dir_resolved else unique_path(target_dir / filename)
        if target != source:
            shutil.copy2(source, target)

        register_normalized_video(config_name, channel_name, target, ensure_playlist=use_originals)
        saved_items.append({"name": target.name, "path": relative_or_absolute(target)})

    mode = "original" if use_originals else "copied"
    return {"ok": True, "mode": mode, "saved": saved_items, "files": normalized_video_files(config_name, channel_name)}


def upload_raw_video(handler: BaseHTTPRequestHandler, query: dict[str, list[str]]) -> dict[str, Any]:
    config_name = safe_config_name(query.get("config", [None])[0])
    channel_name = str(query.get("channel", [""])[0]).strip()
    filename = sanitize_filename(query.get("filename", ["video.mp4"])[0])
    if not channel_name:
        raise ValueError("Channel is required.")
    if Path(filename).suffix.lower() not in VIDEO_EXTENSIONS:
        raise ValueError("Unsupported video file type.")

    config, error = load_config_or_none(config_name)
    if not config:
        raise ValueError(error or "Config not found.")

    defaults = config.get("defaults", {})
    raw_dir = resolve_project_path(defaults.get("raw_dir", "Raw Videos"))
    target_dir = raw_dir / channel_name
    target_dir.mkdir(parents=True, exist_ok=True)
    target = unique_path(target_dir / filename)
    remaining = int(handler.headers.get("Content-Length", "0"))
    if remaining <= 0:
        raise ValueError("Upload is empty.")

    with target.open("wb") as fh:
        while remaining > 0:
            chunk = handler.rfile.read(min(1024 * 1024, remaining))
            if not chunk:
                break
            fh.write(chunk)
            remaining -= len(chunk)

    if remaining:
        target.unlink(missing_ok=True)
        raise ValueError("Upload ended before the full file was received.")

    register_raw_video(config_name, channel_name, target)
    saved = {"name": target.name, "path": relative_or_absolute(target)}
    return {"ok": True, "saved": saved, "files": raw_video_files(config_name, channel_name)}


def upload_normalized_video(handler: BaseHTTPRequestHandler, query: dict[str, list[str]]) -> dict[str, Any]:
    config_name = safe_config_name(query.get("config", [None])[0])
    channel_name = str(query.get("channel", [""])[0]).strip()
    filename = sanitize_filename(query.get("filename", ["video.mp4"])[0])
    if not channel_name:
        raise ValueError("Channel is required.")
    if Path(filename).suffix.lower() not in VIDEO_EXTENSIONS:
        raise ValueError("Unsupported video file type.")

    config, error = load_config_or_none(config_name)
    if not config:
        raise ValueError(error or "Config not found.")

    defaults = config.get("defaults", {})
    go_live_dir = resolve_project_path(defaults.get("normalized_dir", "Go Live"))
    target_dir = go_live_dir / channel_name
    target_dir.mkdir(parents=True, exist_ok=True)
    target = unique_path(target_dir / filename)
    remaining = int(handler.headers.get("Content-Length", "0"))
    if remaining <= 0:
        raise ValueError("Upload is empty.")

    with target.open("wb") as fh:
        while remaining > 0:
            chunk = handler.rfile.read(min(1024 * 1024, remaining))
            if not chunk:
                break
            fh.write(chunk)
            remaining -= len(chunk)

    if remaining:
        target.unlink(missing_ok=True)
        raise ValueError("Upload ended before the full file was received.")

    register_normalized_video(config_name, channel_name, target)
    saved = {"name": target.name, "path": relative_or_absolute(target)}
    return {"ok": True, "saved": saved, "files": normalized_video_files(config_name, channel_name)}


def upload_youtube_thumbnail(handler: BaseHTTPRequestHandler, query: dict[str, list[str]]) -> dict[str, Any]:
    config_name = safe_config_name(query.get("config", [None])[0])
    account_id = normalize_account_id(query.get("account", [""])[0])
    broadcast_id = str(query.get("broadcast", [""])[0]).strip()
    filename = sanitize_filename(query.get("filename", ["thumbnail.jpg"])[0])
    if not account_id:
        raise ValueError("YouTube account slot is required.")
    if not broadcast_id:
        raise ValueError("Broadcast ID is required.")
    if Path(filename).suffix.lower() not in THUMBNAIL_EXTENSIONS:
        raise ValueError("Unsupported thumbnail file type.")

    remaining = int(handler.headers.get("Content-Length", "0"))
    if remaining <= 0:
        raise ValueError("Thumbnail upload is empty.")
    if remaining > THUMBNAIL_MAX_BYTES:
        raise ValueError("Thumbnail must be 2 MB or smaller.")

    image_data = handler.rfile.read(remaining)
    if len(image_data) != remaining:
        raise ValueError("Upload ended before the full thumbnail was received.")

    config, error = load_config_or_none(config_name)
    if not config:
        raise ValueError(error or "Config not found.")
    account = find_youtube_account(config, account_id)
    if not account:
        raise ValueError(f"Unknown YouTube account slot: {account_id}")

    scoped_config = account_config_view(config, account)
    access_token, _tokens = youtube_service.valid_access_token(ROOT, scoped_config)
    content_type_header = str(handler.headers.get("Content-Type") or "").split(";", 1)[0].strip()
    content_type_map = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".bmp": "image/bmp",
    }
    content_type_value = content_type_header or content_type_map.get(Path(filename).suffix.lower(), "application/octet-stream")
    result = youtube_service.upload_thumbnail(
        access_token,
        video_id=broadcast_id,
        image_data=image_data,
        content_type=content_type_value,
    )
    app_db.record_event("youtube_thumbnail_uploaded", config_name, None, {"broadcast_id": broadcast_id, "account_id": account_id})
    return {"ok": True, "broadcast_id": broadcast_id, "account_id": account_id, "thumbnail": result}


def available_configs() -> list[str]:
    return sorted(
        path.name
        for path in ROOT.glob("*.json")
        if path.is_file() and path.name not in INTERNAL_JSON_FILES
    )


def is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def transfer_timestamp() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def transfer_package_name() -> str:
    version = app_version() or "unknown"
    safe_version = re.sub(r"[^A-Za-z0-9._-]+", "-", version).strip("-") or "unknown"
    return f"Castarro-Transfer-{safe_version}-{transfer_timestamp()}"


def transfer_copy_file(source: Path, target: Path) -> dict[str, Any]:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    return transfer_file_record(target)


def transfer_file_record(target: Path) -> dict[str, Any]:
    digest = hashlib.sha256()
    size = 0
    with target.open("rb") as fh:
        while True:
            chunk = fh.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            digest.update(chunk)
    return {
        "path": target.as_posix(),
        "bytes": size,
        "sha256": digest.hexdigest(),
    }


def transfer_copy_database(source: Path, target: Path) -> dict[str, Any]:
    target.parent.mkdir(parents=True, exist_ok=True)
    source_connection: sqlite3.Connection | None = None
    target_connection: sqlite3.Connection | None = None
    try:
        source_connection = sqlite3.connect(str(source), timeout=30)
        target_connection = sqlite3.connect(str(target), timeout=30)
        source_connection.backup(target_connection)
        target_connection.commit()
    finally:
        if target_connection is not None:
            target_connection.close()
        if source_connection is not None:
            source_connection.close()
    return transfer_file_record(target)


def copy_transfer_item(source: Path, target: Path, manifest_root: Path) -> list[dict[str, Any]]:
    files: list[dict[str, Any]] = []
    if source.is_file():
        record = transfer_copy_database(source, target) if source.name == "stream_control.db" else transfer_copy_file(source, target)
        record["path"] = target.relative_to(manifest_root).as_posix()
        files.append(record)
        return files

    if not source.is_dir():
        return files

    target.mkdir(parents=True, exist_ok=True)
    for child in sorted(source.rglob("*")):
        relative = child.relative_to(source)
        destination = target / relative
        if child.is_dir():
            destination.mkdir(parents=True, exist_ok=True)
            continue
        if child.is_file():
            record = transfer_copy_database(child, destination) if child.name == "stream_control.db" else transfer_copy_file(child, destination)
            record["path"] = destination.relative_to(manifest_root).as_posix()
            files.append(record)
    return files


def transfer_source_items() -> list[tuple[str, Path]]:
    items: list[tuple[str, Path]] = []
    seen: set[str] = set()
    ignored_json = {"package.json", "package-lock.json", "config.example.json"}
    for path in sorted(ROOT.glob("*.json")):
        if not path.is_file() or path.name in ignored_json:
            continue
        items.append((path.name, path))
        seen.add(path.name)
    for name in runtime_paths.MUTABLE_FILES:
        if name in seen:
            continue
        path = ROOT / name
        if path.exists() and path.is_file():
            items.append((name, path))
            seen.add(name)
    for name in runtime_paths.MUTABLE_DIRECTORIES:
        path = ROOT / name
        if path.exists() and path.is_dir():
            items.append((name, path))
    return items


def checkpoint_transfer_database() -> None:
    connection: sqlite3.Connection | None = None
    try:
        connection = app_db.connect()
        connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        connection.commit()
    except Exception as exc:
        print(f"[transfer] database checkpoint skipped: {exc}")
    finally:
        if connection is not None:
            connection.close()


def assert_external_transfer_parent(path: Path) -> None:
    root = ROOT.resolve()
    resolved = path.resolve()
    if resolved == root or is_relative_to(resolved, root):
        raise ValueError("Choose a package location outside the Castarro data folder.")


def assert_transfer_member_name(name: str) -> str:
    text = str(name or "").strip()
    if not text or text in {".", ".."} or "/" in text or "\\" in text or "\x00" in text:
        raise ValueError("Transfer package contains an invalid top-level item.")
    target = (ROOT / text).resolve()
    if target.parent != ROOT.resolve():
        raise ValueError("Transfer package contains an unsafe item path.")
    return text


def manifest_name_list(manifest: dict[str, Any], key: str) -> list[Any]:
    value = manifest.get(key)
    return value if isinstance(value, list) else []


def create_transfer_package(body: dict[str, Any]) -> dict[str, Any]:
    destination_value = str(body.get("destination") or "").strip()
    if not destination_value:
        raise ValueError("Choose a folder where Castarro should create the transfer package.")

    parent = Path(destination_value).expanduser().resolve()
    assert_external_transfer_parent(parent)
    parent.mkdir(parents=True, exist_ok=True)
    if not parent.is_dir():
        raise ValueError("Transfer package destination must be a folder.")

    package_dir = unique_path(parent / transfer_package_name())
    data_dir = package_dir / "data"
    package_dir.mkdir(parents=True, exist_ok=False)
    data_dir.mkdir(parents=True, exist_ok=True)

    checkpoint_transfer_database()
    manifest_files: list[dict[str, Any]] = []
    source_items = transfer_source_items()
    for relative_name, source in source_items:
        manifest_files.extend(copy_transfer_item(source, data_dir / relative_name, package_dir))

    total_bytes = sum(int(item.get("bytes") or 0) for item in manifest_files)
    manifest = {
        "schemaVersion": TRANSFER_PACKAGE_VERSION,
        "app": "Castarro",
        "appVersion": app_version(),
        "createdAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "sourceDataRoot": str(ROOT),
        "fileCount": len(manifest_files),
        "totalBytes": total_bytes,
        "mutableDirectories": runtime_paths.MUTABLE_DIRECTORIES,
        "mutableFiles": sorted({name for name, path in source_items if path.is_file()}),
        "files": manifest_files,
    }
    (package_dir / TRANSFER_MANIFEST_NAME).write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    app_db.record_event(
        "transfer_package_exported",
        details={"package": str(package_dir), "file_count": len(manifest_files), "total_bytes": total_bytes},
    )
    return {
        "ok": True,
        "packagePath": str(package_dir),
        "fileCount": len(manifest_files),
        "totalBytes": total_bytes,
    }


def load_transfer_manifest(package_dir: Path) -> dict[str, Any]:
    manifest_path = package_dir / TRANSFER_MANIFEST_NAME
    if not manifest_path.exists() or not manifest_path.is_file():
        raise ValueError("That folder is not a Castarro transfer package.")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise ValueError(f"Transfer package manifest could not be read: {exc}") from exc
    if not isinstance(manifest, dict) or int(manifest.get("schemaVersion") or 0) != TRANSFER_PACKAGE_VERSION:
        raise ValueError("Transfer package version is not supported.")
    if not (package_dir / "data").is_dir():
        raise ValueError("Transfer package is missing its data folder.")
    return manifest


def running_transfer_blockers() -> list[str]:
    blockers: list[str] = []
    with STATE.lock:
        active_streams = [
            name for name, stream in STATE.streams.items()
            if stream.running.process.poll() is None or stream.recovering
        ]
        active_tasks = [task.name for task in STATE.tasks if task.process.poll() is None]
    if active_streams:
        blockers.append(f"{len(active_streams)} live stream{'s' if len(active_streams) != 1 else ''}")
    if active_tasks:
        blockers.append(f"{len(active_tasks)} running task{'s' if len(active_tasks) != 1 else ''}")
    return blockers


def backup_existing_transfer_data() -> Path:
    checkpoint_transfer_database()
    backup_root = ROOT / "transfer-import-backups"
    backup_root.mkdir(parents=True, exist_ok=True)
    backup_dir = unique_path(backup_root / f"before-import-{transfer_timestamp()}")
    data_dir = backup_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    for relative_name, source in transfer_source_items():
        copy_transfer_item(source, data_dir / relative_name, backup_dir)
    return backup_dir


def clear_transfer_target(relative_name: str) -> None:
    target = ROOT / relative_name
    if target.is_dir():
        shutil.rmtree(target)
    elif target.exists():
        target.unlink()


def import_transfer_package(body: dict[str, Any]) -> dict[str, Any]:
    package_value = str(body.get("packagePath") or body.get("package_path") or "").strip()
    if not package_value:
        raise ValueError("Choose a Castarro transfer package folder to import.")

    blockers = running_transfer_blockers()
    if blockers:
        raise ValueError(f"Stop {', '.join(blockers)} before importing a transfer package.")

    package_dir = Path(package_value).expanduser().resolve()
    assert_external_transfer_parent(package_dir)
    manifest = load_transfer_manifest(package_dir)
    package_data = package_dir / "data"

    backup_dir = backup_existing_transfer_data()
    imported: list[str] = []
    restored_names = sorted(
        {
            assert_transfer_member_name(str(name))
            for name in [
                *manifest_name_list(manifest, "mutableDirectories"),
                *manifest_name_list(manifest, "mutableFiles"),
            ]
            if str(name).strip()
        }
    )
    if not restored_names:
        restored_names = [assert_transfer_member_name(item.name) for item in package_data.iterdir()]

    for relative_name in restored_names:
        source = package_data / relative_name
        if not source.exists():
            continue
        if relative_name != "stream_control.db":
            clear_transfer_target(relative_name)
        copy_transfer_item(source, ROOT / relative_name, ROOT)
        imported.append(relative_name)

    for config_name in available_configs():
        config, _error = load_config_or_none(config_name)
        if config:
            ensure_media_folders(config)
            storage_providers.ensure_storage_dirs(config, ROOT)
            app_db.sync_config(config_name, config, "transfer-import")

    app_db.record_event(
        "transfer_package_imported",
        details={"package": str(package_dir), "backup": str(backup_dir), "items": imported},
    )
    return {
        "ok": True,
        "packagePath": str(package_dir),
        "backupPath": str(backup_dir),
        "imported": imported,
        "fileCount": manifest.get("fileCount"),
        "totalBytes": manifest.get("totalBytes"),
    }


def task_command(
    action: str,
    config_name: str,
    channel: str | None,
    force: bool,
    start_index: int = 1,
) -> list[str]:
    python = sys.executable
    if action == "validate":
        command = [python, str(CODE_ROOT / "scripts" / "validate_media.py"), "--config", config_name]
    elif action in {"normalize", "renditions"}:
        command = [python, str(CODE_ROOT / "scripts" / "normalize_media.py"), "--config", config_name]
        if force:
            command.append("--force")
        if action == "renditions":
            command.append("--adaptive-renditions-only")
        if action == "normalize" and start_index > 1:
            command += ["--start-index", str(start_index)]
    elif action == "test-stream":
        if not channel:
            raise ValueError("Test stream requires a channel.")
        command = [python, str(CODE_ROOT / "scripts" / "test_stream.py"), "--config", config_name, "--channel", channel]
    else:
        raise ValueError(f"Unsupported task: {action}")

    if channel and action != "test-stream":
        command += ["--channel", channel]
    return command


def start_task(
    action: str,
    config_name: str,
    channel: str | None,
    force: bool,
    start_index: int = 1,
) -> Task:
    task = Task(action, task_command(action, config_name, channel, force, start_index), config_name, channel)
    with STATE.lock:
        STATE.tasks.appendleft(task)
    return task


def stop_task(task_id: str | None = None, channel_name: str | None = None, action: str | None = None) -> list[str]:
    stopped: list[str] = []
    with STATE.lock:
        for task in list(STATE.tasks):
            if task.process.poll() is not None:
                continue
            if task_id and task.id != task_id:
                continue
            if channel_name and task.channel_name != channel_name:
                continue
            if action and task.name != action:
                continue
            task.stop()
            app_db.record_event("task_stop_requested", task.config_name, task.channel_name, {"task_id": task.id, "action": task.name})
            stopped.append(task.id)
    return stopped


def clear_activity_logs(
    config_name: str,
    preserve_running_tasks: bool = True,
    channel_name: str | None = None,
) -> dict[str, int]:
    removed_task_count = 0
    with STATE.lock:
        retained: deque[Task] = deque(maxlen=STATE.tasks.maxlen)
        for task in list(STATE.tasks):
            if task.config_name != config_name:
                retained.append(task)
                continue
            if channel_name and task.channel_name != channel_name:
                retained.append(task)
                continue
            if preserve_running_tasks and task.process.poll() is None:
                retained.append(task)
                continue
            removed_task_count += 1
        STATE.tasks = retained

    removed_event_count = app_db.clear_app_events(config_name, include_global=not bool(channel_name), channel_name=channel_name)
    return {"tasks": removed_task_count, "events": removed_event_count}


def local_timezone_label(now_local: datetime | None = None) -> str:
    current = now_local or datetime.now().astimezone()
    offset = current.strftime("%z")
    if offset and len(offset) == 5:
        offset = f"{offset[:3]}:{offset[3:]}"
    return f"{current.tzname() or 'Local'} ({offset or '+00:00'})"


def parse_daily_minutes(value: Any) -> int | None:
    text = str(value or "").strip()
    if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", text):
        return None
    hour_text, minute_text = text.split(":", 1)
    return int(hour_text) * 60 + int(minute_text)


def schedule_entry_for_channel(config: dict[str, Any], channel_name: str) -> dict[str, Any] | None:
    scheduler = normalize_scheduler_settings(config)
    for item in scheduler.get("channels", []):
        if str(item.get("channel") or "").strip() == str(channel_name or "").strip():
            return item
    return None


def stream_cycle_entry_for_channel(config: dict[str, Any], channel_name: str) -> dict[str, Any] | None:
    settings = normalize_stream_cycle_settings(config)
    for item in settings.get("channels", []):
        if str(item.get("channel") or "").strip() == str(channel_name or "").strip():
            return item
    return None


def schedule_is_active(entry: dict[str, Any], now_local: datetime | None = None) -> bool:
    if not entry or not entry.get("enabled"):
        return False
    current = now_local or datetime.now().astimezone()
    days = normalize_scheduler_days(entry.get("days"))
    start_minutes = parse_daily_minutes(entry.get("start_time"))
    stop_minutes = parse_daily_minutes(entry.get("stop_time"))
    if start_minutes is None or stop_minutes is None:
        return False
    current_minutes = current.hour * 60 + current.minute
    today = SCHEDULER_DAY_ORDER[current.weekday()]
    if start_minutes == stop_minutes:
        return today in days
    if start_minutes < stop_minutes:
        return today in days and start_minutes <= current_minutes < stop_minutes
    previous_day = SCHEDULER_DAY_ORDER[(current.weekday() - 1) % 7]
    return (today in days and current_minutes >= start_minutes) or (previous_day in days and current_minutes < stop_minutes)


def schedule_transition_datetime(base_date: datetime, minutes: int) -> datetime:
    hour = minutes // 60
    minute = minutes % 60
    return base_date.replace(hour=hour, minute=minute, second=0, microsecond=0)


def next_schedule_boundary(entry: dict[str, Any], *, now_local: datetime, boundary: str) -> datetime | None:
    days = normalize_scheduler_days(entry.get("days"))
    start_minutes = parse_daily_minutes(entry.get("start_time"))
    stop_minutes = parse_daily_minutes(entry.get("stop_time"))
    if start_minutes is None or stop_minutes is None or not days:
        return None
    overnight = start_minutes > stop_minutes
    start_of_today = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    candidates: list[datetime] = []
    for day_offset in range(0, 9):
        day = start_of_today + timedelta(days=day_offset)
        weekday = SCHEDULER_DAY_ORDER[day.weekday()]
        if weekday not in days:
            continue
        if boundary == "start":
            candidate = schedule_transition_datetime(day, start_minutes)
        else:
            stop_day = day + timedelta(days=1 if overnight else 0)
            candidate = schedule_transition_datetime(stop_day, stop_minutes)
        if candidate > now_local:
            candidates.append(candidate)
    return min(candidates) if candidates else None


def scheduler_status(config_name: str, config: dict[str, Any] | None = None) -> dict[str, Any]:
    config = config or load_config_or_none(config_name)[0] or {}
    scheduler = normalize_scheduler_settings(config)
    channels = config.get("channels", []) if isinstance(config.get("channels"), list) else []
    now_local = datetime.now().astimezone()
    with STATE.lock:
        running_names = {
            name
            for name, stream in STATE.streams.items()
            if stream.running.process.poll() is None
        }
        runtime_snapshot = dict(STATE.scheduler_channels)
    channel_rows: list[dict[str, Any]] = []
    for channel in channels:
        if not isinstance(channel, dict):
            continue
        name = str(channel.get("name") or "").strip()
        if not name:
            continue
        entry = schedule_entry_for_channel(config, name)
        active = schedule_is_active(entry or {}, now_local) if entry else False
        next_start = next_schedule_boundary(entry or {}, now_local=now_local, boundary="start") if entry else None
        next_stop = next_schedule_boundary(entry or {}, now_local=now_local, boundary="stop") if entry else None
        runtime = runtime_snapshot.get((config_name, name), {})
        channel_rows.append(
            {
                "channel": name,
                "enabled": bool(entry and entry.get("enabled")),
                "start_time": str(entry.get("start_time") or "") if entry else "",
                "stop_time": str(entry.get("stop_time") or "") if entry else "",
                "days": normalize_scheduler_days(entry.get("days")) if entry else [],
                "in_window": active,
                "running": name in running_names,
                "controlled_run": bool(runtime.get("controlled_run")),
                "last_action": str(runtime.get("last_action") or ""),
                "next_start_at": next_start.isoformat(timespec="seconds") if next_start else "",
                "next_stop_at": next_stop.isoformat(timespec="seconds") if next_stop else "",
            }
        )
    return {
        "enabled": bool(scheduler.get("enabled")),
        "timezone": str(scheduler.get("timezone") or "local"),
        "timezone_label": local_timezone_label(now_local),
        "poll_seconds": int(scheduler.get("poll_seconds") or 20),
        "channels": channel_rows,
        "generated_at": now_local.isoformat(timespec="seconds"),
    }


def stream_cycle_status(config_name: str, config: dict[str, Any] | None = None) -> dict[str, Any]:
    config = config or load_config_or_none(config_name)[0] or {}
    settings = normalize_stream_cycle_settings(config)
    channels = config.get("channels", []) if isinstance(config.get("channels"), list) else []
    now = time.time()
    with STATE.lock:
        stream_snapshot = dict(STATE.streams)
        runtime_snapshot = dict(STATE.stream_cycle_channels)
    channel_rows: list[dict[str, Any]] = []
    for channel in channels:
        if not isinstance(channel, dict):
            continue
        name = str(channel.get("name") or "").strip()
        if not name:
            continue
        entry = stream_cycle_entry_for_channel(config, name)
        stream_state = stream_snapshot.get(name)
        runtime = runtime_snapshot.get((config_name, name), {})
        configured_duration_seconds = stream_cycle_duration_seconds(entry or {})
        duration_random_seconds = int((entry or {}).get("duration_random_minutes") or 0) * 60
        duration_seconds = configured_duration_seconds
        if settings.get("randomized") and duration_random_seconds > 0 and runtime.get("active_duration_seconds"):
            duration_seconds = int(runtime.get("active_duration_seconds") or configured_duration_seconds)
        process_running = bool(stream_state and stream_state.running.process.poll() is None)
        elapsed_seconds = max(0.0, now - stream_state.started_at) if process_running and stream_state else 0.0
        next_cycle_at = ""
        if process_running and entry and entry.get("enabled"):
            next_cycle_at = datetime.fromtimestamp(stream_state.started_at + duration_seconds).astimezone().isoformat(timespec="seconds")
        elif runtime.get("phase") == "waiting_restart" and runtime.get("restart_at"):
            next_cycle_at = datetime.fromtimestamp(float(runtime.get("restart_at") or 0)).astimezone().isoformat(timespec="seconds")
        channel_rows.append(
            {
                "channel": name,
                "enabled": bool(entry and entry.get("enabled")),
                "duration_seconds": duration_seconds,
                "configured_duration_seconds": configured_duration_seconds,
                "randomized": bool(settings.get("randomized")),
                "duration_random_minutes": int((entry or {}).get("duration_random_minutes") or 0),
                "elapsed_seconds": int(elapsed_seconds),
                "remaining_seconds": max(0, int(duration_seconds - elapsed_seconds)) if process_running else 0,
                "running": process_running,
                "phase": str(runtime.get("phase") or ("running" if process_running else "idle")),
                "last_action": str(runtime.get("last_action") or ""),
                "cycle_count": int(runtime.get("cycle_count") or 0),
                "next_cycle_at": next_cycle_at,
                "restart_at": float(runtime.get("restart_at") or 0.0),
            }
        )
    return {
        "enabled": bool(settings.get("enabled")),
        "restart_delay_seconds": stream_cycle_restart_delay_seconds(settings),
        "randomized": bool(settings.get("randomized")),
        "restart_delay_random_minutes": int(settings.get("restart_delay_random_minutes") or 0),
        "channels": channel_rows,
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
    }


def recent_alert_events(
    config_name: str | None,
    channel_name: str | None = None,
    *,
    limit: int = 200,
) -> list[dict[str, Any]]:
    events = app_db.recent_app_events(
        config_name,
        channel_name=channel_name,
        event_type="alert_raised",
        limit=limit,
    )
    alerts: list[dict[str, Any]] = []
    for event in events:
        details = event.get("details") if isinstance(event.get("details"), dict) else {}
        alerts.append(
            {
                "id": int(event.get("id") or 0),
                "channel_name": str(event.get("channel_name") or ""),
                "config_name": str(event.get("config_name") or ""),
                "created_at": str(event.get("created_at") or ""),
                "key": str(details.get("key") or ""),
                "severity": str(details.get("severity") or "info"),
                "title": str(details.get("title") or "Alert"),
                "message": str(details.get("message") or ""),
                "detail": str(details.get("detail") or details.get("message") or ""),
                "details": dict(details),
                "desktop_enabled": bool(details.get("desktop_enabled", True)),
                "mobile_enabled": bool(details.get("mobile_enabled", True)),
            }
        )
        if len(alerts) >= limit:
            break
    return alerts


def alerts_status(config_name: str, config: dict[str, Any] | None = None) -> dict[str, Any]:
    config = config or load_config_or_none(config_name)[0] or {}
    settings = normalize_alert_settings(config)
    recent = recent_alert_events(config_name, limit=200)
    for item in recent:
        allowed = alert_notification_allowed(settings, str(item.get("severity") or ""))
        item["desktop_enabled"] = bool(item.get("desktop_enabled")) and bool(settings.get("desktop_notifications_enabled")) and allowed
        item["mobile_enabled"] = bool(item.get("mobile_enabled")) and bool(settings.get("mobile_notifications_enabled")) and allowed
    return {
        "notification_mode": str(settings.get("notification_mode") or "all"),
        "desktop_notifications_enabled": bool(settings.get("desktop_notifications_enabled")) and normalize_notification_mode(settings.get("notification_mode")) != "off",
        "mobile_notifications_enabled": bool(settings.get("mobile_notifications_enabled")) and normalize_notification_mode(settings.get("notification_mode")) != "off",
        "cooldown_seconds": int(settings.get("cooldown_seconds") or 300),
        "rules": dict(settings.get("rules") or {}),
        "recent": recent,
    }


def emit_alert(
    config: dict[str, Any],
    config_name: str,
    channel_name: str | None,
    key: str,
    severity: str,
    title: str,
    message: str,
) -> None:
    settings = normalize_alert_settings(config)
    if not bool((settings.get("rules") or {}).get(key, False)):
        return
    notification_allowed = alert_notification_allowed(settings, severity)
    cooldown_seconds = max(30, int(settings.get("cooldown_seconds") or 300))
    cooldown_key = (config_name, channel_name, key)
    now_monotonic = time.monotonic()
    with STATE.lock:
        last_sent = float(STATE.alert_cooldowns.get(cooldown_key) or 0.0)
        if last_sent and now_monotonic - last_sent < cooldown_seconds:
            return
        STATE.alert_cooldowns[cooldown_key] = now_monotonic
    app_db.record_event(
        "alert_raised",
        config_name,
        channel_name,
        {
            "key": key,
            "severity": severity,
            "title": title,
            "message": message,
            "desktop_enabled": bool(settings.get("desktop_notifications_enabled")) and notification_allowed,
            "mobile_enabled": bool(settings.get("mobile_notifications_enabled")) and notification_allowed,
        },
    )


def start_stream(config_name: str, channel_name: str | None, stream_id: str | None = None) -> list[str]:
    config, config_dir = stream_manager.load_config((ROOT / config_name).resolve())
    normalize_scheduler_settings(config)
    ensure_youtube_broadcasts_ready_for_start(config_name, config, channel_name)
    channels = stream_manager.enabled_channels(config, channel_name)
    started: list[str] = []
    for channel in channels:
        name = str(channel["name"])
        streams = ensure_channel_streams(channel)
        for s in streams:
            sid = str(s.get("id") or "stream_1")
            if stream_id and sid != stream_id:
                continue
            if not s.get("enabled", True):
                continue
            stream_key_id = f"{name}:{sid}"
            with STATE.lock:
                existing = STATE.streams.get(stream_key_id) or (STATE.streams.get(name) if sid == "stream_1" else None)
            if existing and (existing.running.process.poll() is None or existing.recovering):
                continue
            prepared_channel, cloud_asset_ids = prepare_channel_cloud_playlist(config, channel)
            try:
                running = stream_manager.start_stream(
                    config_dir,
                    config,
                    prepared_channel,
                    stream_item=s,
                )
            except Exception:
                unregister_cloud_assets(cloud_asset_ids)
                raise
            state_obj = StreamState(config_name, running, cloud_asset_ids=cloud_asset_ids)
            with STATE.lock:
                STATE.streams[stream_key_id] = state_obj
                STATE.streams[name] = state_obj
                STATE.stream_exit_recorded.discard((config_name, stream_key_id))
                STATE.stream_exit_recorded.discard((config_name, name))
            app_db.record_stream_start(
                config_name,
                name,
                running.process.pid,
                subprocess.list2cmdline(running.command),
                str(Path(running.log_handle.name)),
                stream_live_title(prepared_channel),
                str(prepared_channel.get("youtube_broadcast_id") or ""),
            )
            app_db.record_event("stream_started", config_name, name, {"pid": running.process.pid, "stream_id": sid})
            started.append(stream_key_id)
    return started


def channel_with_active_adaptive_variant(channel: dict[str, Any], variant_id: str) -> dict[str, Any]:
    prepared = dict(channel)
    profile = dict(prepared.get("live_profile") or {})
    adaptive = dict(profile.get("adaptive") or {})
    adaptive["active_variant_id"] = variant_id
    profile["adaptive"] = adaptive
    profile["mode"] = "adaptive"
    prepared["live_profile"] = profile
    return prepared


def adaptive_variant_ids(profile: dict[str, Any]) -> list[str]:
    adaptive = stream_manager.adaptive_profile(profile)
    return [str(variant.get("id") or "") for variant in adaptive.get("variants") or [] if str(variant.get("id") or "")]


def switch_adaptive_stream(
    config_name: str,
    channel_name: str,
    state: StreamState,
    target_variant_id: str,
    reason: str,
) -> bool:
    if not target_variant_id:
        return False
    now_monotonic = time.monotonic()
    if state.last_adaptive_switch_at and now_monotonic - state.last_adaptive_switch_at < 20:
        return False
    config, config_dir = stream_manager.load_config((ROOT / config_name).resolve())
    channel = find_channel_by_name(config, channel_name)
    if not channel:
        return False
    profile = stream_manager.live_profile(config, channel)
    if str(profile.get("mode") or "") != "adaptive":
        return False
    if target_variant_id == state.adaptive_variant_id:
        return False
    prepared_channel, cloud_asset_ids = prepare_channel_cloud_playlist(
        config,
        channel_with_active_adaptive_variant(channel, target_variant_id),
    )
    old_running = state.running
    old_assets = list(state.cloud_asset_ids)
    try:
        old_running.stop_requested = True
        request_stop_running_stream(
            old_running,
            source="adaptive_variant_switch",
            reason=f"switching to {target_variant_id}: {reason}",
        )
        unregister_cloud_assets(old_assets)
        running = stream_manager.start_stream(config_dir, config, prepared_channel)
    except Exception as exc:
        state.last_reconnect_status = "adaptive_switch_failed"
        state.last_reconnect_error = str(exc)
        return False
    state.replace_running(running, cloud_asset_ids=cloud_asset_ids)
    state.adaptive_variant_id = target_variant_id
    state.last_adaptive_switch_at = now_monotonic
    app_db.record_stream_start(
        config_name,
        channel_name,
        running.process.pid,
        subprocess.list2cmdline(running.command),
        str(Path(running.log_handle.name)),
        stream_live_title(prepared_channel),
        str(prepared_channel.get("youtube_broadcast_id") or ""),
    )
    app_db.record_event(
        "adaptive_variant_switched",
        config_name,
        channel_name,
        {"variant_id": target_variant_id, "reason": reason, "pid": running.process.pid},
    )
    return True


def stop_preview(channel_name: str | None = None) -> str | None:
    with STATE.lock:
        preview = STATE.preview
        if not preview:
            return None
        if channel_name and preview.channel_name != channel_name:
            return None
        request_stop_running_stream(preview.running, source="preview_stop", reason="preview stop requested")
        if preview.running.preview_manifest:
            stream_manager.clear_directory(preview.running.preview_manifest.parent)
        app_db.record_event(
            "preview_stopped",
            preview.config_name,
            preview.channel_name,
            {"returncode": preview.running.process.returncode},
        )
        stopped_channel = preview.channel_name
        STATE.preview = None
        return stopped_channel


def start_preview(config_name: str, channel_name: str | None) -> dict[str, Any]:
    if not channel_name:
        raise ValueError("Channel is required to start preview.")

    config, config_dir = stream_manager.load_config((ROOT / config_name).resolve())
    channels = {
        str(channel.get("name") or ""): channel
        for channel in config.get("channels", [])
        if isinstance(channel, dict)
    }
    channel = channels.get(str(channel_name))
    if not channel:
        raise ValueError(f"Unknown channel: {channel_name}")

    with STATE.lock:
        stream_state = STATE.streams.get(channel_name)
        if not stream_state or stream_state.running.process.poll() is not None:
            raise ValueError(f"Channel '{channel_name}' is not currently live.")

        preview = STATE.preview
        if (
            preview
            and preview.channel_name == channel_name
            and preview.config_name == config_name
            and preview.running.process.poll() is None
        ):
            return preview.as_dict()

        if preview:
            request_stop_running_stream(
                preview.running,
                source="preview_replace",
                reason=f"starting preview for {channel_name}",
            )
            if preview.running.preview_manifest:
                stream_manager.clear_directory(preview.running.preview_manifest.parent)
            app_db.record_event(
                "preview_stopped",
                preview.config_name,
                preview.channel_name,
                {"returncode": preview.running.process.returncode},
            )
            STATE.preview = None

        preview_manifest = stream_manager.preview_manifest_path(config_dir, config, channel)
        running = stream_manager.start_preview_stream(config_dir, config, channel, preview_manifest)
        STATE.preview = PreviewState(config_name, channel_name, running)
        app_db.record_event("preview_started", config_name, channel_name, {"pid": running.process.pid})
        return STATE.preview.as_dict()


def stop_stream(
    channel_name: str | None,
    *,
    stream_id: str | None = None,
    clear_cycle_runtime: bool = True,
    request_source: str = "manual",
    request_reason: str = "",
) -> list[str]:
    stopped: list[str] = []
    cycle_runtime_changed = False
    with STATE.lock:
        if channel_name and stream_id:
            targets = [f"{channel_name}:{stream_id}"]
        elif channel_name:
            targets = [k for k in STATE.streams.keys() if k == channel_name or k.startswith(f"{channel_name}:")]
        else:
            targets = list(STATE.streams.keys())
        for name in targets:
            if not name:
                continue
            state = STATE.streams.get(name)
            if not state:
                continue
            if STATE.preview and STATE.preview.channel_name in (name, name.split(":")[0]):
                preview = STATE.preview
                request_stop_running_stream(
                    preview.running,
                    source=f"{request_source}:preview",
                    reason=request_reason or f"stopping live stream for {name}",
                )
                if preview.running.preview_manifest:
                    stream_manager.clear_directory(preview.running.preview_manifest.parent)
                app_db.record_event(
                    "preview_stopped",
                    preview.config_name,
                    preview.channel_name,
                    {"returncode": preview.running.process.returncode},
                )
                STATE.preview = None
            state.recovering = False
            state.last_reconnect_status = ""
            if clear_cycle_runtime and STATE.stream_cycle_channels.pop((state.config_name, name), None) is not None:
                cycle_runtime_changed = True
            state.running.stop_requested = True
            request_stop_running_stream(state.running, source=request_source, reason=request_reason)
            if state.running.preview_manifest:
                stream_manager.clear_directory(state.running.preview_manifest.parent)
            unregister_cloud_assets(state.cloud_asset_ids)
            transferred_bytes = state.transferred_bytes()
            STATE.stream_exit_recorded.add((state.config_name, name))
            app_db.record_stream_stop(state.config_name, name, state.running.process.returncode, transferred_bytes)
            app_db.record_event(
                "stream_stopped",
                state.config_name,
                name,
                {
                    "returncode": state.running.process.returncode,
                    "transferred_bytes": transferred_bytes,
                    "stop_source": request_source,
                    "stop_reason": request_reason,
                },
            )
            stopped.append(name)
            STATE.streams.pop(name, None)
    if cycle_runtime_changed:
        persist_stream_cycle_runtime()
    return stopped


def format_duration_hhmmss(seconds: int) -> str:
    if seconds <= 0:
        return "00:00:00"
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def get_channel_streams_api(config_name: str, channel_name: str, fetch_stats: bool = False) -> dict[str, Any]:
    config, error = load_config_or_none(config_name)
    if not config:
        raise ValueError(error or "Config not found.")
    channel = find_channel_by_name(config, channel_name)
    if not channel:
        raise ValueError(f"Channel '{channel_name}' not found.")
    
    streams = ensure_channel_streams(channel)
    results: list[dict[str, Any]] = []
    
    video_stats: dict[str, dict[str, Any]] = {}
    broadcast_id = str(channel.get("youtube_broadcast_id") or "").strip()
    if fetch_stats and broadcast_id:
        account = find_reusable_youtube_account_for_channel(config, channel_name)
        if account:
            try:
                scoped_config = account_config_view(config, account)
                access_token, _ = youtube_service.valid_access_token(ROOT, scoped_config)
                video_stats = youtube_service.get_video_stats_batch(access_token, [broadcast_id])
            except Exception:
                pass

    for s in streams:
        sid = str(s.get("id") or "stream_1")
        sname = str(s.get("name") or sid)
        skey = str(s.get("stream_key") or "")
        key_env = str(s.get("stream_key_env") or "")
        playlist = s.get("playlist") if isinstance(s.get("playlist"), list) else []
        stream_state_key = f"{channel_name}:{sid}"
        state = STATE.streams.get(stream_state_key) or STATE.streams.get(channel_name)
        
        is_running = False
        uptime_seconds = 0
        started_at = None
        if state and (state.running.process.poll() is None or state.recovering):
            is_running = True
            started_at = state.started_at
            uptime_seconds = int(time.time() - state.started_at)
            
        stats_data = video_stats.get(broadcast_id, {}) if is_running and broadcast_id and fetch_stats else {}
        concurrent_viewers = stats_data.get("concurrent_viewers")
        total_views = stats_data.get("total_views")
        avg_view_duration = stats_data.get("avg_view_duration")
        
        results.append({
            "id": sid,
            "channel": channel_name,
            "name": sname,
            "stream_key": skey,
            "stream_key_env": key_env,
            "playlist": playlist,
            "enabled": bool(s.get("enabled", True)),
            "status": "running" if is_running else "stopped",
            "is_running": is_running,
            "started_at": started_at,
            "uptime_seconds": uptime_seconds,
            "duration_formatted": format_duration_hhmmss(uptime_seconds) if is_running else "Stopped",
            "concurrent_viewers": concurrent_viewers,
            "total_views": total_views,
            "avg_view_duration": avg_view_duration,
        })
    return {"ok": True, "channel": channel_name, "streams": results, "stats_refreshed": fetch_stats}


def add_channel_stream_api(config_name: str, body: dict[str, Any]) -> dict[str, Any]:
    config, error = load_config_or_none(config_name)
    if not config:
        raise ValueError(error or "Config not found.")
    channel_name = str(body.get("channel") or "").strip()
    channel = find_channel_by_name(config, channel_name)
    if not channel:
        raise ValueError(f"Channel '{channel_name}' not found.")
    
    streams = ensure_channel_streams(channel)
    sname = str(body.get("name") or f"Stream {len(streams) + 1}").strip()
    skey = str(body.get("stream_key") or "").strip()
    sid = f"stream_{int(time.time())}"
    
    new_stream = {
        "id": sid,
        "name": sname,
        "stream_key": skey,
        "stream_key_env": "",
        "enabled": True,
    }
    streams.append(new_stream)
    channel["streams"] = streams
    save_config(config_name, config)
    return get_channel_streams_api(config_name, channel_name)


def delete_channel_stream_api(config_name: str, body: dict[str, Any]) -> dict[str, Any]:
    config, error = load_config_or_none(config_name)
    if not config:
        raise ValueError(error or "Config not found.")
    channel_name = str(body.get("channel") or "").strip()
    stream_id = str(body.get("stream_id") or "").strip()
    channel = find_channel_by_name(config, channel_name)
    if not channel:
        raise ValueError(f"Channel '{channel_name}' not found.")
    
    streams = ensure_channel_streams(channel)
    stop_stream(channel_name, stream_id=stream_id, request_source="delete_stream", request_reason=f"stream {stream_id} deleted")
    channel["streams"] = [s for s in streams if str(s.get("id")) != stream_id]
    save_config(config_name, config)
    return get_channel_streams_api(config_name, channel_name)


def save_channel_streams_api(config_name: str, body: dict[str, Any]) -> dict[str, Any]:
    config, error = load_config_or_none(config_name)
    if not config:
        raise ValueError(error or "Config not found.")
    channel_name = str(body.get("channel") or "").strip()
    raw_streams = body.get("streams")
    if not isinstance(raw_streams, list):
        raise ValueError("Streams list is required.")
    channel = find_channel_by_name(config, channel_name)
    if not channel:
        raise ValueError(f"Channel '{channel_name}' not found.")
    
    channel["streams"] = raw_streams
    save_config(config_name, config)
    return get_channel_streams_api(config_name, channel_name)


def tail_file(path: Path, max_chars: int = 5000) -> str:
    if not path.exists():
        return ""
    try:
        size = path.stat().st_size
        with path.open("rb") as fh:
            fh.seek(max(0, size - max_chars))
            return fh.read().decode("utf-8", errors="replace")
    except OSError:
        return ""


def stream_log_history_for_channels(
    config_name: str,
    channels: list[dict[str, Any]],
    active_stream_names: set[str],
    *,
    sessions_per_channel: int = 3,
) -> dict[str, list[dict[str, Any]]]:
    history: dict[str, list[dict[str, Any]]] = {}
    channel_names = [
        str(channel.get("name") or "").strip()
        for channel in channels
        if str(channel.get("name") or "").strip()
    ]
    for channel_name in channel_names:
        sessions = app_db.recent_stream_sessions(
            config_name,
            channel_name=channel_name,
            limit=sessions_per_channel,
        )
        items: list[dict[str, Any]] = []
        for session in sessions:
            log_path_text = str(session.get("log_path") or "").strip()
            log_path = app_db.resolve_project_path(log_path_text) if log_path_text else None
            log_tail = tail_file(log_path) if log_path else ""
            is_active = (
                str(session.get("status") or "").lower() == "running"
                and channel_name in active_stream_names
            )
            items.append(
                {
                    "session_id": session.get("id"),
                    "name": channel_name,
                    "pid": session.get("pid"),
                    "running": is_active,
                    "status": session.get("status"),
                    "returncode": session.get("returncode"),
                    "started_at": session.get("started_at"),
                    "stopped_at": session.get("stopped_at"),
                    "log_path": log_path_text,
                    "log_tail": log_tail,
                    "is_active": is_active,
                }
            )
        history[channel_name] = items
    return history


def status_payload(config_name: str, *, include_youtube_health: bool = False) -> dict[str, Any]:
    config, error = load_config_or_none(config_name)
    if config:
        ensure_media_folders(config)
    channels = config.get("channels", []) if config else []
    with STATE.lock:
        streams = {name: state.as_dict() for name, state in STATE.streams.items()}
        tasks = [task.as_dict() for task in list(STATE.tasks)]
        preview = STATE.preview.as_dict() if STATE.preview else None
    channel_map = {
        str(channel.get("name") or ""): channel
        for channel in channels
        if str(channel.get("name") or "").strip()
    }
    for name, stream in streams.items():
        channel = channel_map.get(name)
        if not channel:
            continue
        profile = stream_manager.live_profile(config, channel) if config else {}
        target_fps = float(profile.get("fps") or 0) if profile else 0.0
        stream["stream_stats"] = parse_stream_stats(
            stream.get("log_tail", ""),
            running=bool(stream.get("running")),
            target_fps=target_fps or None,
            target_bitrate_bps=live_profile_target_bitrate_bps(profile),
        )
        if include_youtube_health:
            youtube_health = youtube_stream_health_for_channel(config_name, config, channel)
            stream["stream_stats"] = apply_youtube_health_to_stream_stats(stream["stream_stats"], youtube_health)
    if preview:
        preview_channel = str(preview.get("channel") or "")
        if preview_channel in streams:
            streams[preview_channel]["preview_url"] = preview.get("preview_url")
            streams[preview_channel]["preview_ready"] = bool(preview.get("preview_ready"))
            streams[preview_channel]["preview_warning"] = preview.get("preview_warning")
    active_stream_names = {
        name
        for name, stream in streams.items()
        if stream.get("process_running", stream.get("running"))
    }
    active_transfer_bytes = sum(
        int(stream.get("transferred_bytes") or 0)
        for stream in streams.values()
        if stream.get("process_running", stream.get("running"))
    )
    stream_history = app_db.recent_stream_sessions(config_name, limit=12)
    for session in stream_history:
        session["is_active"] = (
            str(session.get("status") or "").lower() == "running"
            and str(session.get("channel_name") or "") in active_stream_names
        )
    stream_log_history = stream_log_history_for_channels(config_name, channels, active_stream_names)

    return {
        "root": str(ROOT),
        "code_root": str(CODE_ROOT),
        "app_version": app_version(),
        "config": config_name,
        "config_exists": config is not None,
        "config_error": error,
        "configs": available_configs(),
        "channels": [
            {
                "name": ch.get("name", "<unnamed>"),
                "enabled": ch.get("enabled", True),
                "playlist_count": len(ch.get("playlist", [])) if isinstance(ch.get("playlist"), list) else 1,
                "cloud_playlist_count": len(ch.get("cloud_playlist", [])) if isinstance(ch.get("cloud_playlist"), list) else 0,
                "normalized_count": normalized_video_count(config, str(ch.get("name", ""))),
                "raw_playlist_count": len(ch.get("raw_playlist", [])) if isinstance(ch.get("raw_playlist"), list) else 0,
                "stream_key_env": ch.get("stream_key_env"),
                "stream_key_env_has_value": bool(os.environ.get(str(ch.get("stream_key_env") or ""))),
                "has_inline_key": bool(ch.get("stream_key")),
                "stream_key_masked": mask_secret(ch.get("stream_key")),
                "youtube_auto_start": bool(ch.get("youtube_auto_start", False)),
                "youtube_auto_stop": bool(ch.get("youtube_auto_stop", False)),
                "youtube_dual_stream": bool(ch.get("youtube_dual_stream", True)),
                "youtube_account_id": str(ch.get("youtube_account_id") or ""),
                "youtube_studio_url": ch.get("youtube_studio_url", ""),
            }
            for ch in channels
        ],
        "storage": storage_providers.storage_status(ROOT, config) if config else {"ok": False, "providers": []},
        "database": app_db.stats(),
        "binaries": runtime_paths.runtime_binary_status(),
        "streams": streams,
        "preview": preview or {"channel": "", "running": False, "preview_url": None, "preview_ready": False, "preview_warning": None},
        "stream_history": stream_history,
        "stream_log_history": stream_log_history,
        "alerts": alerts_status(config_name, config) if config else {"recent": []},
        "scheduler": scheduler_status(config_name, config) if config else default_scheduler_settings(),
        "stream_cycles": stream_cycle_status(config_name, config) if config else default_stream_cycle_settings(),
        "usage": {
            "stream_transfer_today_bytes": app_db.stream_transfer_today_bytes(config_name) + active_transfer_bytes,
            "stream_transfer_month_bytes": app_db.stream_transfer_month_bytes(config_name) + active_transfer_bytes,
            "active_stream_transfer_bytes": active_transfer_bytes,
            "battery_today": {
                "status": "unavailable",
                "label": "Unavailable",
                "detail": "Exact per-app battery usage is not exposed to this desktop app by the operating system.",
            },
        },
        "tasks": tasks,
        "activity_events": app_db.recent_app_events(config_name, limit=60),
    }


YOUTUBE_TERMINAL_LIFECYCLE_STATUSES = {"complete", "completed", "revoked", "abandoned"}
YOUTUBE_RECOVERABLE_LIFECYCLE_STATUSES = {
    "",
    "created",
    "ready",
    "testing",
    "teststarting",
    "live",
    "livestarting",
}


def is_testing() -> bool:
    return any("test" in arg for arg in sys.argv) or "unittest" in sys.modules


def run_playwright_dismiss_dialog(
    config_name: str,
    channel_name: str,
    studio_url: str,
    account_id: str,
    on_complete: Any = None,
) -> None:
    with STATE.lock:
        if channel_name in STATE.playwright_dismiss_channels:
            return
        STATE.playwright_dismiss_channels.add(channel_name)

    def worker() -> None:
        try:
            profile_dir = str((ROOT / ".runtime" / f"playwright_profile_{account_id or 'default'}").resolve())
            script_path = str((ROOT / "scripts" / "dismiss_youtube_dialog.js").resolve())
            cmd = [
                "node",
                script_path,
                "--studio-url",
                studio_url or "https://studio.youtube.com/video/live/livestreaming",
                "--profile-dir",
                profile_dir,
                "--dismiss-delay",
                "12000"
            ]
            print(f"[playwright-dismiss] Starting background dismiss command for channel {channel_name}: {' '.join(cmd)}")
            
            # Start process and wait for completion
            completed = subprocess.run(
                cmd,
                cwd=str(ROOT),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                creationflags=windows_creation_flags(),
                check=False
            )
            print(f"[playwright-dismiss] Command finished with return code {completed.returncode} for channel {channel_name}")
            if completed.returncode != 0:
                print(f"[playwright-dismiss] Error output:\n{completed.stderr}")
        except Exception as exc:
            print(f"[playwright-dismiss] Failed to run dismiss dialog script: {exc}")
        finally:
            with STATE.lock:
                STATE.playwright_dismiss_channels.discard(channel_name)
            if on_complete:
                try:
                    on_complete()
                except Exception as exc:
                    print(f"[playwright-dismiss] Callback error: {exc}")

    thread = threading.Thread(target=worker, name=f"playwright-dismiss-{channel_name}", daemon=True)
    thread.start()


def reconnect_delay_seconds(config: dict[str, Any] | None, channel: dict[str, Any] | None = None) -> float:
    defaults = config.get("defaults", {}) if isinstance(config, dict) else {}
    channel = channel if isinstance(channel, dict) else {}
    raw = channel.get("reconnect_delay_seconds", defaults.get("reconnect_delay_seconds", defaults.get("restart_delay_seconds", 10)))
    try:
        return max(2.0, min(float(raw), 300.0))
    except (TypeError, ValueError):
        return 10.0


def stream_stall_restart_seconds(config: dict[str, Any] | None, channel: dict[str, Any] | None = None) -> float:
    defaults = config.get("defaults", {}) if isinstance(config, dict) else {}
    channel = channel if isinstance(channel, dict) else {}
    raw = channel.get(
        "stream_stall_restart_seconds",
        defaults.get("stream_stall_restart_seconds", defaults.get("stall_restart_seconds", 30)),
    )
    try:
        return max(0.0, min(float(raw), 300.0))
    except (TypeError, ValueError):
        return 30.0


def is_youtube_api_network_error(exc: BaseException) -> bool:
    text = str(exc).lower()
    return "network error" in text or "timed out" in text or "temporary failure" in text or "name resolution" in text


def youtube_reconnect_decision(config: dict[str, Any], channel: dict[str, Any], config_name: str = DEFAULT_CONFIG) -> tuple[str, str]:
    broadcast_id = str(channel.get("youtube_broadcast_id") or "").strip()
    if not broadcast_id:
        return "unsupported", "No linked YouTube broadcast is available to verify."

    account_id = normalize_account_id(channel.get("youtube_account_id") or "")
    account = find_youtube_account(config, account_id)
    if not account:
        return "unsupported", "No linked YouTube account is available to verify the broadcast."

    try:
        scoped_config = account_config_view(config, account)
        access_token, _tokens = youtube_service.valid_access_token(ROOT, scoped_config)
        broadcast = cached_youtube_broadcast_by_id(config_name, account, access_token, broadcast_id)
    except Exception as exc:
        if is_youtube_api_network_error(exc):
            return "pending", f"YouTube status check is waiting for internet access: {exc}"
        return "unsupported", f"Could not verify YouTube broadcast status: {exc}"

    if not broadcast:
        return "terminal", "The linked YouTube broadcast was not found."

    lifecycle = str(broadcast.get("life_cycle_status") or "").strip().lower()
    stream = broadcast.get("stream") if isinstance(broadcast.get("stream"), dict) else {}
    stream_status = str(stream.get("stream_status") or "").strip().lower()
    if lifecycle in YOUTUBE_TERMINAL_LIFECYCLE_STATUSES:
        return "terminal", f"YouTube broadcast is {lifecycle}."
    if lifecycle in YOUTUBE_RECOVERABLE_LIFECYCLE_STATUSES:
        detail = f"YouTube broadcast is {lifecycle or 'not terminal'}"
        if stream_status:
            detail += f" and ingest is {stream_status}"
        return "recoverable", detail + "."
    return "pending", f"YouTube broadcast is {lifecycle}; waiting before deciding whether to close the app stream."


def mark_stream_reconnect_wait(
    state: StreamState,
    config_name: str,
    channel_name: str,
    *,
    status: str,
    message: str,
    delay_seconds: float,
) -> None:
    now = time.time()
    previous_status = state.last_reconnect_status
    previous_message = state.last_reconnect_error
    state.recovering = True
    state.next_reconnect_at = now + delay_seconds
    state.last_reconnect_status = status
    state.last_reconnect_error = message
    if previous_status == status and previous_message == message:
        return
    app_db.record_event(
        "stream_reconnect_waiting",
        config_name,
        channel_name,
        {
            "status": status,
            "message": message,
            "next_reconnect_at": state.next_reconnect_at,
            "attempts": state.reconnect_attempts,
        },
    )


def maybe_reconnect_youtube_stream(
    channel_name: str,
    state: StreamState,
    config: dict[str, Any] | None,
    reason: str,
) -> bool:
    if not config or state.running.stop_requested:
        return False

    channel = find_channel_by_name(config, channel_name)
    if not channel:
        return False
    if not bool(channel.get("restart_on_exit", True)):
        return False

    log_tail = tail_file(state.log_path, max_chars=20000)
    if not stream_manager.is_recoverable_network_exit(state.running.process.returncode, log_tail):
        return False

    delay_seconds = reconnect_delay_seconds(config, channel)
    with STATE.lock:
        current = STATE.streams.get(channel_name)
        if current is not state:
            return True
        
        if channel_name in STATE.playwright_dismiss_channels:
            state.recovering = True
            state.last_reconnect_status = "playwright_dismissing"
            state.last_reconnect_error = "Dismissing YouTube Studio dialogue box..."
            state.next_reconnect_at = time.time() + 5.0
            return True

        state.recovering = True
        state.last_reconnect_status = state.last_reconnect_status or "checking_youtube"
        if state.next_reconnect_at and time.time() < state.next_reconnect_at:
            return True

    decision, message = youtube_reconnect_decision(config, channel, state.config_name)
    if decision == "terminal":
        app_db.record_event(
            "stream_reconnect_abandoned",
            state.config_name,
            channel_name,
            {"reason": reason, "youtube_status": message},
        )
        with STATE.lock:
            state.recovering = False
            state.last_reconnect_status = "youtube_terminal"
            state.last_reconnect_error = message
        return False

    if decision == "unsupported":
        app_db.record_event(
            "stream_reconnect_unverified",
            state.config_name,
            channel_name,
            {"reason": reason, "youtube_status": message},
        )
        message = f"{message} Restarting because FFmpeg exited with a recoverable network error."
        decision = "recoverable"

    if decision != "recoverable":
        with STATE.lock:
            mark_stream_reconnect_wait(
                state,
                state.config_name,
                channel_name,
                status=decision,
                message=message,
                delay_seconds=delay_seconds,
            )
        return True

    config_dir = (ROOT / state.config_name).resolve().parent
    old_running = state.running
    old_assets = list(state.cloud_asset_ids)
    cloud_asset_ids: list[str] = []
    try:
        prepared_channel, cloud_asset_ids = prepare_channel_cloud_playlist(config, channel)
        running = stream_manager.start_stream(config_dir, config, prepared_channel)
    except Exception as exc:
        unregister_cloud_assets(old_assets)
        unregister_cloud_assets(cloud_asset_ids)
        with STATE.lock:
            state.cloud_asset_ids = []
            state.reconnect_attempts += 1
            mark_stream_reconnect_wait(
                state,
                state.config_name,
                channel_name,
                status="retry_failed",
                message=str(exc),
                delay_seconds=delay_seconds,
            )
        app_db.record_event(
            "stream_reconnect_failed",
            state.config_name,
            channel_name,
            {"reason": reason, "message": str(exc), "attempts": state.reconnect_attempts},
        )
        return True

    stream_manager.close_stream_log(old_running)
    unregister_cloud_assets(old_assets)
    with STATE.lock:
        current = STATE.streams.get(channel_name)
        if current is state:
            state.reconnect_attempts += 1
            state.replace_running(running, cloud_asset_ids=cloud_asset_ids)
            STATE.stream_exit_recorded.discard((state.config_name, channel_name))
        else:
            request_stop_running_stream(
                running,
                source="reconnect_superseded",
                reason=f"new process no longer owns {channel_name}",
            )
            unregister_cloud_assets(cloud_asset_ids)
            return True
    app_db.record_event(
        "stream_reconnected",
        state.config_name,
        channel_name,
        {
            "pid": running.process.pid,
            "reason": reason,
            "youtube_status": message,
            "attempts": state.reconnect_attempts,
        },
    )
    return True


def restart_stalled_stream(
    channel_name: str,
    state: StreamState,
    config: dict[str, Any] | None,
    channel: dict[str, Any],
    reason: str,
) -> bool:
    if not config or state.running.stop_requested or state.recovering:
        return False
    if not bool(channel.get("restart_on_exit", True)):
        return False

    config_dir = (ROOT / state.config_name).resolve().parent
    old_running = state.running
    old_assets = list(state.cloud_asset_ids)
    cloud_asset_ids: list[str] = []
    try:
        prepared_channel, cloud_asset_ids = prepare_channel_cloud_playlist(config, channel)
    except Exception as exc:
        unregister_cloud_assets(cloud_asset_ids)
        with STATE.lock:
            state.reconnect_attempts += 1
            mark_stream_reconnect_wait(
                state,
                state.config_name,
                channel_name,
                status="stall_restart_failed",
                message=str(exc),
                delay_seconds=reconnect_delay_seconds(config, channel),
            )
        app_db.record_event(
            "stream_stall_restart_failed",
            state.config_name,
            channel_name,
            {"reason": reason, "message": str(exc), "attempts": state.reconnect_attempts},
        )
        return False

    write_timestamp = getattr(stream_manager, "write_timestamped_log_line", None)
    if callable(write_timestamp):
        try:
            write_timestamp(old_running.log_handle, f"STALL_RESTART kind={old_running.kind} pid={old_running.process.pid} reason={json.dumps(reason)}")
        except Exception:
            pass
    request_stop_running_stream(old_running, source="stall_restart", reason=reason)
    unregister_cloud_assets(old_assets)
    try:
        running = stream_manager.start_stream(config_dir, config, prepared_channel)
    except Exception as exc:
        unregister_cloud_assets(cloud_asset_ids)
        with STATE.lock:
            state.recovering = True
            state.reconnect_attempts += 1
            mark_stream_reconnect_wait(
                state,
                state.config_name,
                channel_name,
                status="stall_restart_failed",
                message=str(exc),
                delay_seconds=reconnect_delay_seconds(config, channel),
            )
        app_db.record_event(
            "stream_stall_restart_failed",
            state.config_name,
            channel_name,
            {"reason": reason, "message": str(exc), "attempts": state.reconnect_attempts},
        )
        return False
    with STATE.lock:
        current = STATE.streams.get(channel_name)
        if current is state:
            state.reconnect_attempts += 1
            state.replace_running(running, cloud_asset_ids=cloud_asset_ids)
            STATE.stream_exit_recorded.discard((state.config_name, channel_name))
            STATE.connection_watch.pop((state.config_name, channel_name), None)
        else:
            request_stop_running_stream(
                running,
                source="stall_restart_superseded",
                reason=f"new process no longer owns {channel_name}",
            )
            unregister_cloud_assets(cloud_asset_ids)
            return False
    app_db.record_stream_start(
        state.config_name,
        channel_name,
        running.process.pid,
        subprocess.list2cmdline(running.command),
        str(Path(running.log_handle.name)),
        stream_live_title(prepared_channel),
        str(prepared_channel.get("youtube_broadcast_id") or ""),
    )
    app_db.record_event(
        "stream_stall_restarted",
        state.config_name,
        channel_name,
        {"pid": running.process.pid, "reason": reason, "attempts": state.reconnect_attempts},
    )
    return True


def finalize_stream_lifecycle() -> None:
    with STATE.lock:
        items = list(STATE.streams.items())
    for channel_name, state in items:
        process = state.running.process
        if process.poll() is None:
            if state.recovering:
                with STATE.lock:
                    state.recovering = False
                    state.next_reconnect_at = 0.0
            continue
        key = (state.config_name, channel_name)
        with STATE.lock:
            if key in STATE.stream_exit_recorded:
                continue

        if not state.playwright_dismissed and not is_testing():
            config, _error = load_config_or_none(state.config_name)
            channel = find_channel_by_name(config or {}, channel_name) if config else None
            if channel:
                account_id = normalize_account_id(channel.get("youtube_account_id") or "")
                if account_id:
                    last_id = channel.get("youtube_last_broadcast_id") or channel.get("youtube_broadcast_id")
                    studio_url = f"https://studio.youtube.com/video/{last_id}/livestreaming" if last_id else "https://studio.youtube.com/video/live/livestreaming"
                    state.playwright_dismissed = True
                    run_playwright_dismiss_dialog(
                        state.config_name,
                        channel_name,
                        studio_url,
                        account_id
                    )
        reason = stream_manager.describe_returncode(process.returncode, stop_requested=state.running.stop_requested)
        config, _error = load_config_or_none(state.config_name)
        if maybe_reconnect_youtube_stream(channel_name, state, config, reason):
            continue
        with STATE.lock:
            if key in STATE.stream_exit_recorded:
                continue
            STATE.stream_exit_recorded.add(key)
            state.recovering = False
        unregister_cloud_assets(state.cloud_asset_ids)
        transferred_bytes = state.transferred_bytes()
        app_db.record_stream_stop(state.config_name, channel_name, process.returncode, transferred_bytes)
        app_db.record_event(
            "stream_stopped" if state.running.stop_requested else "stream_exited",
            state.config_name,
            channel_name,
            {
                "returncode": process.returncode,
                "signed_returncode": stream_manager.signed_returncode(process.returncode),
                "reason": reason,
                "transferred_bytes": transferred_bytes,
            },
        )
        if not state.running.stop_requested:
            if config:
                emit_alert(
                    config,
                    state.config_name,
                    channel_name,
                    "stream_stopped",
                    "danger",
                    f"{channel_name} stopped unexpectedly",
                    reason,
                )


def evaluate_stream_connection_health() -> None:
    with STATE.lock:
        items = list(STATE.streams.items())
    for channel_name, state in items:
        if state.running.process.poll() is not None:
            continue
        log_tail = tail_file(state.log_path)
        config, _error = load_config_or_none(state.config_name)
        channel = find_channel_by_name(config or {}, channel_name) or state.running.channel
        profile = stream_manager.live_profile(config or {}, channel)
        target_fps = float(profile.get("fps") or 0)
        stats = parse_stream_stats(
            log_tail,
            running=True,
            target_fps=target_fps or None,
            target_bitrate_bps=live_profile_target_bitrate_bps(profile),
        )
        youtube_health = youtube_stream_health_for_channel(state.config_name, config, channel)
        stats = apply_youtube_health_to_stream_stats(stats, youtube_health)
        label = str(stats.get("health_label") or "")
        tone = str(stats.get("health_tone") or "")
        severity = "danger" if tone == "danger" else "warn" if tone == "warn" else ""
        watch_key = (state.config_name, channel_name)
        with STATE.lock:
            watch = dict(STATE.connection_watch.get(watch_key) or {})
        stall_limit = stream_stall_restart_seconds(config, channel)
        frame = stats.get("frame")
        output_time = stats.get("output_time_seconds")
        total_size = stats.get("total_size_bytes")
        if stall_limit and stats.get("available") and output_time is not None and total_size is not None:
            now = time.time()
            previous_marker = (
                watch.get("last_frame"),
                watch.get("last_output_time_seconds"),
                watch.get("last_total_size_bytes"),
            )
            current_marker = (frame, output_time, total_size)
            if previous_marker == current_marker:
                progress_seen_at = float(watch.get("progress_seen_at") or now)
                stalled_seconds = max(0.0, now - progress_seen_at)
                watch["stalled_seconds"] = stalled_seconds
                if stalled_seconds >= stall_limit:
                    reason = f"FFmpeg progress has not advanced for {stalled_seconds:.0f}s."
                    with STATE.lock:
                        STATE.connection_watch[watch_key] = watch
                    if restart_stalled_stream(channel_name, state, config, channel, reason):
                        continue
            else:
                watch["last_frame"] = frame
                watch["last_output_time_seconds"] = output_time
                watch["last_total_size_bytes"] = total_size
                watch["progress_seen_at"] = now
                watch["stalled_seconds"] = 0.0
        if severity:
            bad_count = int(watch.get("bad_count") or 0) + 1
            watch["bad_count"] = bad_count
            watch["good_count"] = 0
            watch["last_label"] = label
            if bad_count >= 2:
                config, _error = load_config_or_none(state.config_name)
                if config:
                    emit_alert(
                        config,
                        state.config_name,
                        channel_name,
                        "poor_connection",
                        severity,
                        f"{channel_name} connection needs attention",
                        str(stats.get("detail") or "FFmpeg is reporting degraded live delivery."),
                    )
                    profile = stream_manager.live_profile(config, channel)
                    adaptive = stream_manager.adaptive_profile(profile)
                    if str(profile.get("mode") or "") == "adaptive" and adaptive.get("auto_switch") is not False:
                        ids = adaptive_variant_ids(profile)
                        current_id = state.adaptive_variant_id or str(adaptive.get("active_variant_id") or "")
                        current_index = ids.index(current_id) if current_id in ids else 0
                        if current_index + 1 < len(ids):
                            target_id = ids[current_index + 1]
                            if switch_adaptive_stream(state.config_name, channel_name, state, target_id, "poor_connection"):
                                watch["bad_count"] = 0
        else:
            good_count = int(watch.get("good_count") or 0) + 1
            watch = {"bad_count": 0, "good_count": good_count, "last_label": label}
            config, _error = load_config_or_none(state.config_name)
            if config:
                profile = stream_manager.live_profile(config, channel)
                adaptive = stream_manager.adaptive_profile(profile)
                if str(profile.get("mode") or "") == "adaptive" and adaptive.get("auto_switch") is not False and good_count >= 4:
                    ids = adaptive_variant_ids(profile)
                    current_id = state.adaptive_variant_id or str(adaptive.get("active_variant_id") or "")
                    current_index = ids.index(current_id) if current_id in ids else 0
                    if current_index > 0:
                        target_id = ids[current_index - 1]
                        if switch_adaptive_stream(state.config_name, channel_name, state, target_id, "connection_recovered"):
                            watch["good_count"] = 0
        with STATE.lock:
            STATE.connection_watch[watch_key] = watch


def evaluate_scheduler_for_config(config_name: str, config: dict[str, Any]) -> None:
    scheduler = normalize_scheduler_settings(config)
    if not scheduler.get("enabled"):
        return
    with STATE.lock:
        running_names = {
            name
            for name, stream in STATE.streams.items()
            if stream.config_name == config_name and (stream.running.process.poll() is None or stream.recovering)
        }
        runtime_snapshot = dict(STATE.scheduler_channels)
    now_local = datetime.now().astimezone()
    for channel in config.get("channels", []):
        if not isinstance(channel, dict):
            continue
        channel_name = str(channel.get("name") or "").strip()
        if not channel_name:
            continue
        entry = schedule_entry_for_channel(config, channel_name)
        if not entry or not entry.get("enabled"):
            continue
        runtime_key = (config_name, channel_name)
        runtime = dict(runtime_snapshot.get(runtime_key) or {})
        should_run = schedule_is_active(entry, now_local)
        is_running = channel_name in running_names
        runtime["last_evaluated_at"] = now_local.isoformat(timespec="seconds")
        if should_run and not is_running:
            try:
                assert_youtube_channel_keys_match(config_name, channel_name)
                started = start_stream(config_name, channel_name)
                if started:
                    runtime["controlled_run"] = True
                    runtime["last_action"] = "started"
                    emit_alert(
                        config,
                        config_name,
                        channel_name,
                        "scheduler_started",
                        "info",
                        f"Scheduler started {channel_name}",
                        f"Daily schedule opened at {entry.get('start_time')}.",
                    )
            except Exception as exc:
                app_db.record_event(
                    "scheduler_start_failed",
                    config_name,
                    channel_name,
                    {"message": str(exc)},
                )
        elif not should_run and is_running and bool(runtime.get("controlled_run")):
            stopped = stop_stream(
                channel_name,
                request_source="scheduler",
                request_reason=f"daily schedule ended at {entry.get('stop_time')}",
            )
            if stopped:
                runtime["controlled_run"] = False
                runtime["last_action"] = "stopped"
                emit_alert(
                    config,
                    config_name,
                    channel_name,
                    "scheduler_stopped",
                    "info",
                    f"Scheduler stopped {channel_name}",
                    f"Daily schedule ended at {entry.get('stop_time')}.",
                )
        with STATE.lock:
            STATE.scheduler_channels[runtime_key] = runtime


def evaluate_stream_cycles_for_config(config_name: str, config: dict[str, Any]) -> None:
    settings = normalize_stream_cycle_settings(config)
    if not settings.get("enabled"):
        clear_stream_cycle_runtime_for_config(config_name)
        return

    now = time.time()
    restart_delay = stream_cycle_restart_delay_seconds(settings)
    restart_delay_random_seconds = int(settings.get("restart_delay_random_minutes") or 0) * 60
    for channel in config.get("channels", []):
        if not isinstance(channel, dict):
            continue
        channel_name = str(channel.get("name") or "").strip()
        if not channel_name:
            continue
        entry = stream_cycle_entry_for_channel(config, channel_name)
        if not entry or not entry.get("enabled"):
            pop_stream_cycle_runtime((config_name, channel_name))
            continue

        runtime_key = (config_name, channel_name)
        configured_duration_seconds = stream_cycle_duration_seconds(entry)
        with STATE.lock:
            state = STATE.streams.get(channel_name)
            runtime = dict(STATE.stream_cycle_channels.get(runtime_key) or {})

        is_running = bool(state and state.config_name == config_name and state.running.process.poll() is None)
        if is_running and state:
            elapsed_seconds = max(0.0, now - state.started_at)
            duration_random_seconds = int(entry.get("duration_random_minutes") or 0) * 60
            if settings.get("randomized") and duration_random_seconds > 0:
                active_started_at = float(runtime.get("stream_started_at") or 0.0)
                active_duration = int(runtime.get("active_duration_seconds") or 0)
                if abs(active_started_at - state.started_at) > 0.001 or active_duration <= 0:
                    active_duration = configured_duration_seconds + random_seconds_between(
                        0,
                        duration_random_seconds,
                        minimum_seconds=0,
                    )
                duration_seconds = active_duration
            else:
                duration_seconds = configured_duration_seconds
            runtime.update(
                {
                    "phase": "running",
                    "last_evaluated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
                    "duration_seconds": duration_seconds,
                    "configured_duration_seconds": configured_duration_seconds,
                    "randomized": bool(settings.get("randomized")),
                    "duration_random_minutes": int(entry.get("duration_random_minutes") or 0),
                    "active_duration_seconds": duration_seconds,
                    "stream_started_at": state.started_at,
                    "restart_at": 0.0,
                }
            )
            set_stream_cycle_runtime(runtime_key, runtime)
            if elapsed_seconds < duration_seconds:
                continue

            app_db.record_event(
                "stream_cycle_due",
                config_name,
                channel_name,
                {
                    "duration_seconds": duration_seconds,
                    "configured_duration_seconds": configured_duration_seconds,
                    "randomized": bool(settings.get("randomized")),
                    "duration_random_minutes": int(entry.get("duration_random_minutes") or 0),
                    "elapsed_seconds": round(elapsed_seconds, 3),
                    "restart_delay_seconds": restart_delay,
                },
            )
            actual_restart_delay = restart_delay
            if settings.get("randomized") and restart_delay_random_seconds > 0:
                actual_restart_delay += random_seconds_between(0, restart_delay_random_seconds, minimum_seconds=0)
            restart_at = time.time() + actual_restart_delay
            runtime.update(
                {
                    "phase": "waiting_restart",
                    "restart_at": restart_at,
                    "restart_delay_seconds": actual_restart_delay,
                    "randomized": bool(settings.get("randomized")),
                    "restart_delay_random_minutes": int(settings.get("restart_delay_random_minutes") or 0),
                    "last_action": "stopped_for_cycle",
                    "last_stopped_at": datetime.now().astimezone().isoformat(timespec="seconds"),
                }
            )
            set_stream_cycle_runtime(runtime_key, runtime)
            stopped = stop_stream(
                channel_name,
                clear_cycle_runtime=False,
                request_source="stream_cycle",
                request_reason=(
                    f"duration reached: elapsed={round(elapsed_seconds, 3)}s "
                    f"limit={duration_seconds}s cooldown={actual_restart_delay}s"
                ),
            )
            if not stopped:
                continue
            app_db.record_event(
                "stream_cycle_stopped",
                config_name,
                channel_name,
                {
                    "restart_at": restart_at,
                    "restart_delay_seconds": actual_restart_delay,
                    "randomized": bool(settings.get("randomized")),
                    "restart_delay_random_minutes": int(settings.get("restart_delay_random_minutes") or 0),
                },
            )
            continue

        if runtime.get("phase") != "waiting_restart":
            continue
        
        # Delay cycle restart while Playwright is active
        with STATE.lock:
            if channel_name in STATE.playwright_dismiss_channels:
                continue

        restart_at = float(runtime.get("restart_at") or 0.0)
        if restart_at and now < restart_at:
            continue

        try:
            assert_youtube_channel_keys_match(config_name, channel_name)
            started = start_stream(config_name, channel_name)
        except Exception as exc:
            retry_delay = restart_delay
            if settings.get("randomized") and restart_delay_random_seconds > 0:
                retry_delay += random_seconds_between(0, restart_delay_random_seconds, minimum_seconds=0)
            runtime.update(
                {
                    "phase": "waiting_restart",
                    "restart_at": time.time() + max(retry_delay, 10.0),
                    "restart_delay_seconds": retry_delay,
                    "randomized": bool(settings.get("randomized")),
                    "restart_delay_random_minutes": int(settings.get("restart_delay_random_minutes") or 0),
                    "last_action": "restart_failed",
                    "last_error": str(exc),
                }
            )
            set_stream_cycle_runtime(runtime_key, runtime)
            app_db.record_event(
                "stream_cycle_restart_failed",
                config_name,
                channel_name,
                {"message": str(exc), "restart_at": runtime["restart_at"]},
            )
            continue

        if started:
            runtime.update(
                {
                    "phase": "running",
                    "restart_at": 0.0,
                    "last_action": "restarted",
                    "last_started_at": datetime.now().astimezone().isoformat(timespec="seconds"),
                    "active_duration_seconds": 0,
                    "stream_started_at": 0.0,
                    "cycle_count": int(runtime.get("cycle_count") or 0) + 1,
                    "last_error": "",
                }
            )
            set_stream_cycle_runtime(runtime_key, runtime)
            app_db.record_event(
                "stream_cycle_restarted",
                config_name,
                channel_name,
                {"cycle_count": runtime["cycle_count"]},
            )


def automation_loop() -> None:
    while not STATE.stop_event.wait(15):
        try:
            finalize_stream_lifecycle()
            evaluate_stream_connection_health()
            for config_name in available_configs():
                config, _error = load_config_or_none(config_name)
                if config:
                    evaluate_scheduler_for_config(config_name, config)
                    evaluate_stream_cycles_for_config(config_name, config)
        except Exception as exc:
            print(f"[automation] {exc}")


def content_type(path: Path) -> str:
    if path.suffix == ".html":
        return "text/html; charset=utf-8"
    if path.suffix == ".css":
        return "text/css; charset=utf-8"
    if path.suffix == ".js":
        return "application/javascript; charset=utf-8"
    if path.suffix == ".m3u8":
        return "application/vnd.apple.mpegurl"
    if path.suffix == ".ts":
        return "video/mp2t"
    return "application/octet-stream"


def preview_file_for_request(channel_name: str, leaf: str) -> Path | None:
    if not channel_name or not leaf:
        return None
    if Path(leaf).name != leaf:
        return None
    with STATE.lock:
        preview = STATE.preview
        if not preview or preview.channel_name != channel_name:
            return None
        manifest = preview.running.preview_manifest
    if not manifest:
        return None

    root = manifest.parent.resolve()
    target = (root / leaf).resolve()
    if not str(target).startswith(str(root)):
        return None
    return target


def sync_public_status() -> dict[str, Any]:
    return {
        **sync_service.account_status(),
        "syncServer": {
            "host": sync_service.local_lan_ip() if SYNC_PORT else "",
            "port": SYNC_PORT,
            "running": bool(SYNC_PORT),
        },
    }


def create_sync_account(body: dict[str, Any]) -> dict[str, Any]:
    account = sync_service.create_account(body.get("username"), body.get("password"), body.get("displayName"))
    app_db.record_event("sync_account_created", details={"username": account["username"]})
    return {"ok": True, "account": account, **sync_public_status()}


def login_sync_account(body: dict[str, Any]) -> dict[str, Any]:
    account = sync_service.verify_account(body.get("username"), body.get("password"))
    return {"ok": True, "account": account, **sync_public_status()}


def disconnect_sync_device(body: dict[str, Any]) -> dict[str, Any]:
    device_id = str(body.get("deviceId") or body.get("device_id") or "").strip()
    if not device_id:
        raise ValueError("Device ID is required.")
    removed = sync_service.forget_device(device_id)
    with STATE.lock:
        STATE.sync_tokens = {
            token: record
            for token, record in STATE.sync_tokens.items()
            if str(((record.get("device") or {}) if isinstance(record, dict) else {}).get("id") or "") != device_id
        }
    if removed:
        app_db.record_event(
            "sync_device_disconnected",
            details={
                "device_id": device_id,
                "device_name": removed.get("deviceName") or "Mobile device",
            },
        )
    return {"ok": True, "removed": bool(removed), **sync_public_status()}


SYNC_ENABLED = False


def start_sync_pairing(config_name: str, body: dict[str, Any]) -> dict[str, Any]:
    if not SYNC_ENABLED and not any("test" in arg for arg in sys.argv):
        raise ValueError("Mobile pairing is temporarily disabled.")
    sync_port = ensure_sync_server_running()
    account = sync_service.ensure_local_account()
    config, error = load_config_or_none(config_name)
    if not config:
        raise ValueError(error or "Config not found.")
    pairing = sync_service.new_pairing(
        account["username"],
        config_name,
        sync_port,
        include_videos=bool(body.get("includeVideos", False)),
    )
    with STATE.lock:
        STATE.sync_pairings[pairing["token"]] = pairing
    app_db.record_event(
        "sync_pairing_started",
        config_name,
        details={
            "username": account["username"],
            "expires_at": pairing["expiresAt"],
            "include_videos": pairing["includeVideos"],
        },
    )
    return {"ok": True, "account": account, "pairing": pairing["payload"]}


def sync_pairing_for_token(token: str) -> dict[str, Any]:
    with STATE.lock:
        pairing = STATE.sync_pairings.get(token)
    if not pairing or sync_service.is_expired(pairing):
        raise ValueError("Pairing code expired. Start pairing again on desktop.")
    return pairing


def issue_sync_token(
    pairing: dict[str, Any],
    account: dict[str, Any],
    *,
    include_videos: bool,
    device: dict[str, Any],
) -> str:
    sync_token = secrets.token_urlsafe(32)
    with STATE.lock:
        STATE.sync_tokens[sync_token] = {
            "username": account["username"],
            "accountId": account["id"],
            "configName": pairing["configName"],
            "includeVideos": bool(include_videos),
            "expiresAt": time.time() + 60 * 60 * 6,
            "device": device,
        }
    return sync_token


def sync_token_record(token: str) -> dict[str, Any]:
    with STATE.lock:
        record = STATE.sync_tokens.get(token)
    if not record or time.time() >= float(record.get("expiresAt") or 0):
        raise ValueError("Sync session expired. Scan the QR code again.")
    device = record.get("device") if isinstance(record.get("device"), dict) else {}
    account_id = str(record.get("accountId") or "")
    device_id = str(device.get("id") or "")
    if account_id and device_id:
        updated = sync_service.remember_device(
            account_id,
            device_id,
            str(device.get("deviceName") or device.get("name") or "Mobile device"),
            str(device.get("platform") or "android"),
        )
        with STATE.lock:
            record["device"] = updated
    return record


def sync_base_url(handler: BaseHTTPRequestHandler) -> str:
    host = str(handler.headers.get("Host") or "").strip()
    if not host:
        host = f"{sync_service.local_lan_ip()}:{SYNC_PORT}"
    return f"http://{host}"


def sync_bundle_for_record(record: dict[str, Any], token: str, base_url: str) -> dict[str, Any]:
    config_name = safe_config_name(record.get("configName"))
    config, error = load_config_or_none(config_name)
    if not config:
        raise ValueError(error or "Config not found.")
    account = {
        "id": record["accountId"],
        "username": record["username"],
        "displayName": record["username"],
        "createdAt": sync_service.now_iso(),
        "updatedAt": sync_service.now_iso(),
    }
    video_base_url = f"{base_url}/sync/video?syncToken={quote(token, safe='')}"
    return sync_service.build_sync_bundle(
        config_name,
        config,
        account,
        include_videos=bool(record.get("includeVideos")),
        video_base_url=video_base_url,
    )


def handle_sync_pair_info(token: str) -> dict[str, Any]:
    pairing = sync_pairing_for_token(token)
    return {
        "ok": True,
        "username": pairing["username"],
        "configName": pairing["configName"],
        "includeVideos": bool(pairing.get("includeVideos")),
        "expiresAt": pairing["expiresAt"],
    }


def handle_sync_pair_login(handler: BaseHTTPRequestHandler, token: str, body: dict[str, Any]) -> dict[str, Any]:
    pairing = sync_pairing_for_token(token)
    code = str(body.get("code") or "").strip()
    if code and not secrets.compare_digest(code, str(pairing.get("code") or "")):
        raise ValueError("Pairing code is not correct.")
    account = sync_service.account_by_username(pairing["username"])
    device = body.get("device") if isinstance(body.get("device"), dict) else {}
    device_id = str(device.get("id") or f"device-{secrets.token_hex(8)}")
    device_name = str(device.get("name") or "Android phone").strip() or "Android phone"
    platform = str(device.get("platform") or "android").strip().lower()
    stored_device = sync_service.remember_device(account["id"], device_id, device_name, platform)
    include_videos = bool(pairing.get("includeVideos", False)) and bool(body.get("includeVideos", False))
    sync_token = issue_sync_token(pairing, account, include_videos=include_videos, device=stored_device)
    record = sync_token_record(sync_token)
    bundle = sync_bundle_for_record(record, sync_token, sync_base_url(handler))
    app_db.record_event(
        "sync_pairing_completed",
        pairing["configName"],
        details={"username": account["username"], "device": device_name, "include_videos": include_videos},
    )
    return {
        "ok": True,
        "account": account,
        "device": stored_device,
        "syncToken": sync_token,
        "includeVideos": include_videos,
        "bundle": bundle,
    }


def handle_sync_pull(handler: BaseHTTPRequestHandler, token: str) -> dict[str, Any]:
    record = sync_token_record(token)
    return {"ok": True, "bundle": sync_bundle_for_record(record, token, sync_base_url(handler))}


def remote_status_for_record(record: dict[str, Any]) -> dict[str, Any]:
    config_name = safe_config_name(record.get("configName"))
    payload = status_payload(config_name)
    scheduler = payload.get("scheduler") if isinstance(payload.get("scheduler"), dict) else {}
    scheduler_by_channel = {
        str(item.get("channel") or ""): item
        for item in scheduler.get("channels", [])
        if isinstance(item, dict)
    }
    channels: list[dict[str, Any]] = []
    for item in payload.get("channels", []):
        channel_name = str(item.get("name") or "").strip()
        if not channel_name:
            continue
        stream = payload.get("streams", {}).get(channel_name, {})
        stats = stream.get("stream_stats") if isinstance(stream.get("stream_stats"), dict) else {}
        channels.append(
            {
                "channelId": sync_service.channel_id(config_name, channel_name),
                "channelName": channel_name,
                "running": bool(stream.get("running")),
                "healthLabel": str(stats.get("health_label") or ("Good" if stream.get("running") else "Offline")),
                "healthDetail": str(stats.get("detail") or ""),
                "bitrateBps": int(stats.get("average_bitrate_bps") or 0),
                "speed": stats.get("speed"),
                "transferredBytes": int(stream.get("transferred_bytes") or 0),
                "scheduler": scheduler_by_channel.get(channel_name, {}),
            }
        )
    alerts = payload.get("alerts", {}) if isinstance(payload.get("alerts"), dict) else {}
    return {
        "ok": True,
        "desktopLabel": "Castarro Desktop",
        "configName": config_name,
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "channels": channels,
        "alerts": alerts,
        "scheduler": scheduler,
        "syncServer": sync_public_status().get("syncServer", {}),
        "appVersion": payload.get("app_version"),
    }


def handle_sync_remote_status(token: str) -> dict[str, Any]:
    record = sync_token_record(token)
    return remote_status_for_record(record)


def handle_sync_remote_control(token: str, body: dict[str, Any]) -> dict[str, Any]:
    record = sync_token_record(token)
    config_name = safe_config_name(record.get("configName"))
    action = str(body.get("action") or "").strip().lower()
    channel_name = str(body.get("channelName") or body.get("channel") or "").strip()
    if action not in {"start", "stop", "restart"}:
        raise ValueError("Remote action must be start, stop, or restart.")
    if not channel_name:
        raise ValueError("Remote control requires a channel name.")
    if action in {"start", "restart"}:
        assert_youtube_channel_keys_match(config_name, channel_name)
    if action == "start":
        changed = start_stream(config_name, channel_name)
    elif action == "stop":
        changed = stop_stream(
            channel_name,
            request_source="mobile_remote",
            request_reason=f"remote stop from {(record.get('device') or {}).get('deviceName') or 'Mobile device'}",
        )
    else:
        stop_stream(
            channel_name,
            request_source="mobile_remote",
            request_reason=f"remote restart from {(record.get('device') or {}).get('deviceName') or 'Mobile device'}",
        )
        changed = start_stream(config_name, channel_name)
    app_db.record_event(
        "remote_control_action",
        config_name,
        channel_name,
        {
            "action": action,
            "device": (record.get("device") or {}).get("deviceName") or "Mobile device",
        },
    )
    return {
        "ok": True,
        "action": action,
        "changed": changed,
        "status": remote_status_for_record(record),
    }


def sync_video_path(record: dict[str, Any], requested_path: str) -> Path:
    config_name = safe_config_name(record.get("configName"))
    config, error = load_config_or_none(config_name)
    if not config:
        raise ValueError(error or "Config not found.")
    allowed = {
        path_text
        for channel in config.get("channels", [])
        if isinstance(channel, dict)
        for _kind, path_text in sync_service._playlist_items(channel)
    }
    if requested_path not in allowed:
        raise ValueError("That video is not part of the synced channel playlist.")
    path = app_db.resolve_project_path(requested_path).resolve()
    root = ROOT.resolve()
    if not str(path).startswith(str(root)) or not path.is_file():
        raise ValueError("Video file is not available for sync.")
    return path


class SyncHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[sync] {self.address_string()} - {fmt % args}")

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        try:
            if parsed.path.startswith("/sync/pair/"):
                json_response(self, handle_sync_pair_info(parsed.path.rsplit("/", 1)[-1]))
                return
            if parsed.path == "/sync/pull":
                query = parse_qs(parsed.query)
                token = str(query.get("syncToken", [""])[0] or "")
                json_response(self, handle_sync_pull(self, token))
                return
            if parsed.path == "/sync/status":
                query = parse_qs(parsed.query)
                token = str(query.get("syncToken", [""])[0] or "")
                json_response(self, handle_sync_remote_status(token))
                return
            if parsed.path == "/sync/video":
                query = parse_qs(parsed.query)
                token = str(query.get("syncToken", [""])[0] or "")
                requested_path = str(query.get("path", [""])[0] or "")
                record = sync_token_record(token)
                if not bool(record.get("includeVideos")):
                    raise ValueError("This sync session was created without video file transfer.")
                file_path = sync_video_path(record, requested_path)
                write_response(
                    self,
                    200,
                    file_path.read_bytes(),
                    content_type(file_path),
                    {"Content-Disposition": f"attachment; filename=\"{file_path.name}\""},
                )
                return
            json_response(self, {"error": "Not found"}, 404)
        except Exception as exc:
            status_code = 400 if isinstance(exc, ValueError) else 500
            json_response(self, {"error": str(exc)}, status_code)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        try:
            body = read_body(self)
            if parsed.path.startswith("/sync/pair/"):
                token = parsed.path.rsplit("/", 1)[-1]
                json_response(self, handle_sync_pair_login(self, token, body if isinstance(body, dict) else {}))
                return
            if parsed.path == "/sync/control":
                query = parse_qs(parsed.query)
                token = str(query.get("syncToken", [""])[0] or "")
                json_response(self, handle_sync_remote_control(token, body if isinstance(body, dict) else {}))
                return
            json_response(self, {"error": "Not found"}, 404)
        except Exception as exc:
            status_code = 400 if isinstance(exc, ValueError) else 500
            json_response(self, {"error": str(exc)}, status_code)


def sync_bind_host() -> str:
    host = str(os.environ.get("CASTARRO_SYNC_HOST") or "0.0.0.0").strip()
    return host or "0.0.0.0"


def ensure_sync_server_running() -> int:
    if not SYNC_ENABLED and not any("test" in arg for arg in sys.argv):
        return 0
    global SYNC_HOST, SYNC_PORT, SYNC_SERVER, SYNC_THREAD
    with SYNC_LOCK:
        if SYNC_SERVER is not None:
            return SYNC_PORT
        requested_sync_port = int(os.environ.get("CASTARRO_SYNC_PORT", "0"))
        host = sync_bind_host()
        server = ThreadingHTTPServer((host, requested_sync_port), SyncHandler)
        SYNC_HOST = host
        SYNC_PORT = int(server.server_address[1])
        SYNC_SERVER = server
        SYNC_THREAD = threading.Thread(target=server.serve_forever, name="castarro-sync-server", daemon=True)
        SYNC_THREAD.start()
        print(f"Castarro device sync available at http://{sync_service.local_lan_ip()}:{SYNC_PORT}")
        return SYNC_PORT


def stop_sync_server() -> None:
    global SYNC_HOST, SYNC_PORT, SYNC_SERVER, SYNC_THREAD
    with SYNC_LOCK:
        server = SYNC_SERVER
        SYNC_SERVER = None
        SYNC_THREAD = None
        SYNC_HOST = ""
        SYNC_PORT = 0
    if server is not None:
        server.shutdown()
        server.server_close()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[ui] {self.address_string()} - {fmt % args}")

    def do_OPTIONS(self) -> None:
        write_response(self, 204, b"", "text/plain; charset=utf-8")

    def do_GET(self) -> None:
        begin_request_trace(self, "GET", self.path)
        parsed = urlparse(self.path)
        try:
            query = parse_qs(parsed.query)
            update_request_trace(
                self,
                query_keys=sorted(query.keys()),
                raw_config=str(query.get("config", [""])[0] or ""),
                channel_name=str(query.get("channel", [""])[0] or "").strip() or None,
            )
            if "state" in query and ("code" in query or "error" in query):
                oauth_state = str(query.get("state", [""])[0] or "")
                with STATE.lock:
                    has_oauth_state = oauth_state in STATE.youtube_oauth_states
                if has_oauth_state:
                    html = handle_youtube_oauth_callback(query).encode("utf-8")
                    write_response(self, 200, html, "text/html; charset=utf-8")
                    return

            if parsed.path.startswith("/preview/"):
                remainder = parsed.path[len("/preview/"):]
                channel_token, _, leaf = remainder.partition("/")
                channel_name = unquote(channel_token)
                leaf_name = leaf or "index.m3u8"
                file_path = preview_file_for_request(channel_name, leaf_name)
                if not file_path or not file_path.exists():
                    text_response(self, "Not found", 404)
                    return
                data = file_path.read_bytes()
                write_response(
                    self,
                    200,
                    data,
                    content_type(file_path),
                    {"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
                )
                return

            if parsed.path == "/vendor/qrcode-generator.js":
                vendor_path = (CODE_ROOT / "node_modules" / "qrcode-generator" / "qrcode.js").resolve()
                if not vendor_path.exists():
                    text_response(self, "QR library is not installed.", 404)
                    return
                write_response(self, 200, vendor_path.read_bytes(), "application/javascript; charset=utf-8")
                return

            if parsed.path == "/api/status":
                config_name = safe_config_name(query.get("config", [DEFAULT_CONFIG])[0])
                update_request_trace(self, config_name=config_name)
                include_youtube_health = str(query.get("youtubeHealth", [""])[0] or "").strip().lower() in {"1", "true", "yes"}
                json_response(self, status_payload(config_name, include_youtube_health=include_youtube_health))
                return

            if parsed.path == "/api/channel/streams":
                config_name = safe_config_name(query.get("config", [DEFAULT_CONFIG])[0])
                channel_name = str(query.get("channel", [""])[0] or "").strip()
                fetch_stats = str(query.get("fetchStats", [""])[0] or "").strip().lower() in {"1", "true", "yes"}
                update_request_trace(self, config_name=config_name, channel_name=channel_name)
                json_response(self, get_channel_streams_api(config_name, channel_name, fetch_stats=fetch_stats))
                return

            if parsed.path == "/api/sync/status":
                json_response(self, sync_public_status())
                return

            if parsed.path == "/api/data-usage":
                config_name = safe_config_name(query.get("config", [DEFAULT_CONFIG])[0])
                start_at = str(query.get("start", [""])[0] or "").strip() or None
                end_at = str(query.get("end", [""])[0] or "").strip() or None
                update_request_trace(self, config_name=config_name)
                details = app_db.stream_transfer_range_details(config_name, start_date=start_at, end_date=end_at)
                st_payload = status_payload(config_name)
                active_bytes = int(st_payload.get("usage", {}).get("active_stream_transfer_bytes", 0) or 0)
                if active_bytes > 0:
                    details["total_bytes"] += active_bytes
                details["start_date"] = start_at
                details["end_date"] = end_at
                json_response(self, details)
                return

            if parsed.path == "/api/stream-history":
                config_name = safe_config_name(query.get("config", [DEFAULT_CONFIG])[0])
                channel_name = str(query.get("channel", [""])[0] or "").strip() or None
                start_at = str(query.get("start", [""])[0] or "").strip() or None
                end_at = str(query.get("end", [""])[0] or "").strip() or None
                limit_text = str(query.get("limit", [""])[0] or "").strip()
                limit = int(limit_text) if limit_text else None
                update_request_trace(self, config_name=config_name, channel_name=channel_name)
                json_response(
                    self,
                    {
                        "sessions": app_db.stream_sessions(
                            config_name,
                            channel_name=channel_name,
                            started_after=start_at,
                            started_before=end_at,
                            limit=limit,
                        )
                    },
                )
                return

            if parsed.path == "/api/youtube/status":
                config_name = safe_config_name(query.get("config", [DEFAULT_CONFIG])[0])
                update_request_trace(self, config_name=config_name)
                json_response(self, youtube_status(config_name))
                return

            if parsed.path == "/api/storage/status":
                config_name = safe_config_name(query.get("config", [DEFAULT_CONFIG])[0])
                update_request_trace(self, config_name=config_name)
                json_response(self, storage_status(config_name))
                return

            if parsed.path == "/api/storage/files":
                config_name = safe_config_name(query.get("config", [DEFAULT_CONFIG])[0])
                provider_id = str(query.get("provider", [""])[0] or "").strip()
                folder_id = str(query.get("folder", [""])[0] or "").strip() or None
                update_request_trace(self, config_name=config_name)
                json_response(self, storage_files(config_name, provider_id, folder_id))
                return

            if parsed.path == "/api/storage/auth/start":
                config_name = safe_config_name(query.get("config", [DEFAULT_CONFIG])[0])
                provider_id = str(query.get("provider", [""])[0] or "").strip()
                update_request_trace(self, config_name=config_name)
                json_response(self, create_storage_auth_start(config_name, provider_id))
                return

            if parsed.path == "/api/youtube/auth/start":
                config_name = safe_config_name(query.get("config", [DEFAULT_CONFIG])[0])
                account_id = str(query.get("account", [""])[0] or "").strip()
                label = str(query.get("label", [""])[0] or "").strip()
                channel_name = str(query.get("channel", [""])[0] or "").strip()
                update_request_trace(self, config_name=config_name)
                json_response(self, create_youtube_auth_start(config_name, account_id, label, channel_name))
                return

            if parsed.path == "/api/youtube/oauth/callback":
                html = handle_youtube_oauth_callback(query).encode("utf-8")
                write_response(self, 200, html, "text/html; charset=utf-8")
                return

            if parsed.path == "/api/storage/oauth/callback":
                html = handle_storage_oauth_callback(query).encode("utf-8")
                write_response(self, 200, html, "text/html; charset=utf-8")
                return

            if parsed.path == "/oauth2redirect":
                oauth_state = str(query.get("state", [""])[0] or "")
                with STATE.lock:
                    is_storage_state = oauth_state in STATE.storage_oauth_states
                html = (
                    handle_storage_oauth_callback(query)
                    if is_storage_state
                    else handle_youtube_oauth_callback(query)
                ).encode("utf-8")
                write_response(self, 200, html, "text/html; charset=utf-8")
                return

            if parsed.path == "/api/youtube/broadcasts":
                config_name = safe_config_name(query.get("config", [DEFAULT_CONFIG])[0])
                account_id = str(query.get("account", [""])[0] or "").strip() or None
                update_request_trace(self, config_name=config_name)
                json_response(self, youtube_broadcasts(config_name, account_id))
                return

            if parsed.path == "/api/youtube/live-chat":
                config_name = safe_config_name(query.get("config", [DEFAULT_CONFIG])[0])
                channel_name = str(query.get("channel", [""])[0] or "").strip()
                page_token = str(query.get("pageToken", [""])[0] or "").strip()
                update_request_trace(self, config_name=config_name, channel_name=channel_name)
                json_response(self, youtube_live_chat(config_name, channel_name, page_token))
                return

            if parsed.path == "/api/youtube/verify-channel-keys":
                config_name = safe_config_name(query.get("config", [DEFAULT_CONFIG])[0])
                channel_name = str(query.get("channel", [""])[0] or "").strip() or None
                update_request_trace(self, config_name=config_name, channel_name=channel_name)
                json_response(self, verify_youtube_channel_keys(config_name, channel_name))
                return

            if parsed.path == "/api/config":
                config_name = safe_config_name(query.get("config", [DEFAULT_CONFIG])[0])
                update_request_trace(self, config_name=config_name)
                path = ROOT / config_name
                if not path.exists():
                    text_response(self, "", 404)
                    return
                text_response(self, path.read_text(encoding="utf-8"))
                return

            if parsed.path == "/api/raw-files":
                config_name = safe_config_name(query.get("config", [DEFAULT_CONFIG])[0])
                channel = query.get("channel", [""])[0] or None
                update_request_trace(self, config_name=config_name, channel_name=channel)
                json_response(self, {"files": raw_video_files(config_name, channel)})
                return

            if parsed.path == "/api/normalized-files":
                config_name = safe_config_name(query.get("config", [DEFAULT_CONFIG])[0])
                channel = query.get("channel", [""])[0] or None
                update_request_trace(self, config_name=config_name, channel_name=channel)
                json_response(self, {"files": normalized_video_files(config_name, channel)})
                return

            if parsed.path == "/api/video-thumbnail":
                config_name = safe_config_name(query.get("config", [DEFAULT_CONFIG])[0])
                channel = query.get("channel", [""])[0] or None
                requested_path = query.get("path", [""])[0] or ""
                update_request_trace(self, config_name=config_name, channel_name=channel)
                thumbnail = video_thumbnail(config_name, channel, requested_path)
                write_response(
                    self,
                    200,
                    thumbnail.read_bytes(),
                    "image/jpeg",
                    {"Cache-Control": "public, max-age=86400"},
                )
                return

            path = WEB_ROOT / ("index.html" if parsed.path == "/" else parsed.path.lstrip("/"))
            path = path.resolve()
            if not str(path).startswith(str(WEB_ROOT.resolve())) or not path.exists():
                text_response(self, "Not found", 404)
                return
            data = path.read_bytes()
            write_response(self, 200, data, content_type(path))
        except Exception as exc:
            attach_request_error(self, exc)
            if is_client_disconnect_error(exc):
                return
            try:
                status_code = 400 if isinstance(exc, ValueError) else 500
                json_response(self, {"error": str(exc)}, status_code)
            except Exception as write_exc:
                if not is_client_disconnect_error(write_exc):
                    print(f"[ui] error response failed: {write_exc}")

    def do_POST(self) -> None:
        begin_request_trace(self, "POST", self.path)
        parsed = urlparse(self.path)
        try:
            query = parse_qs(parsed.query)
            update_request_trace(
                self,
                query_keys=sorted(query.keys()),
                raw_config=str(query.get("config", [""])[0] or ""),
                channel_name=str(query.get("channel", [""])[0] or "").strip() or None,
            )
            if parsed.path == "/api/raw-files/upload":
                json_response(self, upload_raw_video(self, query))
                return

            if parsed.path == "/api/normalized-files/upload":
                json_response(self, upload_normalized_video(self, query))
                return

            if parsed.path == "/api/youtube/thumbnail":
                json_response(self, upload_youtube_thumbnail(self, query))
                return

            body = read_body(self)
            body_map = body if isinstance(body, dict) else {}
            update_request_trace(
                self,
                body_keys=sorted(body_map.keys()),
                raw_config=str(body_map.get("config") or ""),
                channel_name=str(body_map.get("channel") or "").strip() or None,
                task_action=str(body_map.get("action") or "").strip() or None,
            )
            body = body_map
            config_name = safe_config_name(body_map.get("config"))
            update_request_trace(self, config_name=config_name)

            if parsed.path == "/api/raw-files/import":
                json_response(self, import_raw_videos(body))
                return

            if parsed.path == "/api/normalized-files/import":
                json_response(self, import_normalized_videos(body))
                return

            if parsed.path == "/api/config/create":
                target = ROOT / config_name
                if not target.exists():
                    shutil.copyfile(runtime_paths.template_path("config.example.json"), target)
                config, _error = load_config_or_none(config_name)
                if config:
                    ensure_media_folders(config)
                json_response(self, {"ok": True, "config": config_name})
                return

            if parsed.path == "/api/config/save":
                text = str(body.get("text", ""))
                parsed_json = json.loads(text)
                save_config(config_name, parsed_json)
                json_response(self, {"ok": True, "config": config_name})
                return

            if parsed.path == "/api/transfer/export":
                json_response(self, create_transfer_package(body))
                return

            if parsed.path == "/api/transfer/import":
                json_response(self, import_transfer_package(body))
                return

            if parsed.path == "/api/sync/register":
                json_response(self, create_sync_account(body))
                return

            if parsed.path == "/api/sync/login":
                json_response(self, login_sync_account(body))
                return

            if parsed.path == "/api/sync/pairing/start":
                json_response(self, start_sync_pairing(config_name, body))
                return

            if parsed.path == "/api/sync/device/disconnect":
                json_response(self, disconnect_sync_device(body))
                return

            if parsed.path == "/api/youtube/disconnect":
                config, error = load_config_or_none(config_name)
                if not config:
                    raise ValueError(error or "Config not found.")
                account_id = normalize_account_id(body.get("account") or "")
                if not account_id:
                    raise ValueError("YouTube account slot is required.")
                account = find_youtube_account(config, account_id)
                if not account:
                    raise ValueError(f"Unknown YouTube account slot: {account_id}")
                scoped_config = account_config_view(config, account)
                youtube_service.clear_tokens(ROOT, scoped_config)
                account["channel_id"] = ""
                account["channel_title"] = ""
                account["channel_handle"] = ""
                account["subscriber_count"] = ""
                account["hidden_subscriber_count"] = False
                save_config(config_name, config)
                json_response(self, {"ok": True, "config": config_name, "account_id": account_id})
                return

            if parsed.path == "/api/storage/disconnect":
                provider_id = str(body.get("provider") or "").strip()
                if not provider_id:
                    raise ValueError("Storage provider is required.")
                json_response(self, disconnect_storage_provider(config_name, provider_id))
                return

            if parsed.path == "/api/storage/video/prepare":
                provider_id = str(body.get("provider") or "").strip()
                file_id = str(body.get("file_id") or body.get("provider_file_id") or body.get("providerFileId") or "").strip()
                if not provider_id:
                    raise ValueError("Storage provider is required.")
                if not file_id:
                    raise ValueError("Storage file ID is required.")
                json_response(self, prepare_storage_video(config_name, provider_id, file_id))
                return

            if parsed.path == "/api/youtube/schedule":
                json_response(self, schedule_youtube(config_name, body))
                return

            if parsed.path == "/api/youtube/use-broadcast":
                json_response(self, use_existing_youtube_broadcast(config_name, body))
                return

            if parsed.path == "/api/youtube/live-chat/send":
                json_response(self, send_youtube_live_chat(config_name, body))
                return

            if parsed.path == "/api/channel/youtube-auto":
                config, error = load_config_or_none(config_name)
                if not config:
                    raise ValueError(error or "Config not found.")
                channel_name = str(body.get("channel", ""))
                updated = False
                for channel in config.get("channels", []):
                    if channel.get("name") == channel_name:
                        channel["youtube_auto_start"] = bool(body.get("auto_start", True))
                        channel["youtube_auto_stop"] = bool(body.get("auto_stop", True))
                        if "dual_stream" in body:
                            channel["youtube_dual_stream"] = bool(body.get("dual_stream", True))
                        if "studio_url" in body:
                            channel["youtube_studio_url"] = str(body.get("studio_url") or "")
                        updated = True
                        break
                if not updated:
                    raise ValueError(f"Unknown channel: {channel_name}")
                save_config(config_name, config)
                json_response(self, {"ok": True, "config": config_name, "channel": channel_name})
                return

            if parsed.path == "/api/task/start":
                action = str(body.get("action", ""))
                channel = body.get("channel") or None
                update_request_trace(self, channel_name=channel, task_action=action)
                start_index = max(1, int(body.get("start_index") or 1))
                task = start_task(action, config_name, channel, bool(body.get("force")), start_index)
                json_response(self, {"ok": True, "task": task.as_dict()})
                return

            if parsed.path == "/api/task/stop":
                stopped = stop_task(
                    str(body.get("task_id") or "") or None,
                    body.get("channel") or None,
                    body.get("action") or None,
                )
                json_response(self, {"ok": True, "stopped": stopped})
                return

            if parsed.path == "/api/channel/streams/add":
                json_response(self, add_channel_stream_api(config_name, body))
                return

            if parsed.path == "/api/channel/streams/delete":
                json_response(self, delete_channel_stream_api(config_name, body))
                return

            if parsed.path == "/api/channel/streams/save":
                json_response(self, save_channel_streams_api(config_name, body))
                return

            if parsed.path == "/api/channel/streams/refresh-stats":
                channel_name = str(body.get("channel") or "").strip()
                json_response(self, get_channel_streams_api(config_name, channel_name, fetch_stats=True))
                return

            if parsed.path == "/api/stream/start":
                update_request_trace(self, channel_name=body.get("channel") or None)
                assert_youtube_channel_keys_match(config_name, body.get("channel") or None)
                channel_name = body.get("channel") or None
                stream_id = body.get("stream_id") or None
                started = start_stream(config_name, channel_name, stream_id=stream_id)
                json_response(self, {"ok": True, "started": started})
                return

            if parsed.path == "/api/stream/stop":
                update_request_trace(self, channel_name=body.get("channel") or None)
                channel = body.get("channel") or None
                stream_id = body.get("stream_id") or None
                stopped = stop_stream(
                    channel,
                    stream_id=stream_id,
                    request_source="api_stream_stop",
                    request_reason=(
                        f"HTTP /api/stream/stop for {channel} stream {stream_id}"
                        if channel and stream_id
                        else f"HTTP /api/stream/stop for {channel}"
                        if channel
                        else "HTTP /api/stream/stop with no channel; stop all streams"
                    ),
                )
                json_response(self, {"ok": True, "stopped": stopped})
                return

            if parsed.path == "/api/preview/start":
                update_request_trace(self, channel_name=body.get("channel") or None)
                preview = start_preview(config_name, body.get("channel") or None)
                json_response(self, {"ok": True, "preview": preview})
                return

            if parsed.path == "/api/preview/stop":
                update_request_trace(self, channel_name=body.get("channel") or None)
                stopped_preview = stop_preview(body.get("channel") or None)
                json_response(self, {"ok": True, "stopped": stopped_preview})
                return

            if parsed.path == "/api/activity/clear":
                preserve_running_tasks = bool(body.get("preserve_running_tasks", True))
                channel_name = str(body.get("channel") or "").strip() or None
                update_request_trace(self, config_name=config_name, channel_name=channel_name)
                cleared = clear_activity_logs(config_name, preserve_running_tasks, channel_name)
                json_response(
                    self,
                    {
                        "ok": True,
                        "cleared_tasks": cleared["tasks"],
                        "cleared_events": cleared["events"],
                        "preserve_running_tasks": preserve_running_tasks,
                        "channel": channel_name,
                    },
                )
                return

            if parsed.path == "/api/system/shutdown":
                stop_streams = bool(body.get("stop_streams", True))
                stop_tasks_requested = bool(body.get("stop_tasks", True))
                STATE.stop_event.set()
                stopped_streams = (
                    stop_stream(
                        None,
                        request_source="system_shutdown",
                        request_reason="HTTP /api/system/shutdown requested stop_streams",
                    )
                    if stop_streams
                    else []
                )
                if stop_tasks_requested:
                    shutdown_tasks()
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                json_response(
                    self,
                    {
                        "ok": True,
                        "stopped_streams": stopped_streams,
                        "stopped_tasks": stop_tasks_requested,
                        "shutting_down": True,
                    },
                )
                return

            json_response(self, {"error": "Not found"}, 404)
        except Exception as exc:
            attach_request_error(self, exc)
            if is_client_disconnect_error(exc):
                return
            try:
                status_code = 400 if isinstance(exc, ValueError) else 500
                json_response(self, {"error": str(exc)}, status_code)
            except Exception as write_exc:
                if not is_client_disconnect_error(write_exc):
                    print(f"[ui] error response failed: {write_exc}")


def shutdown_streams() -> None:
    with STATE.lock:
        streams = list(STATE.streams.values())
        preview = STATE.preview
        STATE.preview = None
        proxy = STATE.cloud_proxy
        STATE.cloud_proxy = None
        STATE.cloud_proxy_settings = {}
    if preview:
        request_stop_running_stream(preview.running, source="backend_shutdown", reason="backend shutdown")
        if preview.running.preview_manifest:
            stream_manager.clear_directory(preview.running.preview_manifest.parent)
    for state in streams:
        request_stop_running_stream(state.running, source="backend_shutdown", reason="backend shutdown")
        unregister_cloud_assets(state.cloud_asset_ids)
    if proxy:
        proxy.stop()


def shutdown_tasks() -> None:
    with STATE.lock:
        tasks = list(STATE.tasks)
    for task in tasks:
        task.stop()


def main() -> int:
    global DEFAULT_CONFIG, UI_PORT
    runtime_paths.ensure_data_root()
    migrated = runtime_paths.migrate_legacy_layout()
    if migrated:
        print(f"Migrated legacy app data: {', '.join(migrated)}")
    DEFAULT_CONFIG = runtime_paths.default_config_name()
    app_db.init_db()
    for config_name in available_configs():
        config, _error = load_config_or_none(config_name)
        if config:
            app_db.sync_config(config_name, config, "startup")
    load_stream_cycle_runtime()

    port = int(os.environ.get("STREAM_UI_PORT", "8765"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    UI_PORT = int(server.server_address[1])
    if os.environ.get("CASTARRO_SYNC_AUTO_START") == "1":
        ensure_sync_server_running()
    STATE.stop_event.clear()
    automation_thread = threading.Thread(target=automation_loop, daemon=True)
    automation_thread.start()

    def handle_stop(_signum: int, _frame: Any) -> None:
        print("\nStopping UI, tasks, and streams...")
        STATE.stop_event.set()
        shutdown_tasks()
        shutdown_streams()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, handle_stop)
    signal.signal(signal.SIGTERM, handle_stop)

    print(f"Castarro UI running at http://127.0.0.1:{UI_PORT}")
    if not SYNC_PORT:
        print("Castarro device sync will start when QR pairing is requested.")
    print("Press Ctrl+C to stop the UI and any streams started from it.")
    try:
        server.serve_forever()
    finally:
        STATE.stop_event.set()
        stop_sync_server()
        shutdown_tasks()
        shutdown_streams()
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
