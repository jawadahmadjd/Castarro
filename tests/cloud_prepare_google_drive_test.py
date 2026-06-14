#!/usr/bin/env python3
"""Smoke-test Google Drive cloud video preparation."""

from __future__ import annotations

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import web_ui  # noqa: E402


class FakeProxy:
    def __init__(self) -> None:
        self.registered: list[str] = []
        self.removed: list[str] = []

    def register_asset(self, asset) -> str:
        self.registered.append(asset.asset_id)
        return f"http://127.0.0.1:8876/assets/test/{asset.asset_id}"

    def unregister_asset(self, asset_id: str) -> None:
        self.removed.append(asset_id)


class FakeDriveProvider:
    def __init__(self, _root, provider) -> None:
        self.provider = provider

    def get_file_metadata(self, file_id: str) -> dict[str, object]:
        return {
            "id": file_id,
            "name": "ready.mp4",
            "mimeType": "video/mp4",
            "size": "2048",
            "modifiedTime": "2026-06-11T00:00:00Z",
            "md5Checksum": "abc123",
            "capabilities": {"canDownload": True},
        }

    def read_range(self, _file_id: str, start: int, end: int) -> bytes:
        return b"x" * max(0, end - start + 1)


def main() -> int:
    original_provider = web_ui.google_drive_provider.GoogleDriveProvider
    original_validate = web_ui.google_drive_provider.validate_drive_file_metadata
    original_proxy = web_ui.ensure_cloud_proxy
    original_ffprobe = web_ui.cloud_probe.ffprobe_url
    original_report = web_ui.cloud_probe.report_from_ffprobe_payload
    try:
        fake_proxy = FakeProxy()
        web_ui.google_drive_provider.GoogleDriveProvider = FakeDriveProvider
        web_ui.google_drive_provider.validate_drive_file_metadata = lambda metadata: metadata
        web_ui.ensure_cloud_proxy = lambda config: fake_proxy
        web_ui.cloud_probe.ffprobe_url = lambda _ffprobe_path, _source_url: {"streams": [], "format": {}}
        web_ui.cloud_probe.report_from_ffprobe_payload = lambda payload, **kwargs: {
            "compatibilityStatus": "ready",
            "compatibilityMessage": "Ready to stream",
            "durationMs": 60000,
            "container": "mp4",
            "videoCodec": "h264",
            "audioCodec": "aac",
            "width": 1920,
            "height": 1080,
            "fps": 30,
            "audioSampleRate": 48000,
            "audioChannels": 2,
        }

        config = {
            "defaults": {"ffprobe_path": "ffprobe", "runtime_dir": ".runtime"},
            "storage": {"source_proxy": {"host": "127.0.0.1", "port": 8876, "cache_dir": ".runtime/cloud-cache"}},
        }
        provider = {
            "id": "google-drive-main",
            "type": "googleDrive",
            "display_name": "Google Drive",
            "tokens_file": ".runtime/google_drive_tokens_google-drive-main.json",
            "oauth": {"client_id": "desktop-client-id"},
        }

        item = web_ui.prepare_google_drive_cloud_video(config, provider, "drive-file-1")
        assert item["provider_id"] == "google-drive-main", item
        assert item["file_id"] == "drive-file-1", item
        assert item["compatibility_status"] == "ready", item
        assert item["range_readable"] is True, item
        assert item["duration_ms"] == 60000, item
        assert fake_proxy.registered, "probe asset should be registered"
        assert fake_proxy.removed == fake_proxy.registered, "probe asset should be unregistered"
    finally:
        web_ui.google_drive_provider.GoogleDriveProvider = original_provider
        web_ui.google_drive_provider.validate_drive_file_metadata = original_validate
        web_ui.ensure_cloud_proxy = original_proxy
        web_ui.cloud_probe.ffprobe_url = original_ffprobe
        web_ui.cloud_probe.report_from_ffprobe_payload = original_report

    print("cloud_prepare_google_drive_test: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
