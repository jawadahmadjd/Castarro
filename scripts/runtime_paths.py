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
YOUTUBE_OWNER_SEED_FILES = [
    "youtube.oauth.seed.json",
    "youtube-owner-oauth.json",
]
YOUTUBE_OWNER_FIELDS = [
    "client_id",
    "client_secret",
    "oauth_client_type",
    "use_pkce",
    "redirect_uri",
    "scopes",
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


def _read_json_file(path: Path) -> dict[str, Any] | None:
    try:
        if path.exists() and path.is_file():
            payload = json.loads(path.read_text(encoding="utf-8-sig"))
            return payload if isinstance(payload, dict) else None
    except Exception:
        return None
    return None


def _youtube_owner_settings_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    raw = payload.get("youtube") if isinstance(payload.get("youtube"), dict) else payload
    if not isinstance(raw, dict):
        return {}
    settings: dict[str, Any] = {}
    for field in YOUTUBE_OWNER_FIELDS:
        if field not in raw:
            continue
        value = raw.get(field)
        if isinstance(value, str):
            value = value.strip()
        if value in (None, ""):
            continue
        settings[field] = value
    return settings if settings.get("client_id") else {}


def _youtube_owner_settings_from_env() -> dict[str, Any]:
    client_id = (
        os.environ.get("STREAM_YOUTUBE_CLIENT_ID")
        or os.environ.get("CASTARRO_YOUTUBE_CLIENT_ID")
        or ""
    ).strip()
    if not client_id:
        return {}

    settings: dict[str, Any] = {"client_id": client_id}
    client_secret = (
        os.environ.get("STREAM_YOUTUBE_CLIENT_SECRET")
        or os.environ.get("CASTARRO_YOUTUBE_CLIENT_SECRET")
        or ""
    ).strip()
    if client_secret:
        settings["client_secret"] = client_secret

    oauth_client_type = (
        os.environ.get("STREAM_YOUTUBE_OAUTH_CLIENT_TYPE")
        or os.environ.get("CASTARRO_YOUTUBE_OAUTH_CLIENT_TYPE")
        or ""
    ).strip()
    if oauth_client_type:
        settings["oauth_client_type"] = oauth_client_type

    redirect_uri = (
        os.environ.get("STREAM_YOUTUBE_REDIRECT_URI")
        or os.environ.get("CASTARRO_YOUTUBE_REDIRECT_URI")
        or ""
    ).strip()
    if redirect_uri:
        settings["redirect_uri"] = redirect_uri
    return settings


def youtube_owner_seed_settings() -> dict[str, Any]:
    env_settings = _youtube_owner_settings_from_env()
    if env_settings:
        return env_settings

    candidates: list[Path] = []
    explicit = os.environ.get("STREAM_YOUTUBE_OAUTH_SEED")
    if explicit:
        candidates.append(Path(explicit).expanduser())

    roots: list[Path] = [DATA_ROOT]
    legacy_env = os.environ.get("STREAM_LEGACY_ROOT")
    if legacy_env:
        roots.append(Path(legacy_env).resolve())
    roots.extend(
        [
            CODE_ROOT / "resources" / "seed-data",
            CODE_ROOT / "desktop" / "resources" / "seed-data",
            CODE_ROOT,
        ]
    )
    for root in roots:
        for name in YOUTUBE_OWNER_SEED_FILES:
            candidates.append(root / name)

    seen: set[Path] = set()
    for candidate in candidates:
        path = candidate.resolve()
        if path in seen:
            continue
        seen.add(path)
        payload = _read_json_file(path)
        if not payload:
            continue
        settings = _youtube_owner_settings_from_payload(payload)
        if settings:
            return settings
    return {}


def apply_youtube_owner_seed(config: dict[str, Any]) -> bool:
    seed = youtube_owner_seed_settings()
    if not seed:
        return False

    youtube = config.setdefault("youtube", {})
    if not isinstance(youtube, dict):
        youtube = {}
        config["youtube"] = youtube

    changed = False
    for field, value in seed.items():
        current = youtube.get(field)
        missing = current is None or (isinstance(current, str) and not current.strip())
        if field == "scopes":
            missing = not current
        if missing:
            youtube[field] = value
            changed = True
    return changed


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
