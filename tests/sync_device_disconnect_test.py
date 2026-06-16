#!/usr/bin/env python3
"""Regression checks for removing paired sync devices."""

from __future__ import annotations

import tempfile
import time
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import app_db  # noqa: E402
import sync_service  # noqa: E402
import web_ui  # noqa: E402


def assert_disconnect_sync_device_removes_store_entry_and_token() -> None:
    original_accounts_path = sync_service.ACCOUNTS_PATH
    original_state = web_ui.STATE
    original_record_event = app_db.record_event

    with tempfile.TemporaryDirectory(prefix="castarro-sync-disconnect-", dir=str(ROOT)) as temp_dir:
        runtime_path = Path(temp_dir) / "sync_accounts.json"
        events: list[tuple[str, dict]] = []

        sync_service.ACCOUNTS_PATH = runtime_path
        web_ui.STATE = web_ui.AppState()
        app_db.record_event = lambda name, **kwargs: events.append((name, kwargs))

        try:
            account = sync_service.create_account("desktop-sync-test", "secret123", "Desktop")
            removed_device = sync_service.remember_device(account["id"], "device-a", "Pixel 8", "android")
            kept_device = sync_service.remember_device(account["id"], "device-b", "Galaxy S24", "android")

            web_ui.STATE.sync_tokens["token-remove"] = {
                "device": removed_device,
                "expiresAt": time.time() + 60,
            }
            web_ui.STATE.sync_tokens["token-keep"] = {
                "device": kept_device,
                "expiresAt": time.time() + 60,
            }

            payload = web_ui.disconnect_sync_device({"deviceId": "device-a"})

            remaining_ids = {device["id"] for device in payload["devices"]}
            assert remaining_ids == {"device-b"}
            assert "token-remove" not in web_ui.STATE.sync_tokens
            assert "token-keep" in web_ui.STATE.sync_tokens
            assert payload["removed"] is True
            assert events and events[0][0] == "sync_device_disconnected"
        finally:
            sync_service.ACCOUNTS_PATH = original_accounts_path
            web_ui.STATE = original_state
            app_db.record_event = original_record_event


def main() -> int:
    assert_disconnect_sync_device_removes_store_entry_and_token()
    print("sync_device_disconnect_test: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
