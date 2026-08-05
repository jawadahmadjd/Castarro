#!/usr/bin/env python3
"""Contract tests for channel-scoped workspace scheduling and guardrails."""

from __future__ import annotations

import copy
from pathlib import Path
import sys
import tempfile
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import app_db  # noqa: E402
import web_ui  # noqa: E402


def make_config() -> dict:
    return {
        "defaults": {
            "ffmpeg_path": "ffmpeg",
            "ffprobe_path": "ffprobe",
            "rtmp_base": "rtmp://example.invalid/live2",
            "log_dir": "logs",
            "runtime_dir": ".runtime",
            "raw_dir": "Raw Videos",
            "normalized_dir": "Go Live",
            "normalized_playlist_dir": "playlists",
            "restart_delay_seconds": 10,
        },
        "youtube": {
            "client_id": "client",
            "client_secret": "secret",
            "oauth_client_type": "desktop",
            "use_pkce": True,
            "redirect_uri": "http://127.0.0.1:8765/oauth2redirect",
            "accounts": [
                {"id": "acct-a", "label": "Account A", "tokens_file": ".runtime/a.json"},
                {"id": "acct-b", "label": "Account B", "tokens_file": ".runtime/b.json"},
                {"id": "acct-c", "label": "Account C", "tokens_file": ".runtime/c.json"},
            ],
            "default_account_id": "",
            "default_privacy_status": "unlisted",
            "default_auto_start": True,
            "default_auto_stop": True,
        },
        "channels": [
            {"name": "A", "enabled": True, "youtube_account_id": "acct-a", "stream_key_env": "a-key"},
            {"name": "B", "enabled": True, "youtube_account_id": "acct-b", "stream_key_env": "b-key"},
            {"name": "C", "enabled": True, "youtube_account_id": "acct-c", "stream_key_env": "c-key"},
        ],
    }


def stub_created(stream_name: str) -> dict:
    return {
        "broadcast": {"id": f"broadcast-{stream_name}", "studio_url": "https://studio.youtube.com/test"},
        "stream": {"id": f"stream-{stream_name}", "stream_name": stream_name},
    }


def run_schedule(config: dict, body: dict, connected_slots: list[dict]) -> tuple[dict, dict]:
    working = copy.deepcopy(config)
    captured_save: dict = {}
    created_calls: list[dict] = []

    original_load = web_ui.load_config_or_none
    original_save = web_ui.save_config
    original_connected = web_ui.connected_account_slots
    original_valid_token = web_ui.youtube_service.valid_access_token
    original_profile = web_ui.youtube_service.connected_account_profile
    original_schedule = web_ui.youtube_service.schedule_broadcast

    def fake_load(_config_name: str):
        return working, None

    def fake_save(_config_name: str, updated: dict):
        captured_save["config"] = copy.deepcopy(updated)

    def fake_connected(_config: dict):
        return copy.deepcopy(connected_slots)

    def fake_valid_access_token(_root: Path, _config: dict):
        return "token", {"expires_at": "2099-01-01T00:00:00Z"}

    def fake_connected_account_profile(_token: str):
        return {
            "channel_id": f"yt-{body.get('channel')}",
            "channel_title": str(body.get("channel") or ""),
            "channel_handle": f"@{str(body.get('channel') or '').lower()}",
        }

    def fake_schedule_broadcast(_token: str, **kwargs):
        created_calls.append(kwargs)
        title = str(kwargs.get("title") or "untitled")
        return stub_created(f"{title.lower().replace(' ', '-')}-key")

    web_ui.load_config_or_none = fake_load
    web_ui.save_config = fake_save
    web_ui.connected_account_slots = fake_connected
    web_ui.youtube_service.valid_access_token = fake_valid_access_token
    web_ui.youtube_service.connected_account_profile = fake_connected_account_profile
    web_ui.youtube_service.schedule_broadcast = fake_schedule_broadcast
    try:
        response = web_ui.schedule_youtube("config.ready.json", body)
    finally:
        web_ui.load_config_or_none = original_load
        web_ui.save_config = original_save
        web_ui.connected_account_slots = original_connected
        web_ui.youtube_service.valid_access_token = original_valid_token
        web_ui.youtube_service.connected_account_profile = original_profile
        web_ui.youtube_service.schedule_broadcast = original_schedule

    assert created_calls, "schedule_broadcast should be called once"
    return response, captured_save.get("config", {})


def assert_channel_scoped_schedule_routes_to_linked_accounts() -> None:
    config = make_config()
    for channel_name, expected_account_id in (("A", "acct-a"), ("B", "acct-b"), ("C", "acct-c")):
        response, saved = run_schedule(
            config,
            {
                "channel": channel_name,
                "title": f"Show {channel_name}",
                "description": "",
                "privacy_status": "unlisted",
                "scheduled_start_time": "2030-01-01T00:00:00Z",
                "scheduled_end_time": "2030-01-01T01:00:00Z",
                "auto_start": True,
                "auto_stop": True,
            },
            connected_slots=[
                {"id": "acct-a", "label": "Account A"},
                {"id": "acct-b", "label": "Account B"},
                {"id": "acct-c", "label": "Account C"},
            ],
        )
        assert response["channel"] == channel_name
        assert response["account_id"] == expected_account_id
        assert response["account_label"], "account_label should be returned"
        assert "guard_reason" in response
        saved_channel = next(ch for ch in saved.get("channels", []) if ch.get("name") == channel_name)
        assert saved_channel.get("youtube_account_id") == expected_account_id
        assert saved_channel.get("youtube_stream_id"), "youtube_stream_id should be persisted"
        assert saved_channel.get("youtube_dual_stream") is True, "youtube_dual_stream should default to confirmed"


def assert_schedule_preserves_dual_stream_preference() -> None:
    config = make_config()
    config["channels"][0]["youtube_dual_stream"] = False
    _response, saved = run_schedule(
        config,
        {
            "channel": "A",
            "title": "Dual Stream Preference",
            "description": "",
            "privacy_status": "unlisted",
            "scheduled_start_time": "2030-01-01T00:00:00Z",
            "scheduled_end_time": "2030-01-01T01:00:00Z",
            "auto_start": True,
            "auto_stop": True,
        },
        connected_slots=[{"id": "acct-a", "label": "Account A"}],
    )
    saved_channel = next(ch for ch in saved.get("channels", []) if ch.get("name") == "A")
    assert saved_channel.get("youtube_dual_stream") is False


def assert_unlinked_channel_blocked_with_multiple_connected_accounts() -> None:
    config = make_config()
    for channel in config["channels"]:
        channel["youtube_account_id"] = ""

    original_load = web_ui.load_config_or_none
    original_connected = web_ui.connected_account_slots
    original_valid_token = web_ui.youtube_service.valid_access_token

    web_ui.load_config_or_none = lambda _name: (copy.deepcopy(config), None)
    web_ui.connected_account_slots = lambda _cfg: [
        {"id": "acct-a", "label": "Account A"},
        {"id": "acct-b", "label": "Account B"},
    ]
    web_ui.youtube_service.valid_access_token = lambda _root, _cfg: ("token", {})
    try:
        try:
            web_ui.schedule_youtube(
                "config.ready.json",
                {
                    "channel": "A",
                    "title": "Guard Check",
                    "description": "",
                    "privacy_status": "unlisted",
                    "scheduled_start_time": "2030-01-01T00:00:00Z",
                    "scheduled_end_time": "2030-01-01T01:00:00Z",
                    "auto_start": True,
                    "auto_stop": True,
                },
            )
        except ValueError as exc:
            text = str(exc)
            assert "missing_linked_account_multiple_connected" in text
        else:
            raise AssertionError("Expected ValueError for missing linked account with multiple connected accounts.")
    finally:
        web_ui.load_config_or_none = original_load
        web_ui.connected_account_slots = original_connected
        web_ui.youtube_service.valid_access_token = original_valid_token


def assert_unlinked_channel_blocked_with_single_connected_account() -> None:
    config = make_config()
    config["channels"][2]["youtube_account_id"] = ""

    original_load = web_ui.load_config_or_none
    original_connected = web_ui.connected_account_slots
    web_ui.load_config_or_none = lambda _name: (copy.deepcopy(config), None)
    web_ui.connected_account_slots = lambda _cfg: [{"id": "acct-c", "label": "Account C"}]
    try:
        try:
            web_ui.schedule_youtube(
                "config.ready.json",
                {
                    "channel": "C",
                    "title": "No Fallback C",
                    "description": "",
                    "privacy_status": "public",
                    "scheduled_start_time": "2030-01-01T00:00:00Z",
                    "scheduled_end_time": "2030-01-01T01:00:00Z",
                    "auto_start": True,
                    "auto_stop": True,
                },
            )
        except ValueError as exc:
            assert "missing_linked_account" in str(exc)
        else:
            raise AssertionError("Expected ValueError for unlinked channel even with one connected account.")
    finally:
        web_ui.load_config_or_none = original_load
        web_ui.connected_account_slots = original_connected


def assert_verify_reports_missing_account_as_nonfatal_status() -> None:
    config = make_config()
    config["channels"][0]["youtube_account_id"] = ""
    original_load = web_ui.load_config_or_none
    original_connected = web_ui.connected_account_slots
    web_ui.load_config_or_none = lambda _name: (copy.deepcopy(config), None)
    web_ui.connected_account_slots = lambda _cfg: []
    try:
        report = web_ui.verify_youtube_channel_keys("config.ready.json")
    finally:
        web_ui.load_config_or_none = original_load
        web_ui.connected_account_slots = original_connected
    checks = {item["channel"]: item for item in report["checks"]}
    assert checks["A"]["status"] == "missing_account"
    assert checks["A"]["guard_reason"] == "missing_linked_account"


def assert_requested_account_mismatch_is_rejected() -> None:
    config = make_config()
    original_load = web_ui.load_config_or_none
    original_connected = web_ui.connected_account_slots
    web_ui.load_config_or_none = lambda _name: (copy.deepcopy(config), None)
    web_ui.connected_account_slots = lambda _cfg: [
        {"id": "acct-a", "label": "Account A"},
        {"id": "acct-b", "label": "Account B"},
    ]
    try:
        try:
            web_ui.schedule_youtube(
                "config.ready.json",
                {
                    "channel": "A",
                    "title": "Mismatch",
                    "description": "",
                    "privacy_status": "unlisted",
                    "scheduled_start_time": "2030-01-01T00:00:00Z",
                    "scheduled_end_time": "2030-01-01T01:00:00Z",
                    "auto_start": True,
                    "auto_stop": True,
                    "account_id": "acct-b",
                },
            )
        except ValueError as exc:
            assert "does not match" in str(exc)
        else:
            raise AssertionError("Expected schedule rejection for channel/account mismatch.")
    finally:
        web_ui.load_config_or_none = original_load
        web_ui.connected_account_slots = original_connected


def assert_youtube_channel_name_matching_allows_clean_variations() -> None:
    match = web_ui.youtube_channel_name_match(
        "Inside Us 24/7!!!",
        {"channel_title": "Inside Us", "channel_handle": "@insideus"},
    )
    assert match["ok"], f"Expected cosmetic name differences to pass: {match}"

    account_channel = web_ui.youtube_channel_name_match(
        "Inside Us",
        {"channel_title": "Inside Us - Account channel", "channel_handle": "@insideus"},
    )
    assert account_channel["ok"], f"Expected account/channel suffix to pass: {account_channel}"

    official = web_ui.youtube_channel_name_match(
        "Inside Us",
        {"channel_title": "Inside Us Official", "channel_handle": "@insideusofficial"},
    )
    assert official["ok"], f"Expected official suffix to pass: {official}"

    mismatch = web_ui.youtube_channel_name_match(
        "Inside Us",
        {"channel_title": "Last Historical Moments", "channel_handle": "@lasthistoricalmoments"},
    )
    assert not mismatch["ok"], f"Expected unrelated channel names to fail: {mismatch}"


def assert_oauth_callback_persists_wrong_youtube_channel_name() -> None:
    config = make_config()
    config["channels"][0]["name"] = "Inside Us"
    captured: dict = {"cleared": False, "saved": None}
    state_key = "test-state-name-mismatch"

    original_load = web_ui.load_config_or_none
    original_save = web_ui.save_config
    original_exchange = web_ui.youtube_service.exchange_code_for_tokens
    original_valid_token = web_ui.youtube_service.valid_access_token
    original_profile = web_ui.youtube_service.connected_account_profile
    original_clear = web_ui.youtube_service.clear_tokens

    web_ui.load_config_or_none = lambda _name: (config, None)
    web_ui.save_config = lambda _name, updated: captured.__setitem__("saved", copy.deepcopy(updated))
    web_ui.youtube_service.exchange_code_for_tokens = lambda *_args, **_kwargs: None
    web_ui.youtube_service.valid_access_token = lambda *_args, **_kwargs: ("token", {})
    web_ui.youtube_service.connected_account_profile = lambda _token: {
        "channel_id": "yt-wrong",
        "channel_title": "Last Historical Moments",
        "channel_handle": "@lasthistoricalmoments",
    }
    web_ui.youtube_service.clear_tokens = lambda *_args, **_kwargs: captured.__setitem__("cleared", True)

    with web_ui.STATE.lock:
        web_ui.STATE.youtube_oauth_states[state_key] = {
            "created_at": web_ui.time.time(),
            "config_name": "config.ready.json",
            "account_id": "acct-a",
            "channel_name": "Inside Us",
            "code_verifier": "",
        }
    try:
        html = web_ui.handle_youtube_oauth_callback({"state": [state_key], "code": ["auth-code"]})
    finally:
        web_ui.load_config_or_none = original_load
        web_ui.save_config = original_save
        web_ui.youtube_service.exchange_code_for_tokens = original_exchange
        web_ui.youtube_service.valid_access_token = original_valid_token
        web_ui.youtube_service.connected_account_profile = original_profile
        web_ui.youtube_service.clear_tokens = original_clear
        with web_ui.STATE.lock:
            web_ui.STATE.youtube_oauth_states.pop(state_key, None)

    assert "does not look like Castarro channel" in html
    assert not captured["cleared"], "Wrong YouTube account tokens should remain available for Disconnect."
    saved = captured["saved"]
    assert saved, "Wrong YouTube channel profile should be saved so the UI can show Wrong."
    account = next(item for item in saved["youtube"]["accounts"] if item.get("id") == "acct-a")
    assert account.get("channel_title") == "Last Historical Moments"
    linked = next(ch for ch in saved["channels"] if ch.get("name") == "Inside Us")
    assert linked.get("youtube_account_id") == "acct-a"


def assert_oauth_callback_links_selected_channel() -> None:
    config = make_config()
    config["channels"][1]["name"] = "Sports Desk"
    config["channels"][1]["youtube_account_id"] = ""
    captured: dict = {"saved": None}
    state_key = "test-state-link-channel"

    original_load = web_ui.load_config_or_none
    original_save = web_ui.save_config
    original_exchange = web_ui.youtube_service.exchange_code_for_tokens
    original_valid_token = web_ui.youtube_service.valid_access_token
    original_profile = web_ui.youtube_service.connected_account_profile

    web_ui.load_config_or_none = lambda _name: (config, None)
    web_ui.save_config = lambda _name, updated: captured.__setitem__("saved", copy.deepcopy(updated))
    web_ui.youtube_service.exchange_code_for_tokens = lambda *_args, **_kwargs: None
    web_ui.youtube_service.valid_access_token = lambda *_args, **_kwargs: ("token", {})
    web_ui.youtube_service.connected_account_profile = lambda _token: {
        "channel_id": "yt-sports",
        "channel_title": "Sports Desk",
        "channel_handle": "@sportsdesk",
    }

    with web_ui.STATE.lock:
        web_ui.STATE.youtube_oauth_states[state_key] = {
            "created_at": web_ui.time.time(),
            "config_name": "config.ready.json",
            "account_id": "acct-b",
            "channel_name": "Sports Desk",
            "code_verifier": "",
        }
    try:
        html = web_ui.handle_youtube_oauth_callback({"state": [state_key], "code": ["auth-code"]})
    finally:
        web_ui.load_config_or_none = original_load
        web_ui.save_config = original_save
        web_ui.youtube_service.exchange_code_for_tokens = original_exchange
        web_ui.youtube_service.valid_access_token = original_valid_token
        web_ui.youtube_service.connected_account_profile = original_profile
        with web_ui.STATE.lock:
            web_ui.STATE.youtube_oauth_states.pop(state_key, None)

    assert "Connected to Sports Desk" in html
    saved = captured["saved"]
    assert saved, "Matched YouTube channel should be saved to config."
    linked = next(ch for ch in saved["channels"] if ch.get("name") == "Sports Desk")
    assert linked.get("youtube_account_id") == "acct-b"


def assert_auth_start_reuses_channel_account_slot() -> None:
    config = make_config()
    config["channels"][0]["name"] = "Inside Us"
    config["channels"][0]["youtube_account_id"] = ""
    config["youtube"]["accounts"][0]["label"] = "Inside Us"
    config["youtube"]["accounts"][0]["expected_channel_name"] = "Inside Us"
    original_load = web_ui.load_config_or_none
    original_save = web_ui.save_config
    web_ui.load_config_or_none = lambda _name: (config, None)
    web_ui.save_config = lambda _name, _config: None
    try:
        payload = web_ui.create_youtube_auth_start("config.ready.json", "", "Inside Us", "Inside Us")
    finally:
        web_ui.load_config_or_none = original_load
        web_ui.save_config = original_save
        with web_ui.STATE.lock:
            web_ui.STATE.youtube_oauth_states.pop(str(payload.get("state") or ""), None)

    assert payload["account_id"] == "acct-a"


def assert_auth_start_creates_standalone_slot_for_unlinked_channel() -> None:
    config = make_config()
    config["channels"][0]["name"] = "Inside Us"
    config["channels"][0]["youtube_account_id"] = "acct-a"
    config["channels"][1]["name"] = "Inside Us Hindi"
    config["channels"][1]["youtube_account_id"] = ""
    config["youtube"]["accounts"][0]["label"] = "Inside Us"
    config["youtube"]["accounts"][0]["expected_channel_name"] = "Inside Us"
    captured: dict = {"saved": None}

    original_load = web_ui.load_config_or_none
    original_save = web_ui.save_config
    web_ui.load_config_or_none = lambda _name: (config, None)
    web_ui.save_config = lambda _name, updated: captured.__setitem__("saved", copy.deepcopy(updated))
    try:
        payload = web_ui.create_youtube_auth_start("config.ready.json", "", "Inside Us Hindi", "Inside Us Hindi")
    finally:
        web_ui.load_config_or_none = original_load
        web_ui.save_config = original_save
        with web_ui.STATE.lock:
            web_ui.STATE.youtube_oauth_states.pop(str(payload.get("state") or ""), None)

    assert payload["account_id"] != "acct-a"
    saved = captured["saved"]
    account = next(item for item in saved["youtube"]["accounts"] if item.get("id") == payload["account_id"])
    assert account.get("label") == "Inside Us Hindi"
    assert account.get("expected_channel_name") == "Inside Us Hindi"


def assert_auth_start_uses_runtime_desktop_redirect_uri() -> None:
    config = make_config()
    config["youtube"]["redirect_uri"] = "http://localhost:8765/api/youtube/oauth/callback"
    captured: dict = {"saved": None}
    payload: dict = {}
    state_payload: dict = {}

    original_load = web_ui.load_config_or_none
    original_save = web_ui.save_config
    original_ui_port = web_ui.UI_PORT
    web_ui.load_config_or_none = lambda _name: (config, None)
    web_ui.save_config = lambda _name, updated: captured.__setitem__("saved", copy.deepcopy(updated))
    web_ui.UI_PORT = 54321
    try:
        payload = web_ui.create_youtube_auth_start("config.ready.json", "", "Sports Desk", "B")
        with web_ui.STATE.lock:
            state_payload = copy.deepcopy(web_ui.STATE.youtube_oauth_states.get(str(payload.get("state") or ""), {}))
    finally:
        web_ui.load_config_or_none = original_load
        web_ui.save_config = original_save
        web_ui.UI_PORT = original_ui_port
        with web_ui.STATE.lock:
            web_ui.STATE.youtube_oauth_states.pop(str(payload.get("state") or ""), None)

    query = parse_qs(urlparse(payload["url"]).query)
    expected_redirect = "http://127.0.0.1:54321/api/youtube/oauth/callback"
    assert query.get("redirect_uri") == [expected_redirect]
    assert state_payload.get("redirect_uri") == expected_redirect
    assert captured["saved"]["youtube"]["redirect_uri"] == "http://localhost:8765/api/youtube/oauth/callback"


def assert_oauth_callback_exchanges_with_stored_redirect_uri() -> None:
    config = make_config()
    config["channels"][1]["name"] = "Sports Desk"
    captured: dict = {"saved": None, "redirect_uri": "", "code_verifier": ""}
    state_key = "test-state-runtime-redirect"

    original_load = web_ui.load_config_or_none
    original_save = web_ui.save_config
    original_exchange = web_ui.youtube_service.exchange_code_for_tokens
    original_valid_token = web_ui.youtube_service.valid_access_token
    original_profile = web_ui.youtube_service.connected_account_profile

    def fake_exchange(_root: Path, _config: dict, _code: str, redirect_uri: str | None = None, **kwargs: object) -> None:
        captured["redirect_uri"] = redirect_uri
        captured["code_verifier"] = kwargs.get("code_verifier")

    web_ui.load_config_or_none = lambda _name: (config, None)
    web_ui.save_config = lambda _name, updated: captured.__setitem__("saved", copy.deepcopy(updated))
    web_ui.youtube_service.exchange_code_for_tokens = fake_exchange
    web_ui.youtube_service.valid_access_token = lambda *_args, **_kwargs: ("token", {})
    web_ui.youtube_service.connected_account_profile = lambda _token: {
        "channel_id": "yt-sports",
        "channel_title": "Sports Desk",
        "channel_handle": "@sportsdesk",
    }

    with web_ui.STATE.lock:
        web_ui.STATE.youtube_oauth_states[state_key] = {
            "created_at": web_ui.time.time(),
            "config_name": "config.ready.json",
            "account_id": "acct-b",
            "channel_name": "Sports Desk",
            "code_verifier": "verifier-123",
            "redirect_uri": "http://127.0.0.1:54321/oauth2redirect",
        }
    try:
        html = web_ui.handle_youtube_oauth_callback({"state": [state_key], "code": ["auth-code"]})
    finally:
        web_ui.load_config_or_none = original_load
        web_ui.save_config = original_save
        web_ui.youtube_service.exchange_code_for_tokens = original_exchange
        web_ui.youtube_service.valid_access_token = original_valid_token
        web_ui.youtube_service.connected_account_profile = original_profile
        with web_ui.STATE.lock:
            web_ui.STATE.youtube_oauth_states.pop(state_key, None)

    assert "Connected to Sports Desk" in html
    assert captured["redirect_uri"] == "http://127.0.0.1:54321/oauth2redirect"
    assert captured["code_verifier"] == "verifier-123"


def assert_youtube_status_keeps_connected_when_profile_refresh_fails() -> None:
    with web_ui.STATE.lock:
        web_ui.STATE.youtube_profile_cache.clear()
        web_ui.STATE.youtube_broadcast_cache.clear()
        web_ui.STATE.youtube_stream_cache.clear()
    config = make_config()
    config["youtube"]["accounts"][0].update(
        {
            "channel_id": "yt-a",
            "channel_title": "A",
            "channel_handle": "@a",
            "last_connected_at": "2026-06-23T00:00:00Z",
        }
    )

    original_load = web_ui.load_config_or_none
    original_load_tokens = web_ui.youtube_service.load_tokens
    original_valid_token = web_ui.youtube_service.valid_access_token
    original_profile = web_ui.youtube_service.connected_account_profile

    web_ui.load_config_or_none = lambda _name: (config, None)
    web_ui.youtube_service.load_tokens = lambda *_args, **_kwargs: {"access_token": "token", "expires_at": "2099-01-01T00:00:00Z"}
    web_ui.youtube_service.valid_access_token = lambda *_args, **_kwargs: ("token", {"scope": "youtube", "expires_at": "2099-01-01T00:00:00Z"})
    profile_calls = {"count": 0}

    def fake_profile(_token: str):
        profile_calls["count"] += 1
        raise RuntimeError("temporary profile lookup failure")

    web_ui.youtube_service.connected_account_profile = fake_profile
    try:
        payload = web_ui.youtube_status("config.ready.json")
    finally:
        web_ui.load_config_or_none = original_load
        web_ui.youtube_service.load_tokens = original_load_tokens
        web_ui.youtube_service.valid_access_token = original_valid_token
        web_ui.youtube_service.connected_account_profile = original_profile

    account = next(item for item in payload["accounts"] if item["id"] == "acct-a")
    assert payload["connected"] is True
    assert account["connected"] is True
    assert account["message"] == "Connected."
    assert profile_calls["count"] == 2


def assert_history_and_activity_are_channel_specific() -> None:
    original_root = app_db.ROOT
    original_db_path = app_db.DB_PATH
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as temp_dir:
        temp_root = Path(temp_dir)
        app_db.ROOT = temp_root
        app_db.DB_PATH = temp_root / "stream_control.db"
        try:
            app_db.init_db()
            app_db.record_stream_start("config.ready.json", "A", 101, "ffmpeg-a", "logs/A.log", "A live")
            app_db.record_stream_start("config.ready.json", "B", 202, "ffmpeg-b", "logs/B.log", "B live")
            app_db.record_event("stream_started", "config.ready.json", "A", {"message": "A started"})
            app_db.record_event("stream_started", "config.ready.json", "B", {"message": "B started"})
            app_db.record_event("app_started", None, None, {"message": "global"})
            app_db.record_event(
                "alert_raised",
                "config.ready.json",
                "A",
                {"title": "A alert", "message": "Keep this notification", "severity": "warn"},
            )
            for index in range(45):
                app_db.record_event("stream_tick", "config.ready.json", "B", {"index": index})

            a_sessions = app_db.stream_sessions("config.ready.json", channel_name="A")
            b_sessions = app_db.stream_sessions("config.ready.json", channel_name="B")
            assert [session["channel_name"] for session in a_sessions] == ["A"]
            assert [session["channel_name"] for session in b_sessions] == ["B"]

            a_events = app_db.recent_app_events("config.ready.json", channel_name="A")
            assert {event["channel_name"] for event in a_events} == {"A"}
            a_alerts = web_ui.recent_alert_events("config.ready.json", channel_name="A")
            assert [alert["message"] for alert in a_alerts] == ["Keep this notification"]

            removed = app_db.clear_app_events("config.ready.json", channel_name="A", include_global=False)
            remaining_channels = [event["channel_name"] for event in app_db.recent_app_events("config.ready.json", limit=100)]
            assert removed == 2
            assert "A" not in remaining_channels
            assert "B" in remaining_channels
            assert None in remaining_channels
        finally:
            app_db.ROOT = original_root
            app_db.DB_PATH = original_db_path


def assert_stream_log_history_keeps_three_sessions_per_channel() -> None:
    original_root = app_db.ROOT
    original_db_path = app_db.DB_PATH
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as temp_dir:
        temp_root = Path(temp_dir)
        app_db.ROOT = temp_root
        app_db.DB_PATH = temp_root / "stream_control.db"
        try:
            app_db.init_db()
            logs_dir = temp_root / "logs"
            logs_dir.mkdir(parents=True, exist_ok=True)
            for index in range(4):
                log_path = logs_dir / f"A-{index}.log"
                log_path.write_text(f"session {index}\n", encoding="utf-8")
                app_db.record_stream_start(
                    "config.ready.json",
                    "A",
                    100 + index,
                    f"ffmpeg-a-{index}",
                    str(log_path),
                    f"A live {index}",
                )
                app_db.record_stream_stop("config.ready.json", "A", 0, index)
            old_log_path = logs_dir / "B-0.log"
            old_log_path.write_text("session b\n", encoding="utf-8")
            app_db.record_stream_start("config.ready.json", "B", 200, "ffmpeg-b", str(old_log_path), "B live")

            history = web_ui.stream_log_history_for_channels(
                "config.ready.json",
                [{"name": "A"}, {"name": "B"}],
                set(),
            )

            assert len(history["A"]) == 3
            assert [item["pid"] for item in history["A"]] == [103, 102, 101]
            assert "session 3" in history["A"][0]["log_tail"]
            assert all(item["log_path"] for item in history["A"])
            assert len(history["B"]) == 1
            assert "session b" in history["B"][0]["log_tail"]
        finally:
            app_db.ROOT = original_root
            app_db.DB_PATH = original_db_path


def assert_live_chat_routes_to_linked_channel_account() -> None:
    config = make_config()
    config["channels"][1]["youtube_broadcast_id"] = "broadcast-b"
    captured: dict = {}

    original_load = web_ui.load_config_or_none
    original_valid_token = web_ui.youtube_service.valid_access_token
    original_profile = web_ui.youtube_service.connected_account_profile
    original_broadcast = web_ui.youtube_service.broadcast_chat_details_by_id
    original_messages = web_ui.youtube_service.list_live_chat_messages
    original_record_messages = app_db.record_live_chat_messages

    def fake_load(_config_name: str):
        return copy.deepcopy(config), None

    def fake_valid_access_token(_root: Path, scoped_config: dict):
        captured["tokens_file"] = scoped_config["youtube"]["tokens_file"]
        return "token-b", {}

    def fake_profile(_token: str):
        return {"channel_id": "yt-b", "channel_title": "B", "channel_handle": "@b"}

    def fake_broadcast(token: str, broadcast_id: str):
        captured["broadcast_token"] = token
        captured["broadcast_id"] = broadcast_id
        return {"id": broadcast_id, "title": "B Live", "live_chat_id": "chat-b"}

    def fake_messages(token: str, *, live_chat_id: str, page_token: str = "", max_results: int = 200):
        captured["messages_token"] = token
        captured["live_chat_id"] = live_chat_id
        captured["page_token"] = page_token
        return {
            "messages": [{"id": "m1", "display_message": "hello"}],
            "next_page_token": "next-b",
            "polling_interval_millis": 7000,
            "offline_at": "",
        }

    def fake_record_messages(config_name: str, channel_name: str, broadcast_id: str, live_chat_id: str, messages: list):
        captured["recorded_chat"] = (config_name, channel_name, broadcast_id, live_chat_id, copy.deepcopy(messages))

    web_ui.load_config_or_none = fake_load
    web_ui.youtube_service.valid_access_token = fake_valid_access_token
    web_ui.youtube_service.connected_account_profile = fake_profile
    web_ui.youtube_service.broadcast_chat_details_by_id = fake_broadcast
    web_ui.youtube_service.list_live_chat_messages = fake_messages
    app_db.record_live_chat_messages = fake_record_messages
    try:
        payload = web_ui.youtube_live_chat("config.ready.json", "B", "page-b")
    finally:
        web_ui.load_config_or_none = original_load
        web_ui.youtube_service.valid_access_token = original_valid_token
        web_ui.youtube_service.connected_account_profile = original_profile
        web_ui.youtube_service.broadcast_chat_details_by_id = original_broadcast
        web_ui.youtube_service.list_live_chat_messages = original_messages
        app_db.record_live_chat_messages = original_record_messages

    assert payload["account_id"] == "acct-b"
    assert payload["broadcast_id"] == "broadcast-b"
    assert payload["live_chat_id"] == "chat-b"
    assert captured["tokens_file"] == ".runtime/b.json"
    assert captured["broadcast_token"] == "token-b"
    assert captured["messages_token"] == "token-b"
    assert captured["page_token"] == "page-b"
    assert payload["messages"][0]["received_at"]
    assert "T" in payload["messages"][0]["received_at"]
    assert captured["recorded_chat"][0:4] == ("config.ready.json", "B", "broadcast-b", "chat-b")
    assert captured["recorded_chat"][4][0]["received_at"]


def assert_live_chat_auto_links_active_broadcast() -> None:
    working = make_config()
    captured: dict = {}

    original_load = web_ui.load_config_or_none
    original_save = web_ui.save_config
    original_valid_token = web_ui.youtube_service.valid_access_token
    original_profile = web_ui.youtube_service.connected_account_profile
    original_list_broadcasts = web_ui.youtube_service.list_broadcasts_by_status
    original_messages = web_ui.youtube_service.list_live_chat_messages
    original_record_event = app_db.record_event
    original_record_messages = app_db.record_live_chat_messages

    def fake_load(_config_name: str):
        return working, None

    def fake_save(_config_name: str, updated: dict):
        captured["saved"] = copy.deepcopy(updated)

    def fake_valid_access_token(_root: Path, scoped_config: dict):
        captured["tokens_file"] = scoped_config["youtube"]["tokens_file"]
        return "token-b", {}

    def fake_profile(_token: str):
        return {"channel_id": "yt-b", "channel_title": "B", "channel_handle": "@b"}

    def fake_list_broadcasts(token: str, status: str, limit: int = 25):
        captured["list_token"] = token
        captured["status"] = status
        captured["limit"] = limit
        return [
            {
                "id": "active-broadcast-b",
                "title": "B Active Live",
                "live_chat_id": "chat-active-b",
                "life_cycle_status": "live",
                "bound_stream_id": "stream-b",
                "studio_url": "https://studio.youtube.com/video/active-broadcast-b/livestreaming",
            }
        ]

    def fake_messages(token: str, *, live_chat_id: str, page_token: str = "", max_results: int = 200):
        captured["messages_token"] = token
        captured["live_chat_id"] = live_chat_id
        return {"messages": [], "next_page_token": "", "polling_interval_millis": 5000, "offline_at": ""}

    def fake_record_event(event_type: str, config_name: str | None, channel_name: str | None, details: dict | None = None):
        captured["event"] = (event_type, config_name, channel_name, copy.deepcopy(details or {}))
        return 1

    def fake_record_messages(config_name: str, channel_name: str, broadcast_id: str, live_chat_id: str, messages: list):
        captured["recorded_chat"] = (config_name, channel_name, broadcast_id, live_chat_id, copy.deepcopy(messages))

    web_ui.load_config_or_none = fake_load
    web_ui.save_config = fake_save
    web_ui.youtube_service.valid_access_token = fake_valid_access_token
    web_ui.youtube_service.connected_account_profile = fake_profile
    web_ui.youtube_service.list_broadcasts_by_status = fake_list_broadcasts
    web_ui.youtube_service.list_live_chat_messages = fake_messages
    app_db.record_event = fake_record_event
    app_db.record_live_chat_messages = fake_record_messages
    try:
        payload = web_ui.youtube_live_chat("config.ready.json", "B")
    finally:
        web_ui.load_config_or_none = original_load
        web_ui.save_config = original_save
        web_ui.youtube_service.valid_access_token = original_valid_token
        web_ui.youtube_service.connected_account_profile = original_profile
        web_ui.youtube_service.list_broadcasts_by_status = original_list_broadcasts
        web_ui.youtube_service.list_live_chat_messages = original_messages
        app_db.record_event = original_record_event
        app_db.record_live_chat_messages = original_record_messages

    saved_channel = captured["saved"]["channels"][1]
    assert payload["account_id"] == "acct-b"
    assert payload["broadcast_id"] == "active-broadcast-b"
    assert payload["broadcast_title"] == "B Active Live"
    assert payload["live_chat_id"] == "chat-active-b"
    assert saved_channel["youtube_broadcast_id"] == "active-broadcast-b"
    assert saved_channel["youtube_stream_id"] == "stream-b"
    assert captured["tokens_file"] == ".runtime/b.json"
    assert captured["status"] == "active"
    assert captured["messages_token"] == "token-b"
    assert captured["live_chat_id"] == "chat-active-b"
    assert captured["event"][0] == "youtube_broadcast_auto_linked"
    assert captured["recorded_chat"][0:4] == ("config.ready.json", "B", "active-broadcast-b", "chat-active-b")


def assert_live_chat_replaces_ended_broadcast_with_active_broadcast() -> None:
    working = make_config()
    working["channels"][1]["youtube_broadcast_id"] = "old-broadcast-b"
    working["channels"][1]["youtube_stream_id"] = "old-stream-b"
    captured: dict = {"events": [], "saves": [], "message_calls": []}

    original_load = web_ui.load_config_or_none
    original_save = web_ui.save_config
    original_valid_token = web_ui.youtube_service.valid_access_token
    original_profile = web_ui.youtube_service.connected_account_profile
    original_broadcast = web_ui.youtube_service.broadcast_chat_details_by_id
    original_list_broadcasts = web_ui.youtube_service.list_broadcasts_by_status
    original_messages = web_ui.youtube_service.list_live_chat_messages
    original_record_event = app_db.record_event
    original_record_messages = app_db.record_live_chat_messages

    def fake_load(_config_name: str):
        return working, None

    def fake_save(_config_name: str, updated: dict):
        captured["saves"].append(copy.deepcopy(updated))

    def fake_valid_access_token(_root: Path, scoped_config: dict):
        captured["tokens_file"] = scoped_config["youtube"]["tokens_file"]
        return "token-b", {}

    def fake_profile(_token: str):
        return {"channel_id": "yt-b", "channel_title": "B", "channel_handle": "@b"}

    def fake_broadcast(token: str, broadcast_id: str):
        captured["old_broadcast_id"] = broadcast_id
        return {"id": broadcast_id, "title": "Old B Live", "live_chat_id": "old-chat-b", "life_cycle_status": "live"}

    def fake_list_broadcasts(token: str, status: str, limit: int = 25):
        captured["list_status"] = status
        return [
            {
                "id": "current-broadcast-b",
                "title": "B Current Live",
                "live_chat_id": "current-chat-b",
                "life_cycle_status": "live",
                "bound_stream_id": "current-stream-b",
                "studio_url": "https://studio.youtube.com/video/current-broadcast-b/livestreaming",
            }
        ]

    def fake_messages(token: str, *, live_chat_id: str, page_token: str = "", max_results: int = 200):
        captured["message_calls"].append(live_chat_id)
        if live_chat_id == "old-chat-b":
            raise ValueError("liveChatEnded: The live chat is no longer live.")
        return {
            "messages": [{"id": "m-current", "display_message": "current hello"}],
            "next_page_token": "next-current",
            "polling_interval_millis": 9000,
            "offline_at": "",
        }

    def fake_record_event(event_type: str, config_name: str | None, channel_name: str | None, details: dict | None = None):
        captured["events"].append((event_type, config_name, channel_name, copy.deepcopy(details or {})))
        return len(captured["events"])

    def fake_record_messages(config_name: str, channel_name: str, broadcast_id: str, live_chat_id: str, messages: list):
        captured["recorded_chat"] = (config_name, channel_name, broadcast_id, live_chat_id, copy.deepcopy(messages))

    web_ui.load_config_or_none = fake_load
    web_ui.save_config = fake_save
    web_ui.youtube_service.valid_access_token = fake_valid_access_token
    web_ui.youtube_service.connected_account_profile = fake_profile
    web_ui.youtube_service.broadcast_chat_details_by_id = fake_broadcast
    web_ui.youtube_service.list_broadcasts_by_status = fake_list_broadcasts
    web_ui.youtube_service.list_live_chat_messages = fake_messages
    app_db.record_event = fake_record_event
    app_db.record_live_chat_messages = fake_record_messages
    try:
        payload = web_ui.youtube_live_chat("config.ready.json", "B", "old-page")
    finally:
        web_ui.load_config_or_none = original_load
        web_ui.save_config = original_save
        web_ui.youtube_service.valid_access_token = original_valid_token
        web_ui.youtube_service.connected_account_profile = original_profile
        web_ui.youtube_service.broadcast_chat_details_by_id = original_broadcast
        web_ui.youtube_service.list_broadcasts_by_status = original_list_broadcasts
        web_ui.youtube_service.list_live_chat_messages = original_messages
        app_db.record_event = original_record_event
        app_db.record_live_chat_messages = original_record_messages

    saved_channel = captured["saves"][-1]["channels"][1]
    assert payload["ok"] is True
    assert payload["broadcast_id"] == "current-broadcast-b"
    assert payload["live_chat_id"] == "current-chat-b"
    assert payload["next_page_token"] == "next-current"
    assert captured["old_broadcast_id"] == "old-broadcast-b"
    assert captured["message_calls"] == ["old-chat-b", "current-chat-b"]
    assert saved_channel["youtube_broadcast_id"] == "current-broadcast-b"
    assert saved_channel["youtube_stream_id"] == "current-stream-b"
    assert [event[0] for event in captured["events"]] == [
        "youtube_broadcast_link_cleared",
        "youtube_broadcast_auto_linked",
    ]
    assert captured["events"][0][3]["reason"] == "live_chat_ended"
    assert captured["recorded_chat"][0:4] == ("config.ready.json", "B", "current-broadcast-b", "current-chat-b")


def assert_live_chat_reply_posts_to_linked_channel_account() -> None:
    config = make_config()
    config["channels"][2]["youtube_broadcast_id"] = "broadcast-c"
    captured: dict = {}

    original_load = web_ui.load_config_or_none
    original_valid_token = web_ui.youtube_service.valid_access_token
    original_profile = web_ui.youtube_service.connected_account_profile
    original_broadcast = web_ui.youtube_service.broadcast_chat_details_by_id
    original_send = web_ui.youtube_service.send_live_chat_message
    original_record_messages = app_db.record_live_chat_messages

    def fake_load(_config_name: str):
        return copy.deepcopy(config), None

    def fake_valid_access_token(_root: Path, scoped_config: dict):
        captured["tokens_file"] = scoped_config["youtube"]["tokens_file"]
        return "token-c", {}

    def fake_profile(_token: str):
        return {"channel_id": "yt-c", "channel_title": "C", "channel_handle": "@c"}

    def fake_broadcast(_token: str, broadcast_id: str):
        return {"id": broadcast_id, "title": "C Live", "live_chat_id": "chat-c"}

    def fake_send(token: str, *, live_chat_id: str, message_text: str):
        captured["send_token"] = token
        captured["live_chat_id"] = live_chat_id
        captured["message_text"] = message_text
        return {"id": "sent-1", "display_message": message_text}

    def fake_record_messages(config_name: str, channel_name: str, broadcast_id: str, live_chat_id: str, messages: list):
        captured["recorded_chat"] = (config_name, channel_name, broadcast_id, live_chat_id, copy.deepcopy(messages))

    web_ui.load_config_or_none = fake_load
    web_ui.youtube_service.valid_access_token = fake_valid_access_token
    web_ui.youtube_service.connected_account_profile = fake_profile
    web_ui.youtube_service.broadcast_chat_details_by_id = fake_broadcast
    web_ui.youtube_service.send_live_chat_message = fake_send
    app_db.record_live_chat_messages = fake_record_messages
    try:
        payload = web_ui.send_youtube_live_chat(
            "config.ready.json",
            {"channel": "C", "message": "Thanks for watching"},
        )
    finally:
        web_ui.load_config_or_none = original_load
        web_ui.youtube_service.valid_access_token = original_valid_token
        web_ui.youtube_service.connected_account_profile = original_profile
        web_ui.youtube_service.broadcast_chat_details_by_id = original_broadcast
        web_ui.youtube_service.send_live_chat_message = original_send
        app_db.record_live_chat_messages = original_record_messages

    assert payload["account_id"] == "acct-c"
    assert payload["broadcast_id"] == "broadcast-c"
    assert captured["tokens_file"] == ".runtime/c.json"
    assert captured["send_token"] == "token-c"
    assert captured["live_chat_id"] == "chat-c"
    assert captured["message_text"] == "Thanks for watching"
    assert payload["message"]["sent_at"]
    assert "T" in payload["message"]["sent_at"]
    assert captured["recorded_chat"][0:4] == ("config.ready.json", "C", "broadcast-c", "chat-c")
    assert captured["recorded_chat"][4][0]["sent_at"]


def assert_live_chat_parser_keeps_event_comments_and_emoji() -> None:
    member_message = web_ui.youtube_service.live_chat_message_from_resource(
        {
            "id": "member-1",
            "snippet": {
                "type": "memberMilestoneChatEvent",
                "publishedAt": "2026-06-25T10:00:00Z",
                "memberMilestoneChatDetails": {"userComment": "said hi"},
            },
            "authorDetails": {"displayName": "Viewer A"},
        }
    )
    emoji_message = web_ui.youtube_service.live_chat_message_from_resource(
        {
            "id": "emoji-1",
            "snippet": {
                "type": "textMessageEvent",
                "publishedAt": "2026-06-25T10:00:10Z",
                "textMessageDetails": {
                    "messageText": ":hand-pink-waving: :face-red-heart-shape: :face-fuchsia-poop-shape:",
                },
            },
            "authorDetails": {"displayName": "Viewer B"},
        }
    )

    assert member_message is not None
    assert member_message["message_text"] == "said hi"
    assert member_message["display_message"] == "said hi"
    assert emoji_message is not None
    assert emoji_message["display_message"] == "\U0001f44b \U0001f970 \U0001f4a9"
    assert emoji_message["message_parts"][0]["text"] == "\U0001f44b \U0001f970 \U0001f4a9"


def assert_live_chat_messages_are_saved_with_stream_history() -> None:
    original_root = app_db.ROOT
    original_db_path = app_db.DB_PATH
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as temp_dir:
        temp_root = Path(temp_dir)
        app_db.ROOT = temp_root
        app_db.DB_PATH = temp_root / "stream_control.db"
        try:
            session_id = app_db.record_stream_start(
                "config.ready.json",
                "B",
                202,
                "ffmpeg-b",
                "logs/B.log",
                "B Live",
                "broadcast-b",
            )
            app_db.record_live_chat_messages(
                "config.ready.json",
                "B",
                "broadcast-b",
                "chat-b",
                [
                    {
                        "id": "msg-1",
                        "author_display_name": "Viewer One",
                        "display_message": "Amen from Lahore",
                        "published_at": "2026-06-22T10:00:00+05:00",
                    },
                    {
                        "id": "msg-2",
                        "author_display_name": "Viewer Two",
                        "display_message": "Audio is clear",
                        "message_parts": [{"type": "text", "text": "Audio is clear"}],
                        "received_at": "2026-06-22T10:00:05+05:00",
                    },
                ],
            )
            app_db.record_live_chat_messages(
                "config.ready.json",
                "B",
                "broadcast-b",
                "chat-b",
                [
                    {
                        "id": "msg-1",
                        "author_display_name": "Viewer One",
                        "display_message": "Amen from Lahore",
                        "published_at": "2026-06-22T10:00:00+05:00",
                    }
                ],
            )
            sessions = app_db.stream_sessions("config.ready.json", channel_name="B")
            assert sessions[0]["id"] == session_id
            assert sessions[0]["youtube_broadcast_id"] == "broadcast-b"
            assert sessions[0]["comment_count"] == 2
            assert [item["id"] for item in sessions[0]["recent_comments"]] == ["msg-2", "msg-1"]
            assert sessions[0]["recent_comments"][0]["display_message"] == "Audio is clear"
            assert sessions[0]["recent_comments"][0]["message_parts"] == [{"type": "text", "text": "Audio is clear"}]
        finally:
            app_db.ROOT = original_root
            app_db.DB_PATH = original_db_path


def assert_prestart_checks_replace_stale_broadcast() -> None:
    config = {
        "defaults": {},
        "youtube": {
            "accounts": [
                {"id": "acct-a", "label": "Account A", "tokens_file": ".runtime/a.json"},
            ],
            "default_privacy_status": "unlisted",
            "default_auto_start": True,
            "default_auto_stop": True,
        },
        "channels": [
            {
                "name": "Inside Us",
                "enabled": True,
                "youtube_account_id": "acct-a",
                "youtube_broadcast_id": "old-broadcast-id",
                "youtube_stream_id": "old-stream-id",
                "stream_key_env": "old-key",
            }
        ],
    }

    captured: dict = {"saves": [], "events": []}

    original_save = web_ui.save_config
    original_valid_token = web_ui.youtube_service.valid_access_token
    original_cached_profile = web_ui.cached_connected_account_profile
    original_broadcast_by_id = web_ui.youtube_service.broadcast_by_id
    original_schedule = web_ui.youtube_service.schedule_broadcast
    original_clear_caches = web_ui.clear_youtube_account_caches
    original_record_event = app_db.record_event

    web_ui.save_config = lambda _name, updated: captured["saves"].append(copy.deepcopy(updated))
    web_ui.youtube_service.valid_access_token = lambda *_args, **_kwargs: ("token-a", {})
    web_ui.cached_connected_account_profile = lambda *_args, **_kwargs: {
        "channel_id": "yt-a",
        "channel_title": "Inside Us",
        "channel_handle": "@insideus",
    }
    web_ui.clear_youtube_account_caches = lambda *_args, **_kwargs: None
    app_db.record_event = lambda event_type, *args, **kwargs: captured["events"].append(event_type)

    def reset_captured():
        captured["saves"].clear()
        captured["events"].clear()

    try:
        # Test Case 1: Active broadcast should NOT be replaced if auto_stop is False
        reset_captured()
        web_ui.youtube_service.broadcast_by_id = lambda token, b_id: {
            "id": b_id,
            "title": "Inside Us Live",
            "life_cycle_status": "live",
        }
        
        test_config = copy.deepcopy(config)
        test_config["channels"][0]["youtube_auto_stop"] = False
        replaced = web_ui.ensure_youtube_broadcasts_ready_for_start("config.ready.json", test_config, "Inside Us")
        
        assert replaced == [], "Active broadcast with auto_stop=False should not trigger replacement"
        assert not captured["saves"], "Config should not be saved when broadcast is active"
        assert not captured["events"], "No events should be recorded for active broadcast"

        # Test Case 1B: Active broadcast SHOULD be replaced if auto_stop is True
        reset_captured()
        web_ui.youtube_service.broadcast_by_id = lambda token, b_id: {
            "id": b_id,
            "title": "Inside Us Live",
            "life_cycle_status": "live",
        }
        web_ui.youtube_service.schedule_broadcast = lambda token, **kwargs: {
            "broadcast": {"id": "new-broadcast-id", "studio_url": "https://studio.youtube.com/video/new/livestreaming"},
            "stream": {"id": "new-stream-id", "stream_name": "new-stream-key"}
        }

        test_config = copy.deepcopy(config)
        test_config["channels"][0]["youtube_auto_stop"] = True
        replaced = web_ui.ensure_youtube_broadcasts_ready_for_start("config.ready.json", test_config, "Inside Us")

        assert replaced == ["Inside Us"], "Active broadcast with auto_stop=True should trigger replacement"
        assert len(captured["saves"]) == 1, "Config should be saved once when broadcast is replaced"
        saved_channel = captured["saves"][0]["channels"][0]
        assert saved_channel["youtube_broadcast_id"] == "new-broadcast-id"
        assert saved_channel["youtube_stream_id"] == "new-stream-id"
        # assert saved_channel["stream_key_env"] == "new-stream-key"
        assert "youtube_broadcast_replaced_on_start" in captured["events"]

        # Test Case 2: Stale broadcast (complete) SHOULD be replaced
        reset_captured()
        web_ui.youtube_service.broadcast_by_id = lambda token, b_id: {
            "id": b_id,
            "title": "Inside Us Live",
            "life_cycle_status": "complete",
        }
        web_ui.youtube_service.schedule_broadcast = lambda token, **kwargs: {
            "broadcast": {"id": "new-broadcast-id", "studio_url": "https://studio.youtube.com/video/new/livestreaming"},
            "stream": {"id": "new-stream-id", "stream_name": "new-stream-key"}
        }

        test_config = copy.deepcopy(config)
        replaced = web_ui.ensure_youtube_broadcasts_ready_for_start("config.ready.json", test_config, "Inside Us")

        assert replaced == ["Inside Us"], "Completed broadcast should trigger replacement"
        assert len(captured["saves"]) == 1, "Config should be saved once"
        saved_channel = captured["saves"][0]["channels"][0]
        assert saved_channel["youtube_broadcast_id"] == "new-broadcast-id"
        assert saved_channel["youtube_stream_id"] == "new-stream-id"
        # assert saved_channel["stream_key_env"] == "new-stream-key"
        assert "youtube_broadcast_replaced_on_start" in captured["events"]

        # Test Case 3: Missing broadcast SHOULD be replaced
        reset_captured()
        web_ui.youtube_service.broadcast_by_id = lambda token, b_id: None
        
        test_config = copy.deepcopy(config)
        replaced = web_ui.ensure_youtube_broadcasts_ready_for_start("config.ready.json", test_config, "Inside Us")

        assert replaced == ["Inside Us"], "Missing broadcast should trigger replacement"
        assert len(captured["saves"]) == 1, "Config should be saved once"
        saved_channel = captured["saves"][0]["channels"][0]
        assert saved_channel["youtube_broadcast_id"] == "new-broadcast-id"
        assert saved_channel["youtube_stream_id"] == "new-stream-id"
        # assert saved_channel["stream_key_env"] == "new-stream-key"
        assert "youtube_broadcast_replaced_on_start" in captured["events"]

    finally:
        web_ui.save_config = original_save
        web_ui.youtube_service.valid_access_token = original_valid_token
        web_ui.cached_connected_account_profile = original_cached_profile
        web_ui.youtube_service.broadcast_by_id = original_broadcast_by_id
        web_ui.youtube_service.schedule_broadcast = original_schedule
        web_ui.clear_youtube_account_caches = original_clear_caches
        app_db.record_event = original_record_event


def assert_ensure_channel_streams_no_dummy_streams() -> None:
    # 1. New channel without streams key
    channel = {"name": "TestChannel", "stream_key": "main_key"}
    streams = web_ui.ensure_channel_streams(channel)
    assert len(streams) == 1, f"Expected 1 stream, got {len(streams)}"
    assert streams[0]["name"] == "Main Stream Feed"
    assert streams[0]["stream_key"] == "main_key"
    assert not any("dummy" in s.get("name", "").lower() for s in streams)

    # 2. Existing channel with legacy dummy stream embedded
    channel_legacy = {
        "name": "LegacyChannel",
        "streams": [
            {"id": "stream_1", "name": "Main Stream Feed", "stream_key": "main_key"},
            {"id": "stream_2", "name": "Secondary Stream (Dummy / Test)", "stream_key": "sample_dummy_stream_key_secondary"},
        ]
    }
    cleaned_streams = web_ui.ensure_channel_streams(channel_legacy)
    assert len(cleaned_streams) == 1, f"Expected legacy dummy stream to be filtered out, got {len(cleaned_streams)}"
    assert cleaned_streams[0]["name"] == "Main Stream Feed"
    assert cleaned_streams[0]["stream_key"] == "main_key"


def main() -> int:
    assert_channel_scoped_schedule_routes_to_linked_accounts()
    assert_schedule_preserves_dual_stream_preference()
    assert_unlinked_channel_blocked_with_multiple_connected_accounts()
    assert_unlinked_channel_blocked_with_single_connected_account()
    assert_verify_reports_missing_account_as_nonfatal_status()
    assert_requested_account_mismatch_is_rejected()
    assert_youtube_channel_name_matching_allows_clean_variations()
    assert_oauth_callback_persists_wrong_youtube_channel_name()
    assert_oauth_callback_links_selected_channel()
    assert_auth_start_reuses_channel_account_slot()
    assert_auth_start_creates_standalone_slot_for_unlinked_channel()
    assert_auth_start_uses_runtime_desktop_redirect_uri()
    assert_oauth_callback_exchanges_with_stored_redirect_uri()
    assert_youtube_status_keeps_connected_when_profile_refresh_fails()
    assert_history_and_activity_are_channel_specific()
    assert_stream_log_history_keeps_three_sessions_per_channel()
    assert_live_chat_routes_to_linked_channel_account()
    assert_live_chat_auto_links_active_broadcast()
    assert_live_chat_replaces_ended_broadcast_with_active_broadcast()
    assert_live_chat_reply_posts_to_linked_channel_account()
    assert_live_chat_parser_keeps_event_comments_and_emoji()
    assert_live_chat_messages_are_saved_with_stream_history()
    assert_prestart_checks_replace_stale_broadcast()
    assert_ensure_channel_streams_no_dummy_streams()
    print("channel_workspace_contract_test: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

