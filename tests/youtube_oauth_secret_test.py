#!/usr/bin/env python3
"""OAuth token request contracts for desktop and web clients."""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import youtube_service  # noqa: E402


def main() -> int:
    original_request_json = youtube_service.request_json
    captured: list[dict[str, Any]] = []

    def fake_request_json(_url: str, **kwargs: Any) -> dict[str, Any]:
        body = kwargs.get("body")
        captured.append(dict(body) if isinstance(body, dict) else {})
        return {
            "access_token": f"access-{len(captured)}",
            "refresh_token": "refresh-token",
            "expires_in": 3600,
        }

    try:
        youtube_service.request_json = fake_request_json
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            desktop_config = {
                "youtube": {
                    "client_id": "desktop-client.apps.googleusercontent.com",
                    "client_secret": "stale-secret-that-google-would-reject",
                    "oauth_client_type": "desktop",
                    "use_pkce": True,
                    "redirect_uri": "http://127.0.0.1:8765/oauth2redirect",
                    "tokens_file": "youtube_tokens.json",
                }
            }
            youtube_service.exchange_code_for_tokens(
                root,
                desktop_config,
                "auth-code",
                code_verifier="verifier",
            )
            assert captured[-1]["client_secret"] == "stale-secret-that-google-would-reject", captured[-1]
            assert captured[-1]["code_verifier"] == "verifier", captured[-1]

            youtube_service.refresh_access_token(
                root,
                desktop_config,
                {"refresh_token": "refresh-token"},
            )
            assert captured[-1]["client_secret"] == "stale-secret-that-google-would-reject", captured[-1]

            web_config = {
                "youtube": {
                    "client_id": "web-client.apps.googleusercontent.com",
                    "client_secret": "web-secret",
                    "oauth_client_type": "web",
                    "redirect_uri": "http://127.0.0.1:8765/oauth2redirect",
                    "tokens_file": "web_tokens.json",
                }
            }
            youtube_service.exchange_code_for_tokens(root, web_config, "auth-code")
            assert captured[-1]["client_secret"] == "web-secret", captured[-1]

            youtube_service.refresh_access_token(root, web_config, {"refresh_token": "refresh-token"})
            assert captured[-1]["client_secret"] == "web-secret", captured[-1]

            try:
                youtube_service.exchange_code_for_tokens(
                    root,
                    {
                        "youtube": {
                            "client_id": "web-client.apps.googleusercontent.com",
                            "oauth_client_type": "web",
                        }
                    },
                    "auth-code",
                )
            except ValueError as exc:
                assert "client secret" in str(exc).lower(), exc
            else:
                raise AssertionError("Web OAuth should require a client secret.")

            def fake_missing_secret(_url: str, **kwargs: Any) -> dict[str, Any]:
                body = kwargs.get("body")
                captured.append(dict(body) if isinstance(body, dict) else {})
                raise ValueError("client_secret is missing.")

            youtube_service.request_json = fake_missing_secret
            try:
                youtube_service.refresh_access_token(
                    root,
                    {
                        "youtube": {
                            "client_id": "desktop-client.apps.googleusercontent.com",
                            "oauth_client_type": "desktop",
                            "tokens_file": "desktop_no_secret_tokens.json",
                        }
                    },
                    {"refresh_token": "refresh-token"},
                )
            except ValueError as exc:
                message = str(exc).lower()
                assert "client secret" in message, exc
                assert "owner credentials" in message, exc
            else:
                raise AssertionError("Refresh should explain Google's missing client secret error.")
    finally:
        youtube_service.request_json = original_request_json

    print("youtube_oauth_secret_test: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
