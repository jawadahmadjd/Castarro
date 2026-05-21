#!/usr/bin/env python3
"""Small local web UI for the FFmpeg multi-stream tools."""

from __future__ import annotations

import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote, unquote, urlparse

import app_db
import runtime_paths
import stream_manager


ROOT = runtime_paths.DATA_ROOT
CODE_ROOT = runtime_paths.CODE_ROOT
WEB_ROOT = runtime_paths.WEB_ROOT
DEFAULT_CONFIG = runtime_paths.default_config_name()
VIDEO_EXTENSIONS = {".mp4", ".m4v", ".mov", ".flv", ".mkv"}


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
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
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
        }


class AppState:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.streams: dict[str, StreamState] = {}
        self.tasks: deque[Task] = deque(maxlen=20)


STATE = AppState()


def is_client_disconnect_error(exc: BaseException) -> bool:
    if isinstance(exc, (BrokenPipeError, ConnectionAbortedError, ConnectionResetError)):
        return True
    if isinstance(exc, OSError):
        return getattr(exc, "winerror", None) in {10053, 10054, 995}
    return False


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
        if extra_headers:
            for key, value in extra_headers.items():
                handler.send_header(key, value)
        handler.end_headers()
        handler.wfile.write(body)
        return True
    except Exception as exc:
        if is_client_disconnect_error(exc):
            return False
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
            return runtime_paths.apply_runtime_defaults(json.load(fh)), None
    except Exception as exc:
        return None, str(exc)


def save_config(config_name: str, config: dict[str, Any]) -> None:
    trim_stream_key_fields(config)
    validate_stream_key_fields(config)
    target = ROOT / config_name
    target.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    ensure_media_folders(config)
    app_db.sync_config(config_name, config, "save")


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
                "youtube_studio_url": ch.get("youtube_studio_url", ""),
            }
            for ch in channels
        ],
        "database": app_db.stats(),
        "binaries": runtime_paths.runtime_binary_status(),
        "streams": streams,
        "tasks": tasks,
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
        parsed = urlparse(self.path)
        try:
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
                query = parse_qs(parsed.query)
                config_name = safe_config_name(query.get("config", [DEFAULT_CONFIG])[0])
                json_response(self, status_payload(config_name))
                return

            if parsed.path == "/api/config":
                query = parse_qs(parsed.query)
                config_name = safe_config_name(query.get("config", [DEFAULT_CONFIG])[0])
                path = ROOT / config_name
                if not path.exists():
                    text_response(self, "", 404)
                    return
                text_response(self, path.read_text(encoding="utf-8"))
                return

            if parsed.path == "/api/raw-files":
                query = parse_qs(parsed.query)
                config_name = safe_config_name(query.get("config", [DEFAULT_CONFIG])[0])
                channel = query.get("channel", [""])[0] or None
                json_response(self, {"files": raw_video_files(config_name, channel)})
                return

            if parsed.path == "/api/normalized-files":
                query = parse_qs(parsed.query)
                config_name = safe_config_name(query.get("config", [DEFAULT_CONFIG])[0])
                channel = query.get("channel", [""])[0] or None
                json_response(self, {"files": normalized_video_files(config_name, channel)})
                return

            path = WEB_ROOT / ("index.html" if parsed.path == "/" else parsed.path.lstrip("/"))
            path = path.resolve()
            if not str(path).startswith(str(WEB_ROOT.resolve())) or not path.exists():
                text_response(self, "Not found", 404)
                return
            data = path.read_bytes()
            write_response(self, 200, data, content_type(path))
        except Exception as exc:
            if is_client_disconnect_error(exc):
                return
            try:
                json_response(self, {"error": str(exc)}, 500)
            except Exception as write_exc:
                if not is_client_disconnect_error(write_exc):
                    print(f"[ui] error response failed: {write_exc}")

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/raw-files/upload":
                json_response(self, upload_raw_video(self, parse_qs(parsed.query)))
                return

            body = read_body(self)
            config_name = safe_config_name(body.get("config"))

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
                started = start_stream(config_name, body.get("channel") or None)
                json_response(self, {"ok": True, "started": started})
                return

            if parsed.path == "/api/stream/stop":
                stopped = stop_stream(body.get("channel") or None)
                json_response(self, {"ok": True, "stopped": stopped})
                return

            json_response(self, {"error": "Not found"}, 404)
        except Exception as exc:
            if is_client_disconnect_error(exc):
                return
            try:
                json_response(self, {"error": str(exc)}, 500)
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
