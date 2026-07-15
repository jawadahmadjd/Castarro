"""YouTube OAuth + Live API helpers using only Python standard library."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import secrets
import threading
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
YOUTUBE_QUOTA_COOLDOWN_SECONDS = max(
    60.0,
    float(os.environ.get("YOUTUBE_API_QUOTA_COOLDOWN_SECONDS", "3600")),
)
_YOUTUBE_QUOTA_LOCK = threading.Lock()
_YOUTUBE_QUOTA_COOLDOWN_UNTIL = 0.0

YOUTUBE_EMOJI_SHORTCODE_RE = re.compile(r":([a-z0-9][a-z0-9_+-]*(?:-[a-z0-9_+-]+)*):", re.IGNORECASE)
YOUTUBE_EMOJI_SHORTCODE_FALLBACKS = {
    "hand-pink-waving": "\U0001f44b",
    "person-turquoise-waving": "\U0001f44b",
    "person-turqouise-waving": "\U0001f44b",
    "face-red-heart-shape": "\U0001f970",
    "eyes-pink-heart-shape": "\U0001f60d",
    "face-fuchsia-poop-shape": "\U0001f4a9",
    "face-blue-smiling": "\U0001f642",
    "face-green-smiling": "\U0001f60a",
    "face-red-droopy-eyes": "\U0001f97a",
    "face-purple-crying": "\U0001f62d",
    "eyes-purple-crying": "\U0001f62d",
    "face-pink-tears": "\U0001f979",
    "face-fuchsia-wide-eyes": "\U0001f633",
    "face-blue-wide-eyes": "\U0001f632",
    "face-purple-wide-eyes": "\U0001f62e",
    "face-orange-frowning": "\u2639\ufe0f",
    "face-orange-raised-eyebrow": "\U0001f928",
    "face-fuchsia-tongue-out": "\U0001f61c",
    "face-orange-biting-nails": "\U0001f62c",
    "glasses-purple-yellow-diamond": "\U0001f60e",
    "cat-orange-whistling": "\U0001f63d",
    "body-blue-raised-arms": "\U0001f64c",
    "body-pink-dancing": "\U0001f483",
    "body-turquoise-yoga-pose": "\U0001f9d8",
    "body-green-covering-eyes": "\U0001f648",
    "hand-orange-covering-eyes": "\U0001f648",
    "hand-purple-blue-peace": "\u270c\ufe0f",
    "hand-green-crystal-ball": "\U0001f52e",
    "face-blue-question-mark": "\u2753",
    "face-blue-covering-eyes": "\U0001f648",
    "face-turquoise-drinking-coffee": "\u2615",
    "body-green-shirt": "\U0001f455",
    "trophy-yellow-smiling": "\U0001f3c6",
    "smile": "\U0001f604",
    "joy": "\U0001f602",
    "laughing": "\U0001f606",
    "heart": "\u2764\ufe0f",
    "red-heart": "\u2764\ufe0f",
    "fire": "\U0001f525",
    "pray": "\U0001f64f",
    "folded-hands": "\U0001f64f",
    "folded_hands": "\U0001f64f",
    "thumbs-up": "\U0001f44d",
    "thumbsup": "\U0001f44d",
    "clap": "\U0001f44f",
}


def missing_client_secret_message() -> str:
    return (
        "Google rejected this OAuth client because its client secret is missing. "
        "Set the YouTube OAuth client secret in the owner credentials, then reconnect this YouTube account."
    )


def default_settings(redirect_uri: str | None = None) -> dict[str, Any]:
    return {
        "client_id": "",
        "client_secret": "",
        "redirect_uri": redirect_uri or "http://127.0.0.1:8765/api/youtube/oauth/callback",
        "oauth_client_type": "desktop",
        "use_pkce": True,
        "tokens_file": ".runtime/youtube_tokens.json",
        "scopes": list(YOUTUBE_DEFAULT_SCOPES),
        "default_privacy_status": "public",
        "default_auto_start": True,
        "default_auto_stop": True,
    }


def is_youtube_data_api_url(url: str) -> bool:
    text = str(url or "").lower()
    return "youtube/v3/" in text or "youtube/v3?" in text or "/upload/youtube/v3/" in text


def is_quota_error_message(message: str) -> bool:
    text = str(message or "").lower()
    return "quotaexceeded" in text or "exceeded your quota" in text or "quota exceeded" in text


def quota_cooldown_remaining() -> int:
    with _YOUTUBE_QUOTA_LOCK:
        remaining = max(0.0, _YOUTUBE_QUOTA_COOLDOWN_UNTIL - time.time())
    return int(remaining)


def set_quota_cooldown() -> int:
    global _YOUTUBE_QUOTA_COOLDOWN_UNTIL
    with _YOUTUBE_QUOTA_LOCK:
        _YOUTUBE_QUOTA_COOLDOWN_UNTIL = max(
            _YOUTUBE_QUOTA_COOLDOWN_UNTIL,
            time.time() + YOUTUBE_QUOTA_COOLDOWN_SECONDS,
        )
        remaining = max(0.0, _YOUTUBE_QUOTA_COOLDOWN_UNTIL - time.time())
    return int(remaining)


def assert_quota_available(url: str) -> None:
    if not is_youtube_data_api_url(url):
        return
    remaining = quota_cooldown_remaining()
    if remaining > 0:
        raise ValueError(
            "quotaExceeded: YouTube API quota is exhausted. "
            f"Further YouTube API calls are paused for {remaining} second(s)."
        )


def merge_settings(config: dict[str, Any], redirect_uri: str | None = None) -> dict[str, Any]:
    merged = default_settings(redirect_uri)
    raw = config.get("youtube", {})
    if isinstance(raw, dict):
        merged.update(raw)
    if redirect_uri is not None:
        merged["redirect_uri"] = redirect_uri

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


def token_request_client_secret(oauth_settings: dict[str, Any]) -> str:
    """Return the configured OAuth client secret for token requests."""
    return str(oauth_settings.get("client_secret") or "").strip()


def replace_youtube_emoji_shortcodes(value: str) -> str:
    def replacement(match: re.Match[str]) -> str:
        shortcode = match.group(1).lower()
        return YOUTUBE_EMOJI_SHORTCODE_FALLBACKS.get(shortcode, match.group(0))

    return YOUTUBE_EMOJI_SHORTCODE_RE.sub(replacement, str(value or ""))


def live_chat_text_from_details(details: Any, *keys: str) -> str:
    if not isinstance(details, dict):
        return ""
    for key in keys:
        text = str(details.get(key) or "").strip()
        if text:
            return text
    return ""


def live_chat_message_text_from_snippet(snippet: dict[str, Any]) -> str:
    candidates = [
        live_chat_text_from_details(snippet.get("textMessageDetails"), "messageText"),
        live_chat_text_from_details(snippet.get("memberMilestoneChatDetails"), "userComment"),
        live_chat_text_from_details(snippet.get("superChatDetails"), "userComment"),
        live_chat_text_from_details(snippet.get("fanFundingEventDetails"), "userComment"),
        live_chat_text_from_details(snippet.get("superStickerDetails"), "altText"),
        live_chat_text_from_details(
            (snippet.get("superStickerDetails") or {}).get("superStickerMetadata")
            if isinstance(snippet.get("superStickerDetails"), dict)
            else {},
            "altText",
        ),
        live_chat_text_from_details(
            (snippet.get("giftEventDetails") or {}).get("giftMetadata")
            if isinstance(snippet.get("giftEventDetails"), dict)
            else {},
            "altText",
            "giftName",
        ),
        str(snippet.get("displayMessage") or "").strip(),
    ]
    return next((text for text in candidates if text), "")


def live_chat_emoji_part_from_resource(part: dict[str, Any]) -> dict[str, str] | None:
    emoji = part.get("emoji") if isinstance(part.get("emoji"), dict) else {}
    if not emoji:
        return None
    image = emoji.get("image") if isinstance(emoji.get("image"), dict) else {}
    shortcuts = emoji.get("shortcuts")
    shortcode = ""
    if isinstance(shortcuts, list) and shortcuts:
        shortcode = str(shortcuts[0] or "")
    elif isinstance(emoji.get("shortcut"), str):
        shortcode = str(emoji.get("shortcut") or "")
    text = str(part.get("text") or part.get("displayText") or shortcode or emoji.get("emojiId") or "").strip()
    if not text:
        return None
    image_url = str(emoji.get("imageUrl") or image.get("url") or "").strip()
    alt = str(emoji.get("altText") or text or shortcode or "Emoji").strip()
    return {
        "type": "emoji",
        "text": replace_youtube_emoji_shortcodes(text or alt),
        "alt": replace_youtube_emoji_shortcodes(alt),
        "shortcode": shortcode,
        "image_url": image_url,
    }


def live_chat_message_parts_from_snippet(snippet: dict[str, Any], display_message: str) -> list[dict[str, str]]:
    raw_parts = snippet.get("messageParts")
    parts: list[dict[str, str]] = []
    if isinstance(raw_parts, list):
        for part in raw_parts:
            if isinstance(part, str):
                if part:
                    parts.append({"type": "text", "text": replace_youtube_emoji_shortcodes(part)})
                continue
            if not isinstance(part, dict):
                continue
            emoji_part = live_chat_emoji_part_from_resource(part)
            if emoji_part:
                parts.append(emoji_part)
                continue
            text = str(part.get("text") or part.get("displayText") or "").strip()
            if text:
                parts.append({"type": "text", "text": replace_youtube_emoji_shortcodes(text)})
    if parts:
        return parts
    text = replace_youtube_emoji_shortcodes(display_message)
    return [{"type": "text", "text": text}] if text else []


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
            description = str(payload.get("error_description") or "").strip()
            if description:
                return description
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
    assert_quota_available(url)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
    except urllib.error.HTTPError as exc:
        raw = exc.read() if hasattr(exc, "read") else b""
        message = parse_api_error(raw, f"HTTP {exc.code} from {url}")
        if is_youtube_data_api_url(url) and is_quota_error_message(message):
            set_quota_cooldown()
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
    client_secret = token_request_client_secret(settings)
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
    try:
        payload = request_json(
            "https://oauth2.googleapis.com/token",
            method="POST",
            form=True,
            body=form_body,
        )
    except ValueError as exc:
        if "client_secret is missing" in str(exc).lower() and not client_secret:
            raise ValueError(missing_client_secret_message()) from exc
        raise
    if "access_token" not in payload:
        raise ValueError("Google token response did not include an access token.")
    if "refresh_token" not in payload:
        existing = load_tokens(config_dir, config, redirect_uri) or {}
        refresh_token = str(existing.get("refresh_token") or "").strip()
        if refresh_token:
            payload["refresh_token"] = refresh_token
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

    form_body: dict[str, Any] = {
        "refresh_token": refresh_token,
        "client_id": settings.get("client_id"),
        "grant_type": "refresh_token",
    }
    client_secret = token_request_client_secret(settings)
    if client_secret:
        form_body["client_secret"] = client_secret

    try:
        payload = request_json(
            "https://oauth2.googleapis.com/token",
            method="POST",
            form=True,
            body=form_body,
        )
    except ValueError as exc:
        if "client_secret is missing" in str(exc).lower() and not client_secret:
            raise ValueError(missing_client_secret_message()) from exc
        raise
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


def youtube_upload(access_token: str, url: str, data: bytes, content_type: str) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
            "Content-Type": content_type or "application/octet-stream",
        },
    )
    assert_quota_available(url)
    try:
        with urllib.request.urlopen(request, timeout=45.0) as response:
            raw = response.read()
    except urllib.error.HTTPError as exc:
        raw = exc.read() if hasattr(exc, "read") else b""
        message = parse_api_error(raw, f"HTTP {exc.code} from {url}")
        if is_youtube_data_api_url(url) and is_quota_error_message(message):
            set_quota_cooldown()
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


def connected_account_profile(access_token: str) -> dict[str, Any]:
    payload = youtube_get(
        access_token,
        "https://www.googleapis.com/youtube/v3/channels?part=id,snippet,statistics&mine=true&maxResults=1",
    )
    items = payload.get("items")
    if not isinstance(items, list) or not items:
        return {}
    channel = items[0] if isinstance(items[0], dict) else {}
    snippet = channel.get("snippet", {}) if isinstance(channel.get("snippet"), dict) else {}
    statistics = channel.get("statistics", {}) if isinstance(channel.get("statistics"), dict) else {}
    return {
        "channel_id": channel.get("id"),
        "channel_title": snippet.get("title"),
        "channel_handle": snippet.get("customUrl"),
        "subscriber_count": statistics.get("subscriberCount"),
        "hidden_subscriber_count": bool(statistics.get("hiddenSubscriberCount")),
    }


def best_thumbnail_url(thumbnails: Any) -> str:
    if not isinstance(thumbnails, dict):
        return ""
    for name in ("maxres", "standard", "high", "medium", "default"):
        item = thumbnails.get(name)
        if isinstance(item, dict):
            url = str(item.get("url") or "").strip()
            if url:
                return url
    return ""


def stream_details_from_resource(stream: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(stream, dict):
        return {}
    snippet = stream.get("snippet", {}) if isinstance(stream.get("snippet"), dict) else {}
    cdn = stream.get("cdn", {}) if isinstance(stream.get("cdn"), dict) else {}
    ingestion = cdn.get("ingestionInfo", {}) if isinstance(cdn.get("ingestionInfo"), dict) else {}
    content_details = stream.get("contentDetails", {}) if isinstance(stream.get("contentDetails"), dict) else {}
    status = stream.get("status", {}) if isinstance(stream.get("status"), dict) else {}
    primary = str(ingestion.get("rtmpsIngestionAddress") or ingestion.get("ingestionAddress") or "").strip()
    backup = str(ingestion.get("rtmpsBackupIngestionAddress") or ingestion.get("backupIngestionAddress") or "").strip()
    return {
        "id": str(stream.get("id") or ""),
        "title": snippet.get("title", ""),
        "description": snippet.get("description", ""),
        "stream_name": stream_name_from_resource(stream),
        "ingestion_type": cdn.get("ingestionType", ""),
        "resolution": cdn.get("resolution", ""),
        "frame_rate": cdn.get("frameRate", ""),
        "primary_ingestion_address": primary,
        "backup_ingestion_address": backup,
        "has_backup_ingestion": bool(backup),
        "is_reusable": bool(content_details.get("isReusable")),
        "stream_status": status.get("streamStatus", ""),
        "health_status": status.get("healthStatus", {}),
    }


def broadcast_from_resource(
    access_token: str,
    item: dict[str, Any],
    *,
    include_stream_details: bool = False,
) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    snippet = item.get("snippet", {}) if isinstance(item.get("snippet"), dict) else {}
    status = item.get("status", {}) if isinstance(item.get("status"), dict) else {}
    content_details = item.get("contentDetails", {}) if isinstance(item.get("contentDetails"), dict) else {}
    broadcast_id = str(item.get("id") or "")
    bound_stream_id = str(content_details.get("boundStreamId") or "")
    stream = live_stream_by_id(access_token, bound_stream_id) if include_stream_details and bound_stream_id else None
    stream_details = stream_details_from_resource(stream)
    return {
        "id": broadcast_id,
        "title": snippet.get("title"),
        "description": snippet.get("description", ""),
        "thumbnail_url": best_thumbnail_url(snippet.get("thumbnails")),
        "thumbnails": snippet.get("thumbnails", {}),
        "scheduled_start_time": snippet.get("scheduledStartTime", ""),
        "scheduled_end_time": snippet.get("scheduledEndTime", ""),
        "live_chat_id": snippet.get("liveChatId", ""),
        "privacy_status": status.get("privacyStatus", ""),
        "life_cycle_status": status.get("lifeCycleStatus", ""),
        "made_for_kids": status.get("selfDeclaredMadeForKids", status.get("madeForKids", "")),
        "auto_start": content_details.get("enableAutoStart", ""),
        "auto_stop": content_details.get("enableAutoStop", ""),
        "enable_dvr": content_details.get("enableDvr", ""),
        "record_from_start": content_details.get("recordFromStart", ""),
        "latency_preference": content_details.get("latencyPreference", ""),
        "projection": content_details.get("projection", ""),
        "monitor_stream": content_details.get("monitorStream", {}),
        "bound_stream_id": bound_stream_id,
        "stream": stream_details,
        "stream_name": stream_details.get("stream_name", ""),
        "stream_title": stream_details.get("title", ""),
        "stream_resolution": stream_details.get("resolution", ""),
        "stream_frame_rate": stream_details.get("frame_rate", ""),
        "has_backup_ingestion": bool(stream_details.get("has_backup_ingestion")),
        "primary_ingestion_address": stream_details.get("primary_ingestion_address", ""),
        "backup_ingestion_address": stream_details.get("backup_ingestion_address", ""),
        "studio_url": f"https://studio.youtube.com/video/{broadcast_id}/livestreaming" if broadcast_id else "",
    }


def list_broadcasts_by_status(
    access_token: str,
    status: str,
    limit: int = 25,
    *,
    include_stream_details: bool = False,
) -> list[dict[str, Any]]:
    payload = youtube_get(
        access_token,
        "https://www.googleapis.com/youtube/v3/liveBroadcasts"
        f"?part=id,snippet,status,contentDetails&broadcastStatus={urllib.parse.quote(status)}&broadcastType=all&maxResults={max(1, min(limit, 50))}",
    )
    items = payload.get("items")
    if not isinstance(items, list):
        return []
    results: list[dict[str, Any]] = []
    for item in items:
        result = broadcast_from_resource(access_token, item, include_stream_details=include_stream_details)
        if result:
            results.append(result)
    return results


def broadcast_by_id(
    access_token: str,
    broadcast_id: str,
    *,
    include_stream_details: bool = True,
) -> dict[str, Any] | None:
    broadcast_id = str(broadcast_id or "").strip()
    if not broadcast_id:
        return None
    payload = youtube_get(
        access_token,
        "https://www.googleapis.com/youtube/v3/liveBroadcasts"
        f"?part=id,snippet,status,contentDetails&id={urllib.parse.quote(broadcast_id)}",
    )
    items = payload.get("items")
    if not isinstance(items, list) or not items:
        return None
    first = items[0]
    return broadcast_from_resource(access_token, first, include_stream_details=include_stream_details) if isinstance(first, dict) else None


def broadcast_chat_details_by_id(access_token: str, broadcast_id: str) -> dict[str, Any] | None:
    broadcast_id = str(broadcast_id or "").strip()
    if not broadcast_id:
        return None
    payload = youtube_get(
        access_token,
        "https://www.googleapis.com/youtube/v3/liveBroadcasts"
        f"?part=id,snippet,status&id={urllib.parse.quote(broadcast_id)}",
    )
    items = payload.get("items")
    if not isinstance(items, list) or not items:
        return None
    item = items[0] if isinstance(items[0], dict) else {}
    snippet = item.get("snippet", {}) if isinstance(item.get("snippet"), dict) else {}
    status = item.get("status", {}) if isinstance(item.get("status"), dict) else {}
    return {
        "id": str(item.get("id") or ""),
        "title": str(snippet.get("title") or ""),
        "live_chat_id": str(snippet.get("liveChatId") or ""),
        "life_cycle_status": str(status.get("lifeCycleStatus") or ""),
    }


def list_upcoming_broadcasts(
    access_token: str,
    limit: int = 25,
    *,
    include_stream_details: bool = False,
) -> list[dict[str, Any]]:
    results_by_id: dict[str, dict[str, Any]] = {}
    for status in ("upcoming", "active"):
        for item in list_broadcasts_by_status(access_token, status, limit, include_stream_details=include_stream_details):
            broadcast_id = str(item.get("id") or "")
            if broadcast_id and broadcast_id not in results_by_id:
                results_by_id[broadcast_id] = item

    if not results_by_id:
        for item in list_broadcasts_by_status(access_token, "all", limit, include_stream_details=include_stream_details):
            life_cycle_status = str(item.get("life_cycle_status") or "").lower()
            if life_cycle_status in {"complete", "revoked"}:
                continue
            broadcast_id = str(item.get("id") or "")
            if broadcast_id and broadcast_id not in results_by_id:
                results_by_id[broadcast_id] = item

    return list(results_by_id.values())


def live_chat_message_from_resource(item: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    snippet = item.get("snippet", {}) if isinstance(item.get("snippet"), dict) else {}
    author = item.get("authorDetails", {}) if isinstance(item.get("authorDetails"), dict) else {}
    raw_message_text = live_chat_message_text_from_snippet(snippet)
    display_message = str(snippet.get("displayMessage") or raw_message_text).strip()
    message_text = replace_youtube_emoji_shortcodes(raw_message_text or display_message)
    display_message = replace_youtube_emoji_shortcodes(display_message or message_text)
    return {
        "id": str(item.get("id") or ""),
        "type": str(snippet.get("type") or ""),
        "published_at": str(snippet.get("publishedAt") or ""),
        "display_message": display_message,
        "message_text": message_text,
        "message_parts": live_chat_message_parts_from_snippet(snippet, display_message),
        "author_channel_id": str(author.get("channelId") or ""),
        "author_display_name": str(author.get("displayName") or ""),
        "author_profile_image_url": str(author.get("profileImageUrl") or ""),
        "is_chat_owner": bool(author.get("isChatOwner")),
        "is_chat_moderator": bool(author.get("isChatModerator")),
        "is_chat_sponsor": bool(author.get("isChatSponsor")),
        "is_verified": bool(author.get("isVerified")),
    }


def list_live_chat_messages(
    access_token: str,
    *,
    live_chat_id: str,
    page_token: str = "",
    max_results: int = 200,
) -> dict[str, Any]:
    live_chat_id = str(live_chat_id or "").strip()
    if not live_chat_id:
        raise ValueError("Live chat ID is required.")
    clamped_max = max(200, min(int(max_results or 200), 2000))
    params = {
        "part": "id,snippet,authorDetails",
        "liveChatId": live_chat_id,
        "maxResults": str(clamped_max),
        "profileImageSize": "48",
    }
    if page_token:
        params["pageToken"] = str(page_token)
    payload = youtube_get(
        access_token,
        "https://www.googleapis.com/youtube/v3/liveChat/messages?" + urllib.parse.urlencode(params),
    )
    raw_items = payload.get("items")
    if not isinstance(raw_items, list):
        raw_items = []
    messages = [
        message
        for message in (live_chat_message_from_resource(item) for item in raw_items)
        if message
    ]
    return {
        "messages": messages,
        "next_page_token": str(payload.get("nextPageToken") or ""),
        "polling_interval_millis": int(float(payload.get("pollingIntervalMillis") or 5000)),
        "offline_at": str(payload.get("offlineAt") or ""),
    }


def send_live_chat_message(access_token: str, *, live_chat_id: str, message_text: str) -> dict[str, Any]:
    live_chat_id = str(live_chat_id or "").strip()
    message_text = str(message_text or "").strip()
    if not live_chat_id:
        raise ValueError("Live chat ID is required.")
    if not message_text:
        raise ValueError("Message text is required.")
    payload = youtube_post(
        access_token,
        "https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet",
        body={
            "snippet": {
                "liveChatId": live_chat_id,
                "type": "textMessageEvent",
                "textMessageDetails": {
                    "messageText": message_text,
                },
            },
        },
    )
    return live_chat_message_from_resource(payload) or payload


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


def upload_thumbnail(access_token: str, *, video_id: str, image_data: bytes, content_type: str) -> dict[str, Any]:
    if not video_id:
        raise ValueError("Broadcast ID is required for thumbnail upload.")
    if not image_data:
        raise ValueError("Thumbnail upload is empty.")
    return youtube_upload(
        access_token,
        "https://www.googleapis.com/upload/youtube/v3/thumbnails/set"
        f"?videoId={urllib.parse.quote(video_id)}",
        image_data,
        content_type,
    )


def video_details(access_token: str, video_id: str) -> dict[str, Any] | None:
    video_id = str(video_id or "").strip()
    if not video_id:
        return None
    try:
        payload = youtube_get(
            access_token,
            "https://www.googleapis.com/youtube/v3/videos"
            f"?part=snippet&id={urllib.parse.quote(video_id)}",
        )
        items = payload.get("items")
        if isinstance(items, list) and items:
            first = items[0]
            if isinstance(first, dict):
                snippet = first.get("snippet", {})
                return {
                    "category_id": snippet.get("categoryId"),
                    "tags": snippet.get("tags"),
                    "default_language": snippet.get("defaultLanguage"),
                    "default_audio_language": snippet.get("defaultAudioLanguage"),
                }
    except Exception:
        pass
    return None


def update_video_details(
    access_token: str,
    *,
    video_id: str,
    title: str,
    description: str,
    category_id: str | None = None,
    tags: list[str] | None = None,
    default_language: str | None = None,
    default_audio_language: str | None = None,
) -> dict[str, Any]:
    snippet: dict[str, Any] = {
        "title": title,
        "description": description,
    }
    if category_id:
        snippet["categoryId"] = category_id
    if tags:
        snippet["tags"] = tags
    if default_language:
        snippet["defaultLanguage"] = default_language
    if default_audio_language:
        snippet["defaultAudioLanguage"] = default_audio_language

    return request_json(
        "https://www.googleapis.com/youtube/v3/videos?part=snippet",
        method="PUT",
        headers={"Authorization": f"Bearer {access_token}"},
        body={
            "id": video_id,
            "snippet": snippet,
        },
    )


def copy_video_thumbnail(access_token: str, src_video_id: str, dest_video_id: str, thumbnail_url: str) -> bool:
    if not thumbnail_url or not dest_video_id:
        return False
    try:
        import urllib.request
        req = urllib.request.Request(
            thumbnail_url,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
        )
        with urllib.request.urlopen(req, timeout=15) as response:
            image_data = response.read()
            content_type = response.headers.get("Content-Type") or "image/jpeg"
            upload_thumbnail(
                access_token,
                video_id=dest_video_id,
                image_data=image_data,
                content_type=content_type,
            )
            return True
    except Exception:
        return False


def find_upcoming_broadcast_for_stream(access_token: str, stream_id: str) -> dict[str, Any] | None:
    stream_id = str(stream_id or "").strip()
    if not stream_id:
        return None
    try:
        upcoming = list_upcoming_broadcasts(access_token, include_stream_details=False)
        for b in upcoming:
            if str(b.get("bound_stream_id") or "").strip() == stream_id:
                return b
    except Exception:
        pass
    return None
