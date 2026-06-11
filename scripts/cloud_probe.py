"""Copy-mode compatibility probing for cloud source assets."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any


READY_MESSAGE = "Ready to stream"
DESKTOP_PREP_MESSAGE = "Open Castarro Desktop and normalize this video first."


def probe_cache_key(provider_id: str, provider_file_id: str, size_bytes: int, etag: str | None = None) -> str:
    return "|".join([provider_id, provider_file_id, str(size_bytes), etag or ""])


class CloudProbeCache:
    def __init__(self, path: Path) -> None:
        self.path = path

    def load(self) -> dict[str, Any]:
        try:
            if self.path.exists():
                payload = json.loads(self.path.read_text(encoding="utf-8"))
                return payload if isinstance(payload, dict) else {}
        except Exception:
            return {}
        return {}

    def get(self, key: str) -> dict[str, Any] | None:
        item = self.load().get(key)
        return item if isinstance(item, dict) else None

    def put(self, key: str, value: dict[str, Any]) -> None:
        payload = self.load()
        payload[key] = value
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def ffprobe_url(ffprobe_path: str, source_url: str) -> dict[str, Any]:
    command = [
        ffprobe_path or "ffprobe",
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        source_url,
    ]
    completed = subprocess.run(command, capture_output=True, text=True)
    if completed.returncode != 0:
        message = (completed.stderr or completed.stdout or "ffprobe failed").strip()
        raise RuntimeError(message)
    return json.loads(completed.stdout or "{}")


def report_from_ffprobe_payload(
    payload: dict[str, Any],
    *,
    display_name: str,
    source_uri: str,
    size_bytes: int,
    range_readable: bool,
) -> dict[str, Any]:
    streams = payload.get("streams") if isinstance(payload.get("streams"), list) else []
    video = next((item for item in streams if item.get("codec_type") == "video"), {})
    audio = next((item for item in streams if item.get("codec_type") == "audio"), {})
    fmt = payload.get("format") if isinstance(payload.get("format"), dict) else {}
    duration_seconds = _float_or_none(fmt.get("duration"))
    video_codec = str(video.get("codec_name") or "unknown").lower()
    audio_codec = str(audio.get("codec_name") or "unknown").lower()
    status, message = copy_mode_status(video_codec, audio_codec, range_readable)

    return {
        "displayName": display_name,
        "sourceUri": source_uri,
        "sizeBytes": int(size_bytes),
        "rangeReadable": bool(range_readable),
        "durationMs": int(duration_seconds * 1000) if duration_seconds is not None else 0,
        "container": str(fmt.get("format_name") or "unknown").split(",")[0],
        "videoCodec": video_codec,
        "audioCodec": audio_codec,
        "width": _int_or_none(video.get("width")),
        "height": _int_or_none(video.get("height")),
        "fps": _fps(video.get("avg_frame_rate") or video.get("r_frame_rate")),
        "pixelFormat": video.get("pix_fmt"),
        "audioSampleRate": _int_or_none(audio.get("sample_rate")),
        "audioChannels": _int_or_none(audio.get("channels")),
        "compatibilityStatus": status,
        "compatibilityMessage": message,
    }


def copy_mode_status(video_codec: str, audio_codec: str, range_readable: bool) -> tuple[str, str]:
    if not range_readable:
        return "blocked", "This provider does not support reliable range reads for this file."
    if video_codec not in {"h264", "avc"} or audio_codec not in {"aac"}:
        return "needsDesktopPrep", "This video is not H.264/AAC and cannot be streamed in copy mode."
    return "ready", READY_MESSAGE


def playlist_compatibility(reports: list[dict[str, Any]]) -> dict[str, Any]:
    if not reports:
        return {
            "compatibilityStatus": "blocked",
            "compatibilityMessage": "Select at least one cloud video first.",
            "blockingIssues": ["No cloud videos selected."],
        }

    blocking: list[str] = []
    signatures: list[tuple[Any, ...]] = []
    for report in reports:
        status = str(report.get("compatibilityStatus") or "unknown")
        if status != "ready":
            blocking.append(str(report.get("compatibilityMessage") or "Cloud video is not ready."))
        signatures.append(
            (
                report.get("videoCodec"),
                report.get("audioCodec"),
                report.get("width"),
                report.get("height"),
                report.get("fps"),
                report.get("audioSampleRate"),
                report.get("audioChannels"),
            )
        )

    if len(set(signatures)) > 1:
        blocking.append("This playlist mixes incompatible stream formats.")

    if blocking:
        return {
            "compatibilityStatus": "blocked",
            "compatibilityMessage": blocking[0],
            "blockingIssues": sorted(set(blocking)),
        }
    return {
        "compatibilityStatus": "ready",
        "compatibilityMessage": READY_MESSAGE,
        "blockingIssues": [],
    }


def _int_or_none(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _float_or_none(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _fps(value: Any) -> float | None:
    text = str(value or "").strip()
    if not text or text == "0/0":
        return None
    if "/" in text:
        numerator, denominator = text.split("/", 1)
        try:
            den = float(denominator)
            return None if den == 0 else round(float(numerator) / den, 3)
        except ValueError:
            return None
    return _float_or_none(text)
