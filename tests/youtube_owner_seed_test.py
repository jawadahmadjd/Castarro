from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import runtime_paths  # noqa: E402


def assert_owner_oauth_seed_fills_missing_credentials() -> None:
    original_data_root = runtime_paths.DATA_ROOT
    original_code_root = runtime_paths.CODE_ROOT
    original_legacy_root = os.environ.get("STREAM_LEGACY_ROOT")

    with tempfile.TemporaryDirectory() as temp:
        temp_root = Path(temp)
        data_root = temp_root / "data"
        seed_root = temp_root / "seed"
        seed_root.mkdir(parents=True)
        (seed_root / "youtube.oauth.seed.json").write_text(
            json.dumps(
                {
                    "youtube": {
                        "client_id": "seed-client.apps.googleusercontent.com",
                        "client_secret": "seed-secret",
                        "oauth_client_type": "desktop",
                        "use_pkce": True,
                        "redirect_uri": "http://127.0.0.1:8765/api/youtube/oauth/callback",
                    }
                }
            ),
            encoding="utf-8",
        )

        try:
            runtime_paths.DATA_ROOT = data_root
            runtime_paths.CODE_ROOT = temp_root / "code"
            os.environ["STREAM_LEGACY_ROOT"] = str(seed_root)

            config = {
                "youtube": {
                    "accounts": [
                        {
                            "id": "account-1",
                            "label": "Viewer channel",
                            "tokens_file": ".runtime/youtube_tokens_account-1.json",
                        }
                    ],
                    "default_privacy_status": "public",
                }
            }

            assert runtime_paths.apply_youtube_owner_seed(config)
            assert config["youtube"]["client_id"] == "seed-client.apps.googleusercontent.com"
            assert config["youtube"]["client_secret"] == "seed-secret"
            assert config["youtube"]["default_privacy_status"] == "public"
            assert config["youtube"]["accounts"][0]["id"] == "account-1"
        finally:
            runtime_paths.DATA_ROOT = original_data_root
            runtime_paths.CODE_ROOT = original_code_root
            if original_legacy_root is None:
                os.environ.pop("STREAM_LEGACY_ROOT", None)
            else:
                os.environ["STREAM_LEGACY_ROOT"] = original_legacy_root


def assert_owner_oauth_seed_does_not_overwrite_existing_credentials() -> None:
    original_legacy_root = os.environ.get("STREAM_LEGACY_ROOT")

    with tempfile.TemporaryDirectory() as temp:
        seed_root = Path(temp)
        (seed_root / "youtube.oauth.seed.json").write_text(
            json.dumps({"youtube": {"client_id": "seed-client", "client_secret": "seed-secret"}}),
            encoding="utf-8",
        )

        try:
            os.environ["STREAM_LEGACY_ROOT"] = str(seed_root)
            config = {"youtube": {"client_id": "existing-client", "client_secret": "existing-secret"}}

            assert not runtime_paths.apply_youtube_owner_seed(config)
            assert config["youtube"]["client_id"] == "existing-client"
            assert config["youtube"]["client_secret"] == "existing-secret"
        finally:
            if original_legacy_root is None:
                os.environ.pop("STREAM_LEGACY_ROOT", None)
            else:
                os.environ["STREAM_LEGACY_ROOT"] = original_legacy_root


if __name__ == "__main__":
    assert_owner_oauth_seed_fills_missing_credentials()
    assert_owner_oauth_seed_does_not_overwrite_existing_credentials()
    print("youtube owner seed tests passed")
