"""Google Drive storage-provider adapter skeleton.

The live stream path must read Drive files through Castarro's source proxy.
This module owns Drive-specific validation and will later own Drive API calls.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import storage_providers


DRIVE_VIDEO_MIME_PREFIX = "video/"
NATIVE_GOOGLE_MIME_PREFIX = "application/vnd.google-apps."


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


class GoogleDriveProvider:
    def __init__(self, root: Path, provider: dict[str, Any]) -> None:
        self.root = root
        self.provider = provider

    def status(self) -> dict[str, Any]:
        return storage_providers.provider_status(self.root, self.provider)

    def list_files(self, folder_id: str | None = None) -> dict[str, Any]:
        status = self.status()
        if not status.get("connected"):
            return {
                "ok": False,
                "provider_id": self.provider.get("id"),
                "files": [],
                "message": "Connect Google Drive before browsing cloud videos.",
            }
        return {
            "ok": False,
            "provider_id": self.provider.get("id"),
            "folder_id": folder_id or "",
            "files": [],
            "message": "Google Drive file listing is not wired yet.",
        }
