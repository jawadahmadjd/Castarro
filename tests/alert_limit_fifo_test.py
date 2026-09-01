import json
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR / "scripts"))

import app_db
import web_ui

def test_alert_limit_fifo_50():
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as data_tmp_dir:
        temp_root = Path(data_tmp_dir)
        old_root = web_ui.ROOT
        old_db_path = app_db.DB_PATH
        try:
            web_ui.ROOT = temp_root
            app_db.DB_PATH = temp_root / "stream_control.db"
            app_db.init_db()

            config_name = "config.json"
            (temp_root / config_name).write_text(json.dumps({"channels": [{"name": "TestChannel"}]}), encoding="utf-8")

            # Insert 60 alerts
            for i in range(1, 61):
                app_db.record_event(
                    "alert_raised",
                    config_name,
                    "TestChannel",
                    {"title": f"Alert {i}", "message": f"Message {i}", "severity": "info"}
                )

            # Check database table directly
            conn = sqlite3.connect(str(app_db.DB_PATH))
            count = conn.execute("SELECT COUNT(*) FROM app_events WHERE event_type = 'alert_raised'").fetchone()[0]
            assert count == 50, f"Expected 50 alerts in DB, found {count}"

            # Check oldest and newest IDs: should be 11 to 60 (1 to 10 deleted)
            rows = conn.execute("SELECT details_json FROM app_events WHERE event_type = 'alert_raised' ORDER BY id ASC").fetchall()
            oldest_details = json.loads(rows[0][0])
            newest_details = json.loads(rows[-1][0])
            assert oldest_details["title"] == "Alert 11", f"Expected oldest alert to be Alert 11, got {oldest_details['title']}"
            assert newest_details["title"] == "Alert 60", f"Expected newest alert to be Alert 60, got {newest_details['title']}"
            conn.close()

            # Check web_ui.alerts_status returns at most 50
            status = web_ui.alerts_status(config_name)
            assert len(status["recent"]) == 50, f"Expected 50 recent alerts in alerts_status, got {len(status['recent'])}"
            assert status["recent"][0]["title"] == "Alert 60", f"Expected newest first in recent, got {status['recent'][0]['title']}"

            # Test prune_alert_events directly with lower limit e.g. 20
            pruned = app_db.prune_alert_events(20)
            assert pruned == 30, f"Expected 30 alerts pruned when reducing to 20, got {pruned}"
            
            conn = sqlite3.connect(str(app_db.DB_PATH))
            count_after_prune = conn.execute("SELECT COUNT(*) FROM app_events WHERE event_type = 'alert_raised'").fetchone()[0]
            assert count_after_prune == 20, f"Expected 20 alerts in DB after prune, got {count_after_prune}"
            conn.close()

        finally:
            web_ui.ROOT = old_root
            app_db.DB_PATH = old_db_path

if __name__ == "__main__":
    test_alert_limit_fifo_50()
    print("test_alert_limit_fifo_50 passed successfully!")
