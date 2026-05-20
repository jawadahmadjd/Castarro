"""Runtime paths shared by the local CLI and Electron-packaged app."""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path
from typing import Any


CODE_ROOT = Path(os.environ.get("STREAM_APP_CODE_DIR", Path(__file__).resolve().parent.parent)).resolve()
DATA_ROOT = Path(os.environ.get("STREAM_APP_DATA_DIR", CODE_ROOT)).resolve()
WEB_ROOT = Path(os.environ.get("STREAM_WEB_ROOT", CODE_ROOT / "web")).resolve()

MUTABLE_DIRECTORIES = [
    ".runtime",
    "Raw Videos",
    "Go Live",
    "logs",
    "playlists",
]
MUTABLE_FILES = [
    "config.json",
    "config.ready.json",
    "stream_control.db",
]


def ensure_data_root() -> None:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    for name in MUTABLE_DIRECTORIES:
        (DATA_ROOT / name).mkdir(parents=True, exist_ok=True)


def bundled_binary_path(name: str) -> str | None:
    env_name = "STREAM_FFMPEG_PATH" if name == "ffmpeg" else "STREAM_FFPROBE_PATH"
    configured = os.environ.get(env_name)
    if configured:
        path = Path(configured).resolve()
        if path.exists():
            return str(path)

    exe_name = f"{name}.exe" if os.name == "nt" else name
    candidates = [
        CODE_ROOT / "resources" / "ffmpeg" / exe_name,
        CODE_ROOT / "desktop" / "resources" / "ffmpeg" / exe_name,
        CODE_ROOT / "ffmpeg" / exe_name,
    ]
    for path in candidates:
        if path.exists():
            return str(path.resolve())
    return None


def apply_runtime_defaults(config: dict[str, Any]) -> dict[str, Any]:
    defaults = config.setdefault("defaults", {})
    ffmpeg = bundled_binary_path("ffmpeg")
    ffprobe = bundled_binary_path("ffprobe")
    if ffmpeg:
        defaults["ffmpeg_path"] = ffmpeg
    elif not defaults.get("ffmpeg_path"):
        defaults["ffmpeg_path"] = "ffmpeg"

    if ffprobe:
        defaults["ffprobe_path"] = ffprobe
    elif not defaults.get("ffprobe_path"):
        defaults["ffprobe_path"] = "ffprobe"
    return config


def runtime_binary_status() -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for name in ("ffmpeg", "ffprobe"):
        path = bundled_binary_path(name)
        result[name] = {
            "path": path or name,
            "bundled": bool(path),
            "exists": bool(path and Path(path).exists()) or shutil.which(name) is not None,
        }
    return result


def template_path(name: str) -> Path:
    return CODE_ROOT / name


def migrate_legacy_layout() -> list[str]:
    """Copy existing mutable files into app-data on first Electron launch."""
    ensure_data_root()
    migrated: list[str] = []
    legacy_env = os.environ.get("STREAM_LEGACY_ROOT")
    if not legacy_env:
        return migrated

    legacy_root = Path(legacy_env).resolve()
    if not legacy_root.exists() or legacy_root == DATA_ROOT:
        return migrated

    marker = DATA_ROOT / ".electron-migration-complete"
    if marker.exists():
        return migrated

    for name in MUTABLE_FILES:
        source = legacy_root / name
        target = DATA_ROOT / name
        if source.exists() and not target.exists():
            shutil.copy2(source, target)
            migrated.append(name)

    for name in MUTABLE_DIRECTORIES:
        source = legacy_root / name
        target = DATA_ROOT / name
        if source.exists() and source.is_dir() and not any(target.iterdir()):
            shutil.copytree(source, target, dirs_exist_ok=True)
            migrated.append(name)

    marker.write_text(json.dumps({"migrated": migrated}, indent=2) + "\n", encoding="utf-8")
    return migrated


def default_config_name() -> str:
    return "config.ready.json" if (DATA_ROOT / "config.ready.json").exists() else "config.json"
