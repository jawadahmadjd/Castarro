import os, sys
from datetime import datetime, timezone, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))

import app_db

app_db.init_db()
now = datetime.now(timezone.utc)
today_str = now.isoformat(timespec='seconds')
yesterday_str = (now - timedelta(days=1)).isoformat(timespec='seconds')
three_days_str = (now - timedelta(days=3)).isoformat(timespec='seconds')

with app_db.connect() as conn:
    conn.execute("DELETE FROM stream_sessions WHERE command LIKE '%test_playwright%'")

    for cfg in ['config.json', 'config.ready.json']:
        conn.execute("INSERT INTO stream_sessions (config_name, channel_name, command, status, returncode, transferred_bytes, started_at, stopped_at, pid, log_path) VALUES (?, 'Inside Us', 'test_playwright', 'stopped', 0, 52428800, ?, ?, 9999, 'test.log')", (cfg, today_str, today_str))
        conn.execute("INSERT INTO stream_sessions (config_name, channel_name, command, status, returncode, transferred_bytes, started_at, stopped_at, pid, log_path) VALUES (?, 'Inside Us Hindi', 'test_playwright', 'stopped', 0, 104857600, ?, ?, 9999, 'test.log')", (cfg, today_str, today_str))
        conn.execute("INSERT INTO stream_sessions (config_name, channel_name, command, status, returncode, transferred_bytes, started_at, stopped_at, pid, log_path) VALUES (?, 'Inside Us', 'test_playwright', 'stopped', 0, 209715200, ?, ?, 9999, 'test.log')", (cfg, yesterday_str, yesterday_str))
        conn.execute("INSERT INTO stream_sessions (config_name, channel_name, command, status, returncode, transferred_bytes, started_at, stopped_at, pid, log_path) VALUES (?, 'Inside Us Hindi', 'test_playwright', 'stopped', 0, 314572800, ?, ?, 9999, 'test.log')", (cfg, three_days_str, three_days_str))

print(f"Database seeded successfully at {app_db.DB_PATH}")
