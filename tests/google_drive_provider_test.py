#!/usr/bin/env python3
"""Smoke-test Google Drive provider helpers."""

from __future__ import annotations

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import google_drive_provider  # noqa: E402


def main() -> int:
    provider = {
        "id": "google-drive-main",
        "oauth": {
            "client_id": "desktop-client-id",
        },
    }
    assert google_drive_provider.credentials_ready(provider) is True
    assert google_drive_provider.credentials_ready({"id": "google-drive-main", "oauth": {}}) is False

    try:
        google_drive_provider.validate_drive_file_metadata({"mimeType": "application/vnd.google-apps.document"})
    except ValueError as exc:
        assert "cannot be streamed" in str(exc), exc
    else:
        raise AssertionError("Native Google file should be rejected.")

    try:
        google_drive_provider.validate_drive_file_metadata(
            {
                "mimeType": "video/mp4",
                "capabilities": {"canDownload": False},
            }
        )
    except ValueError as exc:
        assert "cannot be downloaded" in str(exc), exc
    else:
        raise AssertionError("Non-downloadable Drive file should be rejected.")

    adapter = google_drive_provider.GoogleDriveProvider(ROOT, provider)
    folder_item = adapter.browser_item(
        {
            "id": "folder-1",
            "name": "Folder A",
            "mimeType": google_drive_provider.GOOGLE_DRIVE_FOLDER_MIME,
            "capabilities": {"canDownload": False},
        }
    )
    assert folder_item["kind"] == "folder", folder_item

    video_item = adapter.browser_item(
        {
            "id": "video-1",
            "name": "ready.mp4",
            "mimeType": "video/mp4",
            "size": "1024",
            "capabilities": {"canDownload": True},
        }
    )
    assert video_item["kind"] == "video", video_item
    assert video_item["providerId"] == "google-drive-main", video_item
    assert video_item["providerFileId"] == "video-1", video_item
    assert video_item["sourceUri"] == "castarro://cloud/google-drive-main/video-1", video_item

    print("google_drive_provider_test: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
