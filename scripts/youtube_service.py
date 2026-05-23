"""YouTube OAuth + Live API helpers using only Python standard library."""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


YOUTUBE_DEFAULT_SCOPES = [
    "https://www.googleapis.com/auth/youtube",
    "https://www.googleapis.com/auth/youtube.force-ssl",
]


def default_settings(redirect_uri: str | None = None) -> dict[str, Any]:
    return {
        "client_id": "",
        "client_secret": "",
        "redirect_uri": redirect_uri or "http://127.0.0.1:8765/api/youtube/oauth/callback",
        "oauth_client_type": "desktop",
        "use_pkce": True,
        "tokens_file": ".runtime/youtube_tokens.json",
        "scopes": list(YOUTUBE_DEFAULT_SCOPES),
        "default_privacy_status": "unlisted",
        "default_auto_start": True,
        "default_auto_stop": True,
    }


def merge_settings(config: dict[str, Any], redirect_uri: str | None = None) -> dict[str, Any]:
    merged = default_settings(redirect_uri)
    raw = config.get("youtube", {})
    if isinstance(raw, dict):
        merged.update(raw)

    scopes = merged.get("scopes")
    if isinstance(scopes, str):
        scopes = [part.strip() for part in scopes.split() if part.strip()]
    elif isinstance(scopes, list):
        scopes = [str(scope).strip() for scope in scopes if str(scope).strip()]
    else:
        scopes = []
    merged["scopes"] = scopes or list(YOUTUBE_DEFAULT_SCOPES)
    oauth_client_type = str(merged.get("oauth_client_type") or "desktop").strip().lower()
    merged["oauth_client_type"] = "web" if oauth_client_type == "web" else "desktop"
    merged["use_pkce"] = bool(merged.get("use_pkce", True))
    merged["default_auto_start"] = bool(merged.get("default_auto_start", True))
    merged["default_auto_stop"] = bool(merged.get("default_auto_stop", True))
    return merged


def ensure_shape(config: dict[str, Any], redirect_uri: str | None = None) -> dict[str, Any]:
    config["youtube"] = merge_settings(config, redirect_uri)
    return config


def credentials_ready(config: dict[str, Any], redirect_uri: str | None = None) -> bool:
    settings = merge_settings(config, redirect_uri)
    client_id = str(settings.get("client_id") or "").strip()
    client_secret = str(settings.get("client_secret") or "").strip()
    if settings.get("oauth_client_type") == "web":
        return bool(client_id and client_secret)
    return bool(client_id)


def pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(96).replace("=", "")
    if len(verifier) < 43:
        verifier += "A" * (43 - len(verifier))
    verifier = verifier[:128]
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    return verifier, challenge


def tokens_path(config_dir: Path, config: dict[str, Any], redirect_uri: str | None = None) -> Path:
    settings = merge_settings(config, redirect_uri)
    configured = str(settings.get("tokens_file") or ".runtime/youtube_tokens.json").strip()
    path = Path(configured)
    if not path.is_absolute():
        path = (config_dir / path).resolve()
    if path.parent:
        path.parent.mkdir(parents=True, exist_ok=True)
    return path


def load_tokens(config_dir: Path, config: dict[str, Any], redirect_uri: str | None = None) -> dict[str, Any] | None:
    path = tokens_path(config_dir, config, redirect_uri)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise ValueError(f"Could not read YouTube token file: {exc}") from exc


def save_tokens(config_dir: Path, config: dict[str, Any], tokens: dict[str, Any], redirect_uri: str | None = None) -> dict[str, Any]:
    path = tokens_path(config_dir, config, redirect_uri)
    prepared = dict(tokens)
    now = int(time.time())
    prepared["obtained_at"] = int(prepared.get("obtained_at") or now)
    expires_in = int(float(prepared.get("expires_in") or 0))
    if expires_in > 0:
        prepared["expires_at"] = prepared["obtained_at"] + expires_in
    path.write_text(json.dumps(prepared, indent=2) + "\n", encoding="utf-8")
    return prepared


def clear_tokens(config_dir: Path, config: dict[str, Any], redirect_uri: str | None = None) -> None:
    path = tokens_path(config_dir, config, redirect_uri)
    path.unlink(missing_ok=True)


def build_auth_url(
    config: dict[str, Any],
    oauth_state: str,
    redirect_uri: str | None = None,
    *,
    code_challenge: str | None = None,
) -> str:
    settings = merge_settings(config, redirect_uri)
    client_id = str(settings.get("client_id") or "").strip()
    if not client_id:
        raise ValueError("YouTube client ID is missing.")

    params = {
        "client_id": client_id,
        "redirect_uri": str(settings.get("redirect_uri") or ""),
        "response_type": "code",
        "scope": " ".join(settings["scopes"]),
        "access_type": "offline",
        "include_granted_scopes": "true",
        "prompt": "consent",
        "state": oauth_state,
    }
    if code_challenge:
        params["code_challenge"] = code_challenge
        params["code_challenge_method"] = "S256"
    return "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(params)


def parse_api_error(raw: bytes, fallback: str) -> str:
    if not raw:
        return fallback
    try:
        payload = json.loads(raw.decode("utf-8", errors="replace"))
        if isinstance(payload, dict):
            error = payload.get("error")
            if isinstance(error, dict):
                details = error.get("errors")
                if isinstance(details, list) and details:
                    first = details[0]
                    if isinstance(first, dict):
                        reason = str(first.get("reason") or "").strip()
                        message = str(first.get("message") or "").strip()
                        if reason and message:
                            return f"{reason}: {message}"
                message = str(error.get("message") or "").strip()
                if message:
                    return message
            message = str(payload.get("message") or "").strip()
            if message:
                return message
    except Exception:
        pass
    text = raw.decode("utf-8", errors="replace").strip()
    return text or fallback


def request_json(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    body: dict[str, Any] | None = None,
    form: bool = False,
    timeout: float = 25.0,
) -> dict[str, Any]:
    request_headers = {"Accept": "application/json"}
    if headers:
        request_headers.update(headers)

    data: bytes | None = None
    if body is not None:
        if form:
            encoded = urllib.parse.urlencode({key: value for key, value in body.items() if value is not None})
            data = encoded.encode("utf-8")
            request_headers["Content-Type"] = "application/x-www-form-urlencoded"
        else:
            data = json.dumps(body).encode("utf-8")
            request_headers["Content-Type"] = "application/json; charset=utf-8"

    request = urllib.request.Request(url, data=data, method=method.upper(), headers=request_headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
    except urllib.error.HTTPError as exc:
        raw = exc.read() if hasattr(exc, "read") else b""
        message = parse_api_error(raw, f"HTTP {exc.code} from {url}")
        raise ValueError(message) from exc
    except urllib.error.URLError as exc:
        raise ValueError(f"Network error while reaching YouTube/Google APIs: {exc.reason}") from exc

    if not raw:
        return {}
    try:
        payload = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError("Received non-JSON response from YouTube/Google APIs.") from exc
    if not isinstance(payload, dict):
        raise ValueError("Unexpected response shape from YouTube/Google APIs.")
    return payload


def exchange_code_for_tokens(
    config_dir: Path,
    config: dict[str, Any],
    authorization_code: str,
    redirect_uri: str | None = None,
    *,
    code_verifier: str | None = None,
) -> dict[str, Any]:
    settings = merge_settings(config, redirect_uri)
    client_id = str(settings.get("client_id") or "").strip()
    client_secret = str(settings.get("client_secret") or "").strip()
    if not client_id:
        raise ValueError("Missing YouTube OAuth client ID.")
    if settings.get("oauth_client_type") == "web" and not client_secret:
        raise ValueError("Missing YouTube OAuth client secret for web OAuth client.")

    form_body: dict[str, Any] = {
        "code": authorization_code,
        "client_id": client_id,
        "redirect_uri": settings.get("redirect_uri"),
        "grant_type": "authorization_code",
    }
    if client_secret:
        form_body["client_secret"] = client_secret
    if code_verifier:
        form_body["code_verifier"] = code_verifier
    payload = request_json(
        "https://oauth2.googleapis.com/token",
        method="POST",
        form=True,
        body=form_body,
    )
    if "access_token" not in payload:
        raise ValueError("Google token response did not include an access token.")
    if "refresh_token" not in payload:
        raise ValueError(
            "Google did not return a refresh token. Reconnect and accept consent again, "
            "or revoke this app in your Google account and retry."
        )
    payload["obtained_at"] = int(time.time())
    return save_tokens(config_dir, config, payload, redirect_uri)


def refresh_access_token(
    config_dir: Path,
    config: dict[str, Any],
    tokens: dict[str, Any],
    redirect_uri: str | None = None,
) -> dict[str, Any]:
    settings = merge_settings(config, redirect_uri)
    refresh_token = str(tokens.get("refresh_token") or "").strip()
    if not refresh_token:
        raise ValueError("No refresh token available. Reconnect your YouTube account.")

    payload = request_json(
        "https://oauth2.googleapis.com/token",
        method="POST",
        form=True,
        body={
            "refresh_token": refresh_token,
            "client_id": settings.get("client_id"),
            "grant_type": "refresh_token",
            "client_secret": settings.get("client_secret") or None,
        },
    )
    if "access_token" not in payload:
        raise ValueError("Token refresh did not return an access token.")

    merged = dict(tokens)
    merged.update(payload)
    merged["refresh_token"] = refresh_token
    merged["obtained_at"] = int(time.time())
    return save_tokens(config_dir, config, merged, redirect_uri)


def token_expired(tokens: dict[str, Any], *, skew_seconds: int = 60) -> bool:
    expires_at = int(float(tokens.get("expires_at") or 0))
    if not expires_at:
        return False
    return int(time.time()) >= (expires_at - skew_seconds)


def valid_access_token(config_dir: Path, config: dict[str, Any], redirect_uri: str | None = None) -> tuple[str, dict[str, Any]]:
    tokens = load_tokens(config_dir, config, redirect_uri)
    if not tokens:
        raise ValueError("YouTube account is not connected yet.")
    if token_expired(tokens):
        tokens = refresh_access_token(config_dir, config, tokens, redirect_uri)
    access_token = str(tokens.get("access_token") or "").strip()
    if not access_token:
        raise ValueError("YouTube access token is missing. Reconnect your account.")
    return access_token, tokens


def youtube_get(access_token: str, url: str) -> dict[str, Any]:
    return request_json(url, headers={"Authorization": f"Bearer {access_token}"})


def youtube_post(access_token: str, url: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    return request_json(
        url,
        method="POST",
        headers={"Authorization": f"Bearer {access_token}"},
        body=body,
    )


def connected_account_profile(access_token: str) -> dict[str, Any]:
    payload = youtube_get(
        access_token,
        "https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true&maxResults=1",
    )
    items = payload.get("items")
    if not isinstance(items, list) or not items:
        return {}
    channel = items[0] if isinstance(items[0], dict) else {}
    snippet = channel.get("snippet", {}) if isinstance(channel.get("snippet"), dict) else {}
    return {
        "channel_id": channel.get("id"),
        "channel_title": snippet.get("title"),
        "channel_handle": snippet.get("customUrl"),
    }


def list_upcoming_broadcasts(access_token: str, limit: int = 25) -> list[dict[str, Any]]:
    payload = youtube_get(
        access_token,
        "https://www.googleapis.com/youtube/v3/liveBroadcasts"
        f"?part=id,snippet,status,contentDetails&broadcastStatus=upcoming&broadcastType=all&mine=true&maxResults={max(1, min(limit, 50))}",
    )
    items = payload.get("items")
    if not isinstance(items, list):
        return []
    results: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        snippet = item.get("snippet", {}) if isinstance(item.get("snippet"), dict) else {}
        status = item.get("status", {}) if isinstance(item.get("status"), dict) else {}
        content_details = item.get("contentDetails", {}) if isinstance(item.get("contentDetails"), dict) else {}
        broadcast_id = str(item.get("id") or "")
        results.append(
            {
                "id": broadcast_id,
                "title": snippet.get("title"),
                "description": snippet.get("description", ""),
                "scheduled_start_time": snippet.get("scheduledStartTime", ""),
                "scheduled_end_time": snippet.get("scheduledEndTime", ""),
                "privacy_status": status.get("privacyStatus", ""),
                "life_cycle_status": status.get("lifeCycleStatus", ""),
                "bound_stream_id": content_details.get("boundStreamId", ""),
                "studio_url": f"https://studio.youtube.com/video/{broadcast_id}/livestreaming" if broadcast_id else "",
            }
        )
    return results


def stream_name_from_resource(stream: dict[str, Any]) -> str:
    cdn = stream.get("cdn", {}) if isinstance(stream.get("cdn"), dict) else {}
    ingestion = cdn.get("ingestionInfo", {}) if isinstance(cdn.get("ingestionInfo"), dict) else {}
    return str(ingestion.get("streamName") or "").strip()


def live_stream_by_id(access_token: str, stream_id: str) -> dict[str, Any] | None:
    stream_id = str(stream_id or "").strip()
    if not stream_id:
        return None
    payload = youtube_get(
        access_token,
        "https://www.googleapis.com/youtube/v3/liveStreams"
        f"?part=id,snippet,cdn,contentDetails,status&id={urllib.parse.quote(stream_id)}",
    )
    items = payload.get("items")
    if not isinstance(items, list) or not items:
        return None
    first = items[0]
    return first if isinstance(first, dict) else None


def list_mine_live_streams(access_token: str, max_pages: int = 5) -> list[dict[str, Any]]:
    streams: list[dict[str, Any]] = []
    page_token = ""
    page_limit = max(1, min(max_pages, 20))
    for _ in range(page_limit):
        params = {
            "part": "id,snippet,cdn,contentDetails,status",
            "mine": "true",
            "maxResults": "50",
        }
        if page_token:
            params["pageToken"] = page_token
        payload = youtube_get(
            access_token,
            "https://www.googleapis.com/youtube/v3/liveStreams?" + urllib.parse.urlencode(params),
        )
        items = payload.get("items")
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict):
                    streams.append(item)
        page_token = str(payload.get("nextPageToken") or "").strip()
        if not page_token:
            break
    return streams


def schedule_broadcast(
    access_token: str,
    *,
    title: str,
    description: str,
    scheduled_start_time: str,
    scheduled_end_time: str,
    privacy_status: str,
    auto_start: bool,
    auto_stop: bool,
) -> dict[str, Any]:
    broadcast = youtube_post(
        access_token,
        "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=id,snippet,status,contentDetails",
        body={
            "snippet": {
                "title": title,
                "description": description,
                "scheduledStartTime": scheduled_start_time,
                "scheduledEndTime": scheduled_end_time,
            },
            "status": {
                "privacyStatus": privacy_status,
                "selfDeclaredMadeForKids": False,
            },
            "contentDetails": {
                "enableAutoStart": bool(auto_start),
                "enableAutoStop": bool(auto_stop),
                "enableDvr": True,
                "recordFromStart": True,
            },
        },
    )
    stream = youtube_post(
        access_token,
        "https://www.googleapis.com/youtube/v3/liveStreams?part=id,snippet,cdn,contentDetails",
        body={
            "snippet": {
                "title": f"{title} Stream",
                "description": f"Auto-created stream for {title}",
            },
            "cdn": {
                "ingestionType": "rtmp",
                "resolution": "variable",
                "frameRate": "variable",
            },
            "contentDetails": {
                "isReusable": True,
            },
        },
    )
    broadcast_id = str(broadcast.get("id") or "")
    stream_id = str(stream.get("id") or "")
    if not broadcast_id or not stream_id:
        raise ValueError("YouTube did not return broadcast/stream IDs after creation.")

    bound = youtube_post(
        access_token,
        "https://www.googleapis.com/youtube/v3/liveBroadcasts/bind"
        f"?part=id,snippet,contentDetails,status&id={urllib.parse.quote(broadcast_id)}&streamId={urllib.parse.quote(stream_id)}",
    )

    stream_cdn = stream.get("cdn", {}) if isinstance(stream.get("cdn"), dict) else {}
    ingestion = stream_cdn.get("ingestionInfo", {}) if isinstance(stream_cdn.get("ingestionInfo"), dict) else {}
    stream_name = str(ingestion.get("streamName") or "")
    ingestion_address = str(
        ingestion.get("rtmpsIngestionAddress")
        or ingestion.get("ingestionAddress")
        or "rtmp://a.rtmp.youtube.com/live2"
    )

    return {
        "broadcast": {
            "id": broadcast_id,
            "title": title,
            "studio_url": f"https://studio.youtube.com/video/{broadcast_id}/livestreaming",
            "scheduled_start_time": scheduled_start_time,
            "scheduled_end_time": scheduled_end_time,
            "privacy_status": privacy_status,
            "auto_start": bool(auto_start),
            "auto_stop": bool(auto_stop),
        },
        "stream": {
            "id": stream_id,
            "stream_name": stream_name,
            "ingestion_address": ingestion_address,
            "ingestion_url": f"{ingestion_address.rstrip('/')}/{stream_name}" if stream_name else ingestion_address,
        },
        "bind": bound,
    }
