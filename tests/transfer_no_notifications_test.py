"""Unit test verifying notifications are never copied or imported via Transfer tab."""

import json
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR / "scripts"))

import app_db
import web_ui



def test_transfer_export_and_import_purges_notifications() -> None:
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as data_tmp_dir, tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as export_tmp_dir:

        temp_root = Path(data_tmp_dir)
        export_root = Path(export_tmp_dir)
        old_root = web_ui.ROOT
        old_db_path = app_db.DB_PATH
        try:
            web_ui.ROOT = temp_root
            app_db.DB_PATH = temp_root / "stream_control.db"
            app_db.init_db()

            # Create a dummy config
            config_name = "config.json"
            (temp_root / config_name).write_text(json.dumps({"channels": [{"name": "TestChannel"}]}), encoding="utf-8")

            # Insert some alert_raised events into active app_events
            app_db.record_event("alert_raised", config_name, "TestChannel", {"title": "Test Alert 1", "message": "Degraded bitrate", "severity": "danger"})
            app_db.record_event("alert_raised", config_name, "TestChannel", {"title": "Test Alert 2", "message": "High CPU", "severity": "warn"})
            app_db.record_event("stream_started", config_name, "TestChannel", {"pid": 1234})

            initial_alerts = app_db.recent_app_events(config_name, event_type="alert_raised")
            assert len(initial_alerts) == 2, "Expected 2 initial alert_raised events"

            # Export transfer package
            export_target_dir = export_root / "export_output"
            export_target_dir.mkdir()
            export_res = web_ui.create_transfer_package({"destination": str(export_target_dir)})
            assert export_res.get("ok") is True

            package_path = Path(export_res["packagePath"])
            package_db = package_path / "data" / "stream_control.db"
            assert package_db.exists()

            # Check that exported database has 0 alert_raised events
            conn = sqlite3.connect(str(package_db))
            exported_alerts_count = conn.execute("SELECT COUNT(*) FROM app_events WHERE event_type = 'alert_raised'").fetchone()[0]
            conn.close()
            assert exported_alerts_count == 0, f"Exported package stream_control.db should have 0 alert_raised events, found {exported_alerts_count}"

            # Now test importing a package
            # First, add another alert_raised event to current active db to simulate dirty target DB
            app_db.record_event("alert_raised", config_name, "TestChannel", {"title": "Dirty Alert", "message": "Should be purged on import", "severity": "danger"})
            assert len(app_db.recent_app_events(config_name, event_type="alert_raised")) >= 1

            # Import package
            import_res = web_ui.import_transfer_package({"packagePath": str(package_path)})
            assert import_res.get("ok") is True

            # Verify active DB has 0 alert_raised events
            active_alerts = app_db.recent_app_events(config_name, event_type="alert_raised")
            assert len(active_alerts) == 0, f"Imported stream_control.db should have 0 alert_raised events, found {len(active_alerts)}"

            # Verify alerts_status returns empty recent list
            status_alerts = web_ui.alerts_status(config_name)
            assert status_alerts["recent"] == [], "alerts_status recent list should be empty after import"

        finally:
            web_ui.ROOT = old_root
            app_db.DB_PATH = old_db_path



if __name__ == "__main__":
    test_transfer_export_and_import_purges_notifications()
    print("test_transfer_export_and_import_purges_notifications passed!")
