"""Local account and LAN device-sync helpers for Castarro."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import socket
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

import app_db
import runtime_paths


ROOT = runtime_paths.DATA_ROOT
RUNTIME_DIR = ROOT / ".runtime"
ACCOUNTS_PATH = RUNTIME_DIR / "sync_accounts.json"
USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9_.@-]{3,64}$")
PBKDF2_ITERATIONS = 240_000
LOCAL_SYNC_USERNAME = "desktop-sync"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def normalize_username(value: Any) -> str:
    username = str(value or "").strip().lower()
    if not USERNAME_PATTERN.match(username):
        raise ValueError("Username must be 3-64 characters using letters, numbers, dot, dash, underscore, or @.")
    return username


def validate_password(value: Any) -> str:
    password = str(value or "")
    if len(password) < 6:
        raise ValueError("Password must be at least 6 characters.")
    return password


def _ensure_runtime_dir() -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)


def _load_store() -> dict[str, Any]:
    _ensure_runtime_dir()
    if not ACCOUNTS_PATH.exists():
        return {"accounts": {}, "devices": []}
    try:
        payload = json.loads(ACCOUNTS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"accounts": {}, "devices": []}
    if not isinstance(payload, dict):
        return {"accounts": {}, "devices": []}
    payload.setdefault("accounts", {})
    payload.setdefault("devices", [])
    return payload


def _save_store(store: dict[str, Any]) -> None:
    _ensure_runtime_dir()
    temp = ACCOUNTS_PATH.with_suffix(".tmp")
    temp.write_text(json.dumps(store, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temp.replace(ACCOUNTS_PATH)


def _password_hash(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or base64.urlsafe_b64encode(os.urandom(24)).decode("ascii").rstrip("=")
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("ascii"), PBKDF2_ITERATIONS)
    return salt, base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def public_account(account: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(account.get("id") or ""),
        "username": str(account.get("username") or ""),
        "displayName": account.get("displayName"),
        "createdAt": str(account.get("createdAt") or ""),
        "updatedAt": str(account.get("updatedAt") or ""),
    }


def account_by_username(username: Any) -> dict[str, Any]:
    username = normalize_username(username)
    store = _load_store()
    account = store["accounts"].get(username)
    if not isinstance(account, dict):
        raise ValueError("Pairing account is no longer available on desktop.")
    return public_account(account)


def create_account(username: Any, password_value: Any, display_name: Any = None) -> dict[str, Any]:
    username = normalize_username(username)
    password = validate_password(password_value)
    store = _load_store()
    accounts = store["accounts"]
    if username in accounts:
        raise ValueError("That Castarro login already exists. Use Log in instead.")
    salt, password_hash = _password_hash(password)
    timestamp = now_iso()
    account = {
        "id": f"sync-account-{secrets.token_hex(12)}",
        "username": username,
        "displayName": str(display_name or username).strip() or username,
        "passwordSalt": salt,
        "passwordHash": password_hash,
        "createdAt": timestamp,
        "updatedAt": timestamp,
    }
    accounts[username] = account
    _save_store(store)
    return public_account(account)


def verify_account(username: Any, password_value: Any) -> dict[str, Any]:
    username_str = str(username or "").strip()
    password_str = str(password_value or "")
    if not username_str or not password_str:
        raise ValueError("Username and password are required for Castarro login.")
    username = normalize_username(username)
    password = validate_password(password_value)
    store = _load_store()
    account = store["accounts"].get(username)
    if not isinstance(account, dict):
        raise ValueError("Invalid Castarro login.")
    salt = str(account.get("passwordSalt") or "")
    expected = str(account.get("passwordHash") or "")
    _salt, actual = _password_hash(password, salt)
    if not hmac.compare_digest(expected, actual):
        raise ValueError("Invalid Castarro login.")
    return public_account(account)


def ensure_local_account(display_name: Any = None) -> dict[str, Any]:
    store = _load_store()
    accounts = store["accounts"]
    existing = next((account for account in accounts.values() if isinstance(account, dict)), None)
    if existing:
        return public_account(existing)
    username = LOCAL_SYNC_USERNAME
    password = secrets.token_urlsafe(24)
    salt, password_hash = _password_hash(password)
    timestamp = now_iso()
    account = {
        "id": f"sync-account-{secrets.token_hex(12)}",
        "username": username,
        "displayName": str(display_name or "Castarro Desktop").strip() or "Castarro Desktop",
        "passwordSalt": salt,
        "passwordHash": password_hash,
        "createdAt": timestamp,
        "updatedAt": timestamp,
    }
    accounts[username] = account
    _save_store(store)
    return public_account(account)


def account_status() -> dict[str, Any]:
    store = _load_store()
    accounts = [public_account(account) for account in store.get("accounts", {}).values() if isinstance(account, dict)]
    devices = [device for device in store.get("devices", []) if isinstance(device, dict)]
    return {"accounts": accounts, "devices": devices}


def remember_device(account_id: str, device_id: str, device_name: str, platform: str) -> dict[str, Any]:
    store = _load_store()
    timestamp = now_iso()
    devices = [device for device in store.get("devices", []) if isinstance(device, dict)]
    existing = next((device for device in devices if device.get("id") == device_id and device.get("accountId") == account_id), None)
    if existing:
        existing["deviceName"] = device_name
        existing["platform"] = platform
        existing["lastSeenAt"] = timestamp
    else:
        existing = {
            "id": device_id,
            "accountId": account_id,
            "deviceName": device_name,
            "platform": platform if platform in {"desktop", "android", "ios"} else "unknown",
            "pairedAt": timestamp,
            "lastSeenAt": timestamp,
        }
        devices.append(existing)
    store["devices"] = devices
    _save_store(store)
    return existing


def forget_device(device_id: Any) -> dict[str, Any] | None:
    target_id = str(device_id or "").strip()
    if not target_id:
        return None
    store = _load_store()
    devices = [device for device in store.get("devices", []) if isinstance(device, dict)]
    removed = next((device for device in devices if str(device.get("id") or "") == target_id), None)
    if not removed:
        return None
    store["devices"] = [device for device in devices if str(device.get("id") or "") != target_id]
    _save_store(store)
    return removed


def local_lan_ip() -> str:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        ip = sock.getsockname()[0]
        if ip and not ip.startswith("127."):
            return ip
    except Exception:
        pass
    finally:
        sock.close()
    try:
        for candidate in socket.gethostbyname_ex(socket.gethostname())[2]:
            if candidate and not candidate.startswith("127."):
                return candidate
    except Exception:
        pass
    return "127.0.0.1"


def channel_id(config_name: str, channel_name: str) -> str:
    digest = hashlib.sha1(f"{config_name}:{channel_name}".encode("utf-8")).hexdigest()[:16]
    return f"desktop-channel-{digest}"


def video_id(config_name: str, channel_name: str, path_text: str, kind: str) -> str:
    digest = hashlib.sha1(f"{config_name}:{channel_name}:{kind}:{path_text}".encode("utf-8")).hexdigest()[:18]
    return f"desktop-video-{digest}"


def profile_id(config_name: str, channel_name: str) -> str:
    digest = hashlib.sha1(f"{config_name}:{channel_name}:profile".encode("utf-8")).hexdigest()[:16]
    return f"desktop-profile-{digest}"


def file_info(path_text: str) -> tuple[Path, int | None, str | None]:
    path = app_db.resolve_project_path(path_text)
    if not path.exists() or not path.is_file():
        return path, None, None
    stat = path.stat()
    return path, int(stat.st_size), datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _playlist_items(channel: dict[str, Any]) -> list[tuple[str, str]]:
    result: list[tuple[str, str]] = []
    for kind in ("raw_playlist", "playlist"):
        for item in channel.get(kind, []):
            if isinstance(item, str) and item.strip():
                result.append((kind, item.strip()))
    return result


def build_sync_bundle(
    config_name: str,
    config: dict[str, Any],
    account: dict[str, Any],
    *,
    include_videos: bool,
    video_base_url: str = "",
) -> dict[str, Any]:
    timestamp = now_iso()
    channels: list[dict[str, Any]] = []
    profiles: list[dict[str, Any]] = []
    videos: list[dict[str, Any]] = []
    synced_secrets: list[dict[str, Any]] = []
    seen_videos: set[str] = set()

    for channel in config.get("channels", []):
        if not isinstance(channel, dict):
            continue
        name = str(channel.get("name") or "").strip()
        if not name:
            continue
        cid = channel_id(config_name, name)
        channels.append(
            {
                "id": cid,
                "displayName": name,
                "avatarUri": channel.get("logo_uri") or channel.get("avatarUri"),
                "defaultStreamProfileId": profile_id(config_name, name),
                "youtubeAccountId": channel.get("youtube_account_id") or None,
                "createdAt": timestamp,
                "updatedAt": timestamp,
            }
        )
        stream_key = str(channel.get("stream_key") or "").strip()
        stream_key_env = str(channel.get("stream_key_env") or "").strip()
        stream_key_ref = f"desktop-inline:{cid}" if stream_key else f"desktop-env:{stream_key_env}" if stream_key_env else None
        if stream_key:
            synced_secrets.append({"ref": stream_key_ref, "value": stream_key, "kind": "streamKey"})
        profiles.append(
            {
                "id": profile_id(config_name, name),
                "channelId": cid,
                "videoAssetId": None,
                "mode": "manualKey",
                "rtmpServerUrl": str(channel.get("rtmp_base") or config.get("defaults", {}).get("rtmp_base") or "rtmps://a.rtmps.youtube.com/live2").strip(),
                "streamKeySecretRef": stream_key_ref,
                "youtubeBroadcastId": None,
                "loopEnabled": bool(channel.get("loop") or channel.get("youtube_auto_start")),
                "restartOnExit": bool(channel.get("restart_on_exit", False)),
                "createdAt": timestamp,
                "updatedAt": timestamp,
            }
        )
        for kind, path_text in _playlist_items(channel):
            vid = video_id(config_name, name, path_text, kind)
            if vid in seen_videos:
                continue
            seen_videos.add(vid)
            path, size_bytes, mtime = file_info(path_text)
            download_url = None
            if include_videos and video_base_url and size_bytes is not None:
                separator = "&" if "?" in video_base_url else "?"
                download_url = f"{video_base_url}{separator}path={quote(path_text, safe='')}"
            videos.append(
                {
                    "id": vid,
                    "channelId": cid,
                    "displayName": path.name or Path(path_text).name or "Video",
                    "sourceUri": download_url or path_text,
                    "sourceType": "downloadUrl" if download_url else "desktopPath",
                    "desktopPath": path_text,
                    "downloadUrl": download_url,
                    "sizeBytes": size_bytes,
                    "mtime": mtime,
                    "kind": kind,
                    "syncFile": bool(download_url),
                }
            )

    return {
        "schemaVersion": 1,
        "account": account,
        "configName": config_name,
        "exportedAt": timestamp,
        "channels": channels,
        "streamProfiles": profiles,
        "videos": videos,
        "secrets": synced_secrets,
        "settings": {
            "ui": config.get("ui", {}),
            "defaults": config.get("defaults", {}),
            "youtubeAccounts": _public_youtube_accounts(config),
        },
    }


def _public_youtube_accounts(config: dict[str, Any]) -> list[dict[str, Any]]:
    accounts = config.get("youtube_accounts", [])
    if not isinstance(accounts, list):
        return []
    public: list[dict[str, Any]] = []
    for account in accounts:
        if not isinstance(account, dict):
            continue
        public.append(
            {
                "id": account.get("id"),
                "label": account.get("label"),
                "channel_id": account.get("channel_id"),
                "channel_title": account.get("channel_title"),
                "channel_handle": account.get("channel_handle"),
            }
        )
    return public


def pairing_payload(host: str, port: int, token: str, code: str, expires_at: str) -> dict[str, Any]:
    url = f"http://{host}:{port}/sync/pair/{token}"
    uri = f"castarro://pair?host={quote(host)}&port={port}&token={quote(token)}&code={quote(code)}"
    return {
        "pairingUrl": url,
        "pairingUri": uri,
        "host": host,
        "port": port,
        "token": token,
        "code": code,
        "expiresAt": expires_at,
    }


def new_pairing(username: str, config_name: str, sync_port: int, *, include_videos: bool = False) -> dict[str, Any]:
    token = secrets.token_urlsafe(24)
    code = f"{secrets.randbelow(1_000_000):06d}"
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat(timespec="seconds").replace("+00:00", "Z")
    host = local_lan_ip()
    return {
        "username": username,
        "configName": config_name,
        "token": token,
        "code": code,
        "includeVideos": bool(include_videos),
        "createdAt": now_iso(),
        "expiresAt": expires_at,
        "payload": pairing_payload(host, sync_port, token, code, expires_at),
    }


def is_expired(pairing: dict[str, Any]) -> bool:
    raw = str(pairing.get("expiresAt") or "")
    try:
        expires = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        return True
    return datetime.now(timezone.utc) >= expires
