#!/usr/bin/env python3
"""Small local web UI for the FFmpeg multi-stream tools."""

from __future__ import annotations

import json
import hashlib
import os
import re
import secrets
import shutil
import signal
import subprocess
import sys
import threading
import time
import traceback
import unicodedata
from collections import deque
from difflib import SequenceMatcher
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote, unquote, urlparse

import app_db
import runtime_paths
import stream_manager
import youtube_service


ROOT = runtime_paths.DATA_ROOT
CODE_ROOT = runtime_paths.CODE_ROOT
WEB_ROOT = runtime_paths.WEB_ROOT
DEFAULT_CONFIG = runtime_paths.default_config_name()
VIDEO_EXTENSIONS = {".mp4", ".m4v", ".mov", ".flv", ".mkv"}
THUMBNAIL_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".bmp"}
THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024
YOUTUBE_CHANNEL_NAME_MATCH_THRESHOLD = 0.80


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
        "current": 0,
        "total": 0,
        "status": "running" if running else "success" if returncode == 0 else "failed",
        "message": "Starting...",
    }

    for line in lines:
        if line.startswith("HEADS-UP "):
            progress["message"] = line
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
            if progress["total"]:
                progress["percent"] = int(((progress["current"] - 1) / progress["total"]) * 100)
            continue

        progress_match = re.search(r"^PROGRESS file=(\d+) total=(\d+) percent=(\d+)", line)
        if progress_match:
            current = int(progress_match.group(1))
            total = int(progress_match.group(2))
            file_percent = int(progress_match.group(3))
            progress["current"] = current
            progress["total"] = total
            progress["percent"] = int((((current - 1) + (file_percent / 100)) / total) * 100) if total else file_percent
            continue

    if not running:
        progress["percent"] = 100 if returncode == 0 else progress["percent"]
        if returncode == 0:
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
        if self.name == "normalize" and self.returncode == 0:
            config, _error = load_config_or_none(self.config_name)
            if config:
                app_db.sync_config(self.config_name, config)

    def stop(self) -> None:
        if self.process.poll() is not None:
            return
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
            "lines": lines,
            "progress": task_progress(self.name, self.channel_name, lines, running, returncode),
        }


class StreamState:
    def __init__(self, config_name: str, running: stream_manager.RunningStream) -> None:
        self.config_name = config_name
        self.running = running
        self.started_at = time.time()
        self.log_path = Path(running.log_handle.name)

    def as_dict(self) -> dict[str, Any]:
        process = self.running.process
        channel_name = str(self.running.channel.get("name") or "")
        preview_manifest = self.running.preview_manifest
        return {
            "name": channel_name,
            "pid": process.pid,
            "running": process.poll() is None,
            "returncode": process.returncode,
            "started_at": self.started_at,
            "log_path": str(self.log_path),
            "log_tail": tail_file(self.log_path),
            "preview_url": f"/preview/{quote(channel_name, safe='')}/index.m3u8" if preview_manifest else None,
            "preview_ready": bool(preview_manifest and preview_manifest.exists()),
            "preview_warning": self.running.preview_warning,
        }


class AppState:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.streams: dict[str, StreamState] = {}
        self.tasks: deque[Task] = deque(maxlen=20)
        self.youtube_oauth_states: dict[str, dict[str, Any]] = {}


STATE = AppState()


def is_client_disconnect_error(exc: BaseException) -> bool:
    if isinstance(exc, (BrokenPipeError, ConnectionAbortedError, ConnectionResetError)):
        return True
    if isinstance(exc, OSError):
        return getattr(exc, "winerror", None) in {10053, 10054, 995}
    return False


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
    if path.parent != ROOT or path.suffix.lower() != ".json":
        raise ValueError("Config must be a JSON file in the project root.")
    return path.name


def load_config_or_none(config_name: str) -> tuple[dict[str, Any] | None, str | None]:
    path = ROOT / config_name
    if not path.exists():
        return None, f"{config_name} does not exist yet."
    try:
        with path.open("r", encoding="utf-8-sig") as fh:
            config = runtime_paths.apply_runtime_defaults(json.load(fh))
            normalize_ui_settings(config)
            normalize_youtube_accounts(config)
            return config, None
    except Exception as exc:
        return None, str(exc)


def save_config(config_name: str, config: dict[str, Any]) -> None:
    normalize_ui_settings(config)
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
    app_db.sync_config(config_name, config, "save")


def normalize_ui_settings(config: dict[str, Any]) -> dict[str, Any]:
    raw = config.get("ui")
    ui = dict(raw) if isinstance(raw, dict) else {}
    ui["channel_workspace_enabled"] = bool(ui.get("channel_workspace_enabled", True))
    ui["legacy_tabs_enabled"] = ui.get("legacy_tabs_enabled", True) is not False
    config["ui"] = ui
    return ui


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


def connected_account_slots(config: dict[str, Any]) -> list[dict[str, Any]]:
    connected: list[dict[str, Any]] = []
    for account in normalize_youtube_accounts(config):
        try:
            scoped_config = account_config_view(config, account)
            tokens = youtube_service.load_tokens(ROOT, scoped_config)
            if not tokens:
                continue
            access_token, _valid_tokens = youtube_service.valid_access_token(ROOT, scoped_config)
            profile = youtube_service.connected_account_profile(access_token)
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


def channel_account_id(config: dict[str, Any], channel: dict[str, Any]) -> str:
    return normalize_account_id(channel.get("youtube_account_id") or "")


def resolve_channel_account_for_action(config: dict[str, Any], channel: dict[str, Any]) -> tuple[str, str]:
    explicit = normalize_account_id(channel.get("youtube_account_id") or "")
    if explicit:
        return explicit, ""

    connected = connected_account_slots(config)
    if len(connected) > 1:
        return "", "missing_linked_account_multiple_connected"
    accounts = normalize_youtube_accounts(config)
    if len(accounts) > 1:
        return "", "missing_linked_account_multiple_slots"
    return "", "missing_linked_account"


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
            profile = youtube_service.connected_account_profile(access_token)
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
        "redirect_uri": settings.get("redirect_uri"),
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


def cleanup_expired_oauth_states() -> None:
    now = time.time()
    with STATE.lock:
        stale = [
            key
            for key, payload in STATE.youtube_oauth_states.items()
            if now - float(payload.get("created_at") or 0) > 20 * 60
        ]
        for key in stale:
            STATE.youtube_oauth_states.pop(key, None)


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
        }
    return {
        "ok": True,
        "state": oauth_state,
        "account_id": str(account.get("id") or ""),
        "url": youtube_service.build_auth_url(config, oauth_state, code_challenge=code_challenge or None),
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
    <style>
      body {{ font-family: Segoe UI, Tahoma, sans-serif; margin: 0; background: #f6f2e9; color: #25231e; }}
      .shell {{ max-width: 520px; margin: 36px auto; background: #fffaf0; border: 1px solid #ded5c6; border-radius: 18px; padding: 20px; }}
      h1 {{ margin: 0 0 8px; font-size: 1.2rem; }}
      p {{ margin: 0 0 12px; color: #555046; }}
    </style>
  </head>
  <body>
    <main class="shell">
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
        youtube_service.exchange_code_for_tokens(ROOT, scoped_config, auth_code, code_verifier=code_verifier)
        access_token, _tokens = youtube_service.valid_access_token(ROOT, scoped_config)
        profile = youtube_service.connected_account_profile(access_token)
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
        connected = connected_account_slots(config)
        if connected:
            target = find_youtube_account(config, str(connected[0].get("id") or ""))
        if not target:
            target = accounts[0]

    scoped_config = account_config_view(config, target)
    access_token, _tokens = youtube_service.valid_access_token(ROOT, scoped_config)
    profile = youtube_service.connected_account_profile(access_token)
    mismatch_message = youtube_profile_mismatch_message(youtube_account_expected_channel_name(config, target), profile)
    if mismatch_message:
        raise ValueError(mismatch_message)
    return {
        "ok": True,
        "account_id": str(target.get("id") or ""),
        "broadcasts": youtube_service.list_upcoming_broadcasts(access_token),
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
        stream_by_id = youtube_service.live_stream_by_id(access_token, configured_stream_id)
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
                profile = youtube_service.connected_account_profile(access_token)
                connected_profiles[mapped_account_id] = {
                    "channel_id": str(profile.get("channel_id") or ""),
                    "channel_title": str(profile.get("channel_title") or ""),
                    "channel_handle": str(profile.get("channel_handle") or ""),
                    "subscriber_count": str(profile.get("subscriber_count") or ""),
                    "hidden_subscriber_count": bool(profile.get("hidden_subscriber_count")),
                }
                mine_streams = youtube_service.list_mine_live_streams(access_token)
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
    if not connected_account_slots(config):
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
    account_id, guard_reason = resolve_channel_account_for_action(config, selected_channel or {})
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
    profile = youtube_service.connected_account_profile(access_token)
    mismatch_message = youtube_profile_mismatch_message(channel_name or youtube_account_expected_channel_name(config, account), profile)
    if mismatch_message:
        raise ValueError(mismatch_message)
    created = youtube_service.schedule_broadcast(
        access_token,
        title=title,
        description=description,
        scheduled_start_time=scheduled_start_time,
        scheduled_end_time=scheduled_end_time,
        privacy_status=privacy_status,
        auto_start=auto_start,
        auto_stop=auto_stop,
    )

    if selected_channel:
        stream_name = str(created.get("stream", {}).get("stream_name") or "").strip()
        if stream_name:
            selected_channel["stream_key_env"] = stream_name
        selected_channel["youtube_account_id"] = account_id
        selected_channel["youtube_auto_start"] = auto_start
        selected_channel["youtube_auto_stop"] = auto_stop
        selected_channel["youtube_studio_url"] = created.get("broadcast", {}).get("studio_url", "")
        selected_channel["youtube_broadcast_id"] = created.get("broadcast", {}).get("id", "")
        selected_channel["youtube_stream_id"] = created.get("stream", {}).get("id", "")
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
    account_id, guard_reason = resolve_channel_account_for_action(config, selected_channel)
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
    profile = youtube_service.connected_account_profile(access_token)
    mismatch_message = youtube_profile_mismatch_message(channel_name or youtube_account_expected_channel_name(config, account), profile)
    if mismatch_message:
        raise ValueError(mismatch_message)

    broadcasts = youtube_service.list_upcoming_broadcasts(access_token, limit=50)
    broadcast = next((item for item in broadcasts if str(item.get("id") or "") == broadcast_id), None)
    if not broadcast:
        raise ValueError("That upcoming YouTube broadcast was not found on the linked account.")
    stream_name = str(broadcast.get("stream_name") or "").strip()
    if not stream_name:
        raise ValueError("That YouTube broadcast does not have a bound stream key yet.")

    selected_channel["stream_key_env"] = stream_name
    selected_channel["youtube_account_id"] = account_id
    if isinstance(broadcast.get("auto_start"), bool):
        selected_channel["youtube_auto_start"] = bool(broadcast.get("auto_start"))
    if isinstance(broadcast.get("auto_stop"), bool):
        selected_channel["youtube_auto_stop"] = bool(broadcast.get("auto_stop"))
    selected_channel["youtube_studio_url"] = str(broadcast.get("studio_url") or "")
    selected_channel["youtube_broadcast_id"] = broadcast_id
    selected_channel["youtube_stream_id"] = str(broadcast.get("bound_stream_id") or "")
    save_config(config_name, config)

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


def raw_video_files(config_name: str, channel_name: str | None) -> list[dict[str, str]]:
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
            if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS
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
    return [
        {
            "name": path.name,
            "path": relative_or_absolute(path),
            "folder": relative_or_absolute(path.parent),
        }
        for path in files
    ]


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
                    if path.suffix.lower() in VIDEO_EXTENSIONS:
                        files_by_path[relative_or_absolute(path)] = path
            break

    files = [files_by_path[key] for key in sorted(files_by_path)]
    return [
        {
            "name": path.name,
            "path": relative_or_absolute(path),
            "folder": relative_or_absolute(path.parent),
            "exists": path.exists(),
        }
        for path in files
    ]


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
        if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS
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
    return sorted(path.name for path in ROOT.glob("*.json") if path.is_file())


def task_command(action: str, config_name: str, channel: str | None, force: bool) -> list[str]:
    python = sys.executable
    if action == "validate":
        command = [python, str(CODE_ROOT / "scripts" / "validate_media.py"), "--config", config_name]
    elif action == "normalize":
        command = [python, str(CODE_ROOT / "scripts" / "normalize_media.py"), "--config", config_name]
        if force:
            command.append("--force")
    elif action == "test-stream":
        if not channel:
            raise ValueError("Test stream requires a channel.")
        command = [python, str(CODE_ROOT / "scripts" / "test_stream.py"), "--config", config_name, "--channel", channel]
    else:
        raise ValueError(f"Unsupported task: {action}")

    if channel and action != "test-stream":
        command += ["--channel", channel]
    return command


def start_task(action: str, config_name: str, channel: str | None, force: bool) -> Task:
    task = Task(action, task_command(action, config_name, channel, force), config_name, channel)
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


def clear_activity_logs(config_name: str, preserve_running_tasks: bool = True) -> dict[str, int]:
    removed_task_count = 0
    with STATE.lock:
        retained: deque[Task] = deque(maxlen=STATE.tasks.maxlen)
        for task in list(STATE.tasks):
            if task.config_name != config_name:
                retained.append(task)
                continue
            if preserve_running_tasks and task.process.poll() is None:
                retained.append(task)
                continue
            removed_task_count += 1
        STATE.tasks = retained

    removed_event_count = app_db.clear_app_events(config_name, include_global=True)
    return {"tasks": removed_task_count, "events": removed_event_count}


def start_stream(config_name: str, channel_name: str | None) -> list[str]:
    config, config_dir = stream_manager.load_config((ROOT / config_name).resolve())
    channels = stream_manager.enabled_channels(config, channel_name)
    started: list[str] = []
    with STATE.lock:
        for channel in channels:
            name = str(channel["name"])
            existing = STATE.streams.get(name)
            if existing and existing.running.process.poll() is None:
                continue
            preview_manifest = stream_manager.preview_manifest_path(config_dir, config, channel)
            running = stream_manager.start_stream(
                config_dir,
                config,
                channel,
                preview_manifest=preview_manifest,
            )
            STATE.streams[name] = StreamState(config_name, running)
            app_db.record_stream_start(
                config_name,
                name,
                running.process.pid,
                subprocess.list2cmdline(running.command),
                str(Path(running.log_handle.name)),
            )
            app_db.record_event("stream_started", config_name, name, {"pid": running.process.pid})
            started.append(name)
    return started


def stop_stream(channel_name: str | None) -> list[str]:
    stopped: list[str] = []
    with STATE.lock:
        targets = [channel_name] if channel_name else list(STATE.streams.keys())
        for name in targets:
            if not name:
                continue
            state = STATE.streams.get(name)
            if not state:
                continue
            stream_manager.stop_stream(state.running)
            if state.running.preview_manifest:
                stream_manager.clear_directory(state.running.preview_manifest.parent)
            app_db.record_stream_stop(state.config_name, name, state.running.process.returncode)
            app_db.record_event("stream_stopped", state.config_name, name, {"returncode": state.running.process.returncode})
            stopped.append(name)
    return stopped


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


def status_payload(config_name: str) -> dict[str, Any]:
    config, error = load_config_or_none(config_name)
    if config:
        ensure_media_folders(config)
    channels = config.get("channels", []) if config else []
    with STATE.lock:
        streams = {name: state.as_dict() for name, state in STATE.streams.items()}
        tasks = [task.as_dict() for task in list(STATE.tasks)]

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
                "normalized_count": normalized_video_count(config, str(ch.get("name", ""))),
                "raw_playlist_count": len(ch.get("raw_playlist", [])) if isinstance(ch.get("raw_playlist"), list) else 0,
                "stream_key_env": ch.get("stream_key_env"),
                "stream_key_env_has_value": bool(os.environ.get(str(ch.get("stream_key_env") or ""))),
                "has_inline_key": bool(ch.get("stream_key")),
                "stream_key_masked": mask_secret(ch.get("stream_key")),
                "youtube_auto_start": bool(ch.get("youtube_auto_start", False)),
                "youtube_auto_stop": bool(ch.get("youtube_auto_stop", False)),
                "youtube_account_id": str(ch.get("youtube_account_id") or ""),
                "youtube_studio_url": ch.get("youtube_studio_url", ""),
            }
            for ch in channels
        ],
        "database": app_db.stats(),
        "binaries": runtime_paths.runtime_binary_status(),
        "streams": streams,
        "tasks": tasks,
        "activity_events": app_db.recent_app_events(config_name, limit=60),
    }


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
        stream_state = STATE.streams.get(channel_name)
        if not stream_state:
            return None
        manifest = stream_state.running.preview_manifest
    if not manifest:
        return None

    root = manifest.parent.resolve()
    target = (root / leaf).resolve()
    if not str(target).startswith(str(root)):
        return None
    return target


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[ui] {self.address_string()} - {fmt % args}")

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

            if parsed.path == "/api/status":
                config_name = safe_config_name(query.get("config", [DEFAULT_CONFIG])[0])
                update_request_trace(self, config_name=config_name)
                json_response(self, status_payload(config_name))
                return

            if parsed.path == "/api/youtube/status":
                config_name = safe_config_name(query.get("config", [DEFAULT_CONFIG])[0])
                update_request_trace(self, config_name=config_name)
                json_response(self, youtube_status(config_name))
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

            if parsed.path == "/oauth2redirect":
                html = handle_youtube_oauth_callback(query).encode("utf-8")
                write_response(self, 200, html, "text/html; charset=utf-8")
                return

            if parsed.path == "/api/youtube/broadcasts":
                config_name = safe_config_name(query.get("config", [DEFAULT_CONFIG])[0])
                account_id = str(query.get("account", [""])[0] or "").strip() or None
                update_request_trace(self, config_name=config_name)
                json_response(self, youtube_broadcasts(config_name, account_id))
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

            if parsed.path == "/api/youtube/schedule":
                json_response(self, schedule_youtube(config_name, body))
                return

            if parsed.path == "/api/youtube/use-broadcast":
                json_response(self, use_existing_youtube_broadcast(config_name, body))
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
                task = start_task(action, config_name, channel, bool(body.get("force")))
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

            if parsed.path == "/api/stream/start":
                update_request_trace(self, channel_name=body.get("channel") or None)
                assert_youtube_channel_keys_match(config_name, body.get("channel") or None)
                started = start_stream(config_name, body.get("channel") or None)
                json_response(self, {"ok": True, "started": started})
                return

            if parsed.path == "/api/stream/stop":
                update_request_trace(self, channel_name=body.get("channel") or None)
                stopped = stop_stream(body.get("channel") or None)
                json_response(self, {"ok": True, "stopped": stopped})
                return

            if parsed.path == "/api/activity/clear":
                preserve_running_tasks = bool(body.get("preserve_running_tasks", True))
                cleared = clear_activity_logs(config_name, preserve_running_tasks)
                json_response(
                    self,
                    {
                        "ok": True,
                        "cleared_tasks": cleared["tasks"],
                        "cleared_events": cleared["events"],
                        "preserve_running_tasks": preserve_running_tasks,
                    },
                )
                return

            if parsed.path == "/api/system/shutdown":
                stop_streams = bool(body.get("stop_streams", True))
                stop_tasks_requested = bool(body.get("stop_tasks", True))
                stopped_streams = stop_stream(None) if stop_streams else []
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
    for state in streams:
        stream_manager.stop_stream(state.running)


def shutdown_tasks() -> None:
    with STATE.lock:
        tasks = list(STATE.tasks)
    for task in tasks:
        task.stop()


def main() -> int:
    global DEFAULT_CONFIG
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

    port = int(os.environ.get("STREAM_UI_PORT", "8765"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)

    def handle_stop(_signum: int, _frame: Any) -> None:
        print("\nStopping UI, tasks, and streams...")
        shutdown_tasks()
        shutdown_streams()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, handle_stop)
    signal.signal(signal.SIGTERM, handle_stop)

    print(f"Castarro UI running at http://127.0.0.1:{port}")
    print("Press Ctrl+C to stop the UI and any streams started from it.")
    try:
        server.serve_forever()
    finally:
        shutdown_tasks()
        shutdown_streams()
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
