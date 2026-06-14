"""Shared storage-provider helpers for cloud video sources."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import runtime_paths


DEFAULT_SOURCE_PROXY = {
    "host": "127.0.0.1",
    "port": 8876,
    "cache_dir": ".runtime/cloud-cache",
    "startup_buffer_mb": 64,
    "max_cache_mb": 2048,
    "spool_before_start": False,
}

DEFAULT_PROVIDER_OAUTH = {
    "client_id": "",
    "client_secret": "",
    "redirect_uri": "http://127.0.0.1:8765/oauth2redirect",
    "oauth_client_type": "desktop",
    "use_pkce": True,
    "scopes": [],
}

DEFAULT_GOOGLE_DRIVE_SCOPES = [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
]


def normalize_provider_id(value: Any) -> str:
    text = str(value or "").strip().lower()
    safe = []
    for char in text:
        if char.isalnum() or char in ("-", "_"):
            safe.append(char)
        elif char in (" ", ".", "/"):
            safe.append("-")
    normalized = "".join(safe).strip("-_")
    while "--" in normalized:
        normalized = normalized.replace("--", "-")
    return normalized


def provider_tokens_file(provider_id: str, provider_type: str = "googleDrive") -> str:
    safe_id = normalize_provider_id(provider_id) or "provider"
    prefix = "google_drive" if provider_type == "googleDrive" else "storage"
    return f".runtime/{prefix}_tokens_{safe_id}.json"


def default_provider_oauth(provider_type: str) -> dict[str, Any]:
    scopes = list(DEFAULT_GOOGLE_DRIVE_SCOPES) if provider_type == "googleDrive" else []
    return {
        **DEFAULT_PROVIDER_OAUTH,
        "scopes": scopes,
    }


def normalize_provider_oauth(provider_type: str, raw: Any) -> dict[str, Any]:
    oauth = {**default_provider_oauth(provider_type), **(raw if isinstance(raw, dict) else {})}
    oauth["client_id"] = str(oauth.get("client_id") or "").strip()
    oauth["client_secret"] = str(oauth.get("client_secret") or "").strip()
    oauth["redirect_uri"] = str(oauth.get("redirect_uri") or DEFAULT_PROVIDER_OAUTH["redirect_uri"]).strip() or DEFAULT_PROVIDER_OAUTH["redirect_uri"]
    client_type = str(oauth.get("oauth_client_type") or "desktop").strip().lower()
    oauth["oauth_client_type"] = "web" if client_type == "web" else "desktop"
    oauth["use_pkce"] = bool(oauth.get("use_pkce", True))

    scopes = oauth.get("scopes")
    if isinstance(scopes, str):
        scopes = [part.strip() for part in scopes.split() if part.strip()]
    elif isinstance(scopes, list):
        scopes = [str(scope).strip() for scope in scopes if str(scope).strip()]
    else:
        scopes = []
    oauth["scopes"] = scopes or list(default_provider_oauth(provider_type).get("scopes") or [])
    return oauth


def normalize_storage_config(config: dict[str, Any]) -> dict[str, Any]:
    raw = config.get("storage")
    storage = dict(raw) if isinstance(raw, dict) else {}

    raw_proxy = storage.get("source_proxy")
    proxy = {**DEFAULT_SOURCE_PROXY, **(raw_proxy if isinstance(raw_proxy, dict) else {})}
    proxy["host"] = str(proxy.get("host") or DEFAULT_SOURCE_PROXY["host"]).strip() or DEFAULT_SOURCE_PROXY["host"]
    try:
        proxy["port"] = max(1, min(int(proxy.get("port") or DEFAULT_SOURCE_PROXY["port"]), 65535))
    except (TypeError, ValueError):
        proxy["port"] = DEFAULT_SOURCE_PROXY["port"]
    proxy["cache_dir"] = str(proxy.get("cache_dir") or DEFAULT_SOURCE_PROXY["cache_dir"]).strip() or DEFAULT_SOURCE_PROXY["cache_dir"]
    for field in ("startup_buffer_mb", "max_cache_mb"):
        try:
            proxy[field] = max(0, int(proxy.get(field) or DEFAULT_SOURCE_PROXY[field]))
        except (TypeError, ValueError):
            proxy[field] = DEFAULT_SOURCE_PROXY[field]
    proxy["spool_before_start"] = bool(proxy.get("spool_before_start"))
    storage["source_proxy"] = proxy

    providers: list[dict[str, Any]] = []
    raw_providers = storage.get("providers")
    if isinstance(raw_providers, list):
        for item in raw_providers:
            if not isinstance(item, dict):
                continue
            provider_type = str(item.get("type") or "googleDrive").strip() or "googleDrive"
            if provider_type not in {"googleDrive", "dropbox", "oneDrive", "s3", "directHttp"}:
                provider_type = "googleDrive"
            provider_id = normalize_provider_id(item.get("id") or item.get("display_name") or provider_type)
            if not provider_id:
                continue
            tokens_file = str(item.get("tokens_file") or "").strip() or provider_tokens_file(provider_id, provider_type)
            providers.append(
                {
                    "id": provider_id,
                    "type": provider_type,
                    "display_name": str(item.get("display_name") or item.get("displayName") or provider_id).strip() or provider_id,
                    "auth_mode": str(item.get("auth_mode") or item.get("authMode") or ("oauth" if provider_type in {"googleDrive", "dropbox", "oneDrive"} else "publicUrl")).strip(),
                    "tokens_file": tokens_file,
                    "account_email": str(item.get("account_email") or item.get("accountEmail") or "").strip(),
                    "status": str(item.get("status") or "").strip(),
                    "oauth": normalize_provider_oauth(provider_type, item.get("oauth")),
                }
            )
    storage["providers"] = providers
    config["storage"] = storage
    return storage


def resolve_config_path(root: Path, value: str) -> Path:
    path = Path(value)
    if path.is_absolute():
        return path
    return (root / path).resolve()


def ensure_storage_dirs(config: dict[str, Any], root: Path | None = None) -> None:
    root = root or runtime_paths.DATA_ROOT
    storage = normalize_storage_config(config)
    cache_dir = resolve_config_path(root, str(storage.get("source_proxy", {}).get("cache_dir") or ".runtime/cloud-cache"))
    cache_dir.mkdir(parents=True, exist_ok=True)


def provider_status(root: Path, provider: dict[str, Any]) -> dict[str, Any]:
    tokens_file = str(provider.get("tokens_file") or "").strip()
    token_path = resolve_config_path(root, tokens_file) if tokens_file else None
    token_exists = bool(token_path and token_path.exists())
    configured_status = str(provider.get("status") or "").strip()
    if configured_status:
        status = configured_status
    elif token_exists:
        status = "connected"
    else:
        status = "disconnected"
    return {
        "id": str(provider.get("id") or ""),
        "type": str(provider.get("type") or ""),
        "display_name": str(provider.get("display_name") or ""),
        "auth_mode": str(provider.get("auth_mode") or ""),
        "status": status,
        "connected": status == "connected",
        "account_email": str(provider.get("account_email") or ""),
        "tokens_file": tokens_file,
        "tokens_present": token_exists,
    }


def storage_status(root: Path, config: dict[str, Any]) -> dict[str, Any]:
    storage = normalize_storage_config(config)
    return {
        "ok": True,
        "source_proxy": storage.get("source_proxy", {}),
        "providers": [provider_status(root, provider) for provider in storage.get("providers", [])],
    }


def find_provider(config: dict[str, Any], provider_id: str) -> dict[str, Any] | None:
    key = normalize_provider_id(provider_id)
    for provider in normalize_storage_config(config).get("providers", []):
        if str(provider.get("id") or "") == key:
            return provider
    return None


def disconnect_provider(root: Path, config: dict[str, Any], provider_id: str) -> dict[str, Any]:
    provider = find_provider(config, provider_id)
    if not provider:
        raise ValueError(f"Unknown storage provider: {provider_id}")
    tokens_file = str(provider.get("tokens_file") or "").strip()
    if tokens_file:
        token_path = resolve_config_path(root, tokens_file)
        token_path.unlink(missing_ok=True)
    provider["status"] = "disconnected"
    provider["account_email"] = ""
    return provider_status(root, provider)
