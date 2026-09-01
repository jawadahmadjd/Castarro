"""Google Drive storage-provider adapter."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

import storage_providers
import youtube_service


DRIVE_VIDEO_MIME_PREFIX = "video/"
NATIVE_GOOGLE_MIME_PREFIX = "application/vnd.google-apps."
GOOGLE_DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder"
GOOGLE_DRIVE_API = "https://www.googleapis.com/drive/v3"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"


def provider_oauth(provider: dict[str, Any]) -> dict[str, Any]:
    return storage_providers.normalize_provider_oauth("googleDrive", provider.get("oauth"))


def credentials_ready(provider: dict[str, Any]) -> bool:
    oauth = provider_oauth(provider)
    client_id = str(oauth.get("client_id") or "").strip()
    client_secret = str(oauth.get("client_secret") or "").strip()
    if oauth.get("oauth_client_type") == "web":
        return bool(client_id and client_secret)
    return bool(client_id)


def validate_drive_file_metadata(metadata: dict[str, Any]) -> dict[str, Any]:
    mime_type = str(metadata.get("mimeType") or metadata.get("mime_type") or "").strip()
    if mime_type.startswith(NATIVE_GOOGLE_MIME_PREFIX):
        raise ValueError("Google Docs, Sheets, and Slides files cannot be streamed as video sources.")
    if mime_type and not mime_type.startswith(DRIVE_VIDEO_MIME_PREFIX):
        raise ValueError(f"Selected Drive file is not a video: {mime_type}")
    capabilities = metadata.get("capabilities")
    if isinstance(capabilities, dict) and capabilities.get("canDownload") is False:
        raise ValueError("This Google Drive file cannot be downloaded.")
    return metadata


def build_auth_url(provider: dict[str, Any], oauth_state: str, redirect_uri: str, *, code_challenge: str | None = None) -> str:
    oauth = provider_oauth(provider)
    client_id = str(oauth.get("client_id") or "").strip()
    if not client_id:
        raise ValueError("Google Drive client ID is missing.")

    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(oauth.get("scopes") or []),
        "access_type": "offline",
        "include_granted_scopes": "true",
        "prompt": "consent",
        "state": oauth_state,
    }
    if code_challenge:
        params["code_challenge"] = code_challenge
        params["code_challenge_method"] = "S256"
    return "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(params)


def tokens_path(root: Path, provider: dict[str, Any]) -> Path:
    configured = str(provider.get("tokens_file") or "").strip() or storage_providers.provider_tokens_file(
        str(provider.get("id") or "google-drive-main"),
        "googleDrive",
    )
    path = Path(configured)
    if not path.is_absolute():
        path = (root / path).resolve()
    if path.parent:
        path.parent.mkdir(parents=True, exist_ok=True)
    return path


def load_tokens(root: Path, provider: dict[str, Any]) -> dict[str, Any] | None:
    path = tokens_path(root, provider)
    if not path.exists():
        return None
    try:
        raw_text = path.read_text(encoding="utf-8")
        data = json.loads(raw_text)
        if isinstance(data, dict) and "encrypted_payload" in data:
            decrypted_bytes = _decrypt_str(str(data["encrypted_payload"]))
            return json.loads(decrypted_bytes.decode("utf-8"))
        if isinstance(data, dict) and ("access_token" in data or "refresh_token" in data):
            save_tokens(root, provider, data)
            return data
        return data
    except Exception as exc:
        raise ValueError(f"Could not read Google Drive token file: {exc}") from exc


def save_tokens(root: Path, provider: dict[str, Any], tokens: dict[str, Any]) -> dict[str, Any]:
    path = tokens_path(root, provider)
    prepared = dict(tokens)
    now = int(time.time())
    prepared["obtained_at"] = int(prepared.get("obtained_at") or now)
    expires_in = int(float(prepared.get("expires_in") or 0))
    if expires_in > 0:
        prepared["expires_at"] = prepared["obtained_at"] + expires_in

    token_bytes = json.dumps(prepared, indent=2).encode("utf-8")
    encrypted = _encrypt_bytes(token_bytes)
    wrapper = {
        "encrypted_payload": encrypted,
        "updated_at": now,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(f".tmp.{os.getpid()}_{secrets.token_hex(4)}")
    try:
        temp_path.write_text(json.dumps(wrapper, indent=2) + "\n", encoding="utf-8")
        temp_path.replace(path)
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except Exception:
                pass
    return prepared


def clear_tokens(root: Path, provider: dict[str, Any]) -> None:
    tokens_path(root, provider).unlink(missing_ok=True)


def exchange_code_for_tokens(
    root: Path,
    provider: dict[str, Any],
    authorization_code: str,
    redirect_uri: str,
    *,
    code_verifier: str | None = None,
) -> dict[str, Any]:
    oauth = provider_oauth(provider)
    client_id = str(oauth.get("client_id") or "").strip()
    client_secret = youtube_service.token_request_client_secret(oauth)
    if not client_id:
        raise ValueError("Missing Google Drive OAuth client ID.")
    if oauth.get("oauth_client_type") == "web" and not client_secret:
        raise ValueError("Missing Google Drive OAuth client secret for web OAuth client.")

    form_body: dict[str, Any] = {
        "code": authorization_code,
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }
    if client_secret:
        form_body["client_secret"] = client_secret
    if code_verifier:
        form_body["code_verifier"] = code_verifier
    payload = youtube_service.request_json(
        GOOGLE_TOKEN_URL,
        method="POST",
        form=True,
        body=form_body,
    )
    if "access_token" not in payload:
        raise ValueError("Google token response did not include an access token.")
    if "refresh_token" not in payload:
        existing = load_tokens(root, provider) or {}
        refresh_token = str(existing.get("refresh_token") or "").strip()
        if refresh_token:
            payload["refresh_token"] = refresh_token
    payload["obtained_at"] = int(time.time())
    return save_tokens(root, provider, payload)


def refresh_access_token(root: Path, provider: dict[str, Any], tokens: dict[str, Any]) -> dict[str, Any]:
    oauth = provider_oauth(provider)
    refresh_token = str(tokens.get("refresh_token") or "").strip()
    if not refresh_token:
        raise ValueError("No refresh token is available. Reconnect Google Drive.")

    form_body: dict[str, Any] = {
        "refresh_token": refresh_token,
        "client_id": oauth.get("client_id"),
        "grant_type": "refresh_token",
    }
    client_secret = youtube_service.token_request_client_secret(oauth)
    if client_secret:
        form_body["client_secret"] = client_secret

    payload = youtube_service.request_json(
        GOOGLE_TOKEN_URL,
        method="POST",
        form=True,
        body=form_body,
    )
    if "access_token" not in payload:
        raise ValueError("Token refresh did not return an access token.")

    merged = dict(tokens)
    merged.update(payload)
    merged["refresh_token"] = refresh_token
    merged["obtained_at"] = int(time.time())
    return save_tokens(root, provider, merged)


def valid_access_token(root: Path, provider: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    tokens = load_tokens(root, provider)
    if not tokens:
        raise ValueError("Google Drive is not connected yet.")
    if youtube_service.token_expired(tokens):
        tokens = refresh_access_token(root, provider, tokens)
    access_token = str(tokens.get("access_token") or "").strip()
    if not access_token:
        raise ValueError("Google Drive access token is missing. Reconnect Google Drive.")
    return access_token, tokens


def google_get_json(access_token: str, url: str) -> dict[str, Any]:
    return youtube_service.request_json(url, headers={"Authorization": f"Bearer {access_token}"})


def google_get_bytes(access_token: str, url: str, *, headers: dict[str, str] | None = None) -> bytes:
    request_headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "*/*",
    }
    if headers:
        request_headers.update(headers)
    request = urllib.request.Request(url, method="GET", headers=request_headers)
    try:
        with urllib.request.urlopen(request, timeout=45.0) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        raw = exc.read() if hasattr(exc, "read") else b""
        message = youtube_service.parse_api_error(raw, f"HTTP {exc.code} from Google Drive")
        raise ValueError(message) from exc
    except urllib.error.URLError as exc:
        raise ValueError(f"Network error while reaching Google Drive: {exc.reason}") from exc


def connected_account_profile(access_token: str) -> dict[str, Any]:
    payload = google_get_json(access_token, GOOGLE_USERINFO_URL)
    return {
        "email": str(payload.get("email") or "").strip(),
        "name": str(payload.get("name") or "").strip(),
        "picture": str(payload.get("picture") or "").strip(),
    }


class GoogleDriveProvider:
    def __init__(self, root: Path, provider: dict[str, Any]) -> None:
        self.root = root
        self.provider = provider

    def status(self) -> dict[str, Any]:
        status = storage_providers.provider_status(self.root, self.provider)
        status["has_client_credentials"] = credentials_ready(self.provider)
        status["message"] = "Not connected."

        if not status["has_client_credentials"]:
            status["status"] = "disconnected"
            status["connected"] = False
            status["message"] = "Google Drive client ID is missing in Settings > Storage."
            return status

        try:
            tokens = load_tokens(self.root, self.provider)
        except Exception as exc:
            status["status"] = "error"
            status["connected"] = False
            status["message"] = str(exc)
            return status

        if not tokens:
            status["status"] = "disconnected"
            status["connected"] = False
            status["message"] = "Connect Google Drive to browse cloud videos."
            return status

        status["expires_at"] = tokens.get("expires_at")
        try:
            access_token, refreshed = valid_access_token(self.root, self.provider)
            profile = connected_account_profile(access_token)
        except Exception as exc:
            status["status"] = "expired"
            status["connected"] = False
            status["message"] = str(exc)
            return status

        status["status"] = "connected"
        status["connected"] = True
        status["expires_at"] = refreshed.get("expires_at")
        status["account_email"] = str(profile.get("email") or status.get("account_email") or "")
        status["account_name"] = str(profile.get("name") or "")
        status["message"] = f"Connected as {status['account_email'] or 'Google account'}."
        return status

    def list_files(self, folder_id: str | None = None) -> dict[str, Any]:
        status = self.status()
        provider_id = str(self.provider.get("id") or "")
        if not status.get("connected"):
            return {
                "ok": False,
                "provider_id": provider_id,
                "folder": {"id": folder_id or "root", "name": "Google Drive"},
                "items": [],
                "message": status.get("message") or "Connect Google Drive before browsing cloud videos.",
            }

        access_token, _tokens = valid_access_token(self.root, self.provider)
        parent_id = folder_id or "root"
        fields = ",".join(
            [
                "nextPageToken",
                "files(id,name,mimeType,size,modifiedTime,md5Checksum,parents,capabilities/canDownload)",
            ]
        )
        q = f"'{parent_id}' in parents and trashed = false and (mimeType = '{GOOGLE_DRIVE_FOLDER_MIME}' or mimeType contains 'video/')"
        params = {
            "fields": fields,
            "pageSize": "100",
            "orderBy": "folder,name_natural",
            "q": q,
            "supportsAllDrives": "true",
            "includeItemsFromAllDrives": "true",
        }
        payload = google_get_json(access_token, f"{GOOGLE_DRIVE_API}/files?{urllib.parse.urlencode(params)}")
        raw_items = payload.get("files") if isinstance(payload.get("files"), list) else []
        items = [self.browser_item(item) for item in raw_items if isinstance(item, dict)]
        items.sort(key=lambda item: (0 if item.get("kind") == "folder" else 1, str(item.get("name") or "").lower()))

        folder_info = {"id": parent_id, "name": "My Drive"}
        if folder_id and folder_id != "root":
            try:
                folder_meta = self.get_file_metadata(folder_id)
                folder_info = {
                    "id": str(folder_meta.get("id") or folder_id),
                    "name": str(folder_meta.get("name") or "Folder"),
                    "parent_id": str((folder_meta.get("parents") or [None])[0] or ""),
                }
            except Exception:
                folder_info["id"] = folder_id

        return {
            "ok": True,
            "provider_id": provider_id,
            "folder": folder_info,
            "items": items,
            "message": f"{len(items)} item{'s' if len(items) != 1 else ''} loaded.",
        }

    def get_file_metadata(self, file_id: str) -> dict[str, Any]:
        access_token, _tokens = valid_access_token(self.root, self.provider)
        params = {
            "fields": "id,name,mimeType,size,modifiedTime,md5Checksum,capabilities/canDownload,parents",
            "supportsAllDrives": "true",
        }
        payload = google_get_json(
            access_token,
            f"{GOOGLE_DRIVE_API}/files/{urllib.parse.quote(file_id)}?{urllib.parse.urlencode(params)}",
        )
        if not isinstance(payload, dict):
            raise ValueError("Unexpected Google Drive metadata response.")
        return payload

    def read_range(self, file_id: str, start: int, end: int) -> bytes:
        access_token, _tokens = valid_access_token(self.root, self.provider)
        url = f"{GOOGLE_DRIVE_API}/files/{urllib.parse.quote(file_id)}?alt=media&supportsAllDrives=true"
        return google_get_bytes(access_token, url, headers={"Range": f"bytes={int(start)}-{int(end)}"})

    def browser_item(self, metadata: dict[str, Any]) -> dict[str, Any]:
        mime_type = str(metadata.get("mimeType") or "").strip()
        item: dict[str, Any] = {
            "id": str(metadata.get("id") or ""),
            "name": str(metadata.get("name") or "Untitled"),
            "mimeType": mime_type,
            "sizeBytes": int(metadata.get("size") or 0) if str(metadata.get("size") or "").strip() else 0,
            "modifiedTime": str(metadata.get("modifiedTime") or ""),
            "canDownload": bool((metadata.get("capabilities") or {}).get("canDownload", mime_type == GOOGLE_DRIVE_FOLDER_MIME)),
        }
        if mime_type == GOOGLE_DRIVE_FOLDER_MIME:
            item["kind"] = "folder"
            return item

        item["kind"] = "video"
        item["sourceUri"] = f"castarro://cloud/{self.provider.get('id')}/{item['id']}"
        item["providerId"] = str(self.provider.get("id") or "")
        item["providerFileId"] = item["id"]
        return item
