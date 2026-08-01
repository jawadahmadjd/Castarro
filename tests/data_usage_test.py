#!/usr/bin/env python3
"""Tests for monthly data usage and custom date range calculation."""

from __future__ import annotations

from datetime import datetime, timezone
import tempfile
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import app_db  # noqa: E402
import web_ui  # noqa: E402


def test_stream_transfer_month_and_range() -> None:
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp_dir:
        db_path = Path(tmp_dir) / "test_stream_control.db"
        app_db.DB_PATH = db_path
        app_db.init_db()

        now_utc = datetime.now(timezone.utc).isoformat(timespec="seconds")

        with app_db.connect() as db:
            db.execute(
                """
                INSERT INTO stream_sessions (config_name, channel_name, command, status, transferred_bytes, started_at)
                VALUES ('config.json', 'Channel One', 'ffmpeg ...', 'stopped', 10485760, ?)
                """,
                (now_utc,),
            )
            db.execute(
                """
                INSERT INTO stream_sessions (config_name, channel_name, command, status, transferred_bytes, started_at)
                VALUES ('config.json', 'Channel Two', 'ffmpeg ...', 'stopped', 20971520, ?)
                """,
                (now_utc,),
            )
            # Session from last year
            db.execute(
                """
                INSERT INTO stream_sessions (config_name, channel_name, command, status, transferred_bytes, started_at)
                VALUES ('config.json', 'Channel One', 'ffmpeg ...', 'stopped', 52428800, '2025-01-01T10:00:00+00:00')
                """,
            )

        month_bytes = app_db.stream_transfer_month_bytes("config.json")
        assert month_bytes == 10485760 + 20971520, f"Expected 31457280 bytes, got {month_bytes}"

        today_str = datetime.now().strftime("%Y-%m-%d")
        details = app_db.stream_transfer_range_details("config.json", start_date=today_str, end_date=today_str)
        assert details["total_bytes"] == 31457280
        assert details["session_count"] == 2
        assert len(details["by_channel"]) == 2

        old_details = app_db.stream_transfer_range_details("config.json", start_date="2025-01-01", end_date="2025-01-02")
        assert old_details["total_bytes"] == 52428800
        assert old_details["session_count"] == 1


if __name__ == "__main__":
    test_stream_transfer_month_and_range()
    print("All data usage tests passed successfully!")
