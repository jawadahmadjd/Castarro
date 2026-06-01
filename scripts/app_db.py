"""Local SQLite history for the streaming UI."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import runtime_paths

ROOT = runtime_paths.DATA_ROOT
DB_PATH = ROOT / "stream_control.db"
VIDEO_EXTENSIONS = {".mp4", ".m4v", ".mov", ".flv", ".mkv"}


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout = 30000")
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


def init_db() -> None:
    runtime_paths.ensure_data_root()
    with connect() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS schema_meta (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings_snapshots (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              config_name TEXT NOT NULL,
              reason TEXT NOT NULL,
              json_text TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS channels (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              config_name TEXT NOT NULL,
              name TEXT NOT NULL,
              enabled INTEGER NOT NULL DEFAULT 1,
              stream_key_env TEXT,
              has_inline_key INTEGER NOT NULL DEFAULT 0,
              youtube_auto_start INTEGER NOT NULL DEFAULT 0,
              youtube_auto_stop INTEGER NOT NULL DEFAULT 0,
              youtube_studio_url TEXT,
              normalize_profile_json TEXT,
              raw_playlist_json TEXT,
              playlist_json TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              UNIQUE(config_name, name)
            );

            CREATE TABLE IF NOT EXISTS videos (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              config_name TEXT NOT NULL,
              channel_name TEXT NOT NULL,
              path TEXT NOT NULL,
              name TEXT NOT NULL,
              folder TEXT NOT NULL,
              kind TEXT NOT NULL,
              status TEXT NOT NULL,
              selected INTEGER NOT NULL DEFAULT 0,
              size_bytes INTEGER,
              mtime TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              UNIQUE(config_name, channel_name, path, kind)
            );

            CREATE TABLE IF NOT EXISTS tasks (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              task_uid TEXT NOT NULL UNIQUE,
              action TEXT NOT NULL,
              config_name TEXT NOT NULL,
              channel_name TEXT,
              command TEXT NOT NULL,
              status TEXT NOT NULL,
              returncode INTEGER,
              started_at TEXT NOT NULL,
              finished_at TEXT,
              output_tail TEXT
            );

            CREATE TABLE IF NOT EXISTS stream_sessions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              config_name TEXT NOT NULL,
              channel_name TEXT NOT NULL,
              live_title TEXT,
              pid INTEGER,
              command TEXT NOT NULL,
              log_path TEXT,
              status TEXT NOT NULL,
              returncode INTEGER,
              started_at TEXT NOT NULL,
              stopped_at TEXT
            );

            CREATE TABLE IF NOT EXISTS logs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              config_name TEXT NOT NULL,
              channel_name TEXT,
              source TEXT NOT NULL,
              path TEXT,
              message TEXT,
              created_at TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS logs_config_source_path
            ON logs(config_name, source, path);

            CREATE TABLE IF NOT EXISTS app_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              event_type TEXT NOT NULL,
              config_name TEXT,
              channel_name TEXT,
              details_json TEXT,
              created_at TEXT NOT NULL
            );

            INSERT OR REPLACE INTO schema_meta(key, value) VALUES ('version', '1');
            """
        )
        columns = {
            str(row["name"])
            for row in db.execute("PRAGMA table_info(stream_sessions)").fetchall()
        }
        if "live_title" not in columns:
            db.execute("ALTER TABLE stream_sessions ADD COLUMN live_title TEXT")


def relative_or_absolute(path: Path) -> str:
    try:
        return path.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return str(path.resolve())


def resolve_project_path(value: str) -> Path:
    path = Path(value)
    if path.is_absolute():
        return path
    return (ROOT / path).resolve()


def file_info(path_text: str) -> tuple[int | None, str | None]:
    path = resolve_project_path(path_text)
    if not path.exists():
        return None, None
    stat = path.stat()
    return stat.st_size, datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(timespec="seconds")


def record_event(
    event_type: str,
    config_name: str | None = None,
    channel_name: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    init_db()
    with connect() as db:
        db.execute(
            """
            INSERT INTO app_events(event_type, config_name, channel_name, details_json, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (event_type, config_name, channel_name, json.dumps(details or {}, sort_keys=True), now()),
        )


def insert_settings_snapshot(db: sqlite3.Connection, config_name: str, config: dict[str, Any], reason: str) -> None:
    db.execute(
        """
        INSERT INTO settings_snapshots(config_name, reason, json_text, created_at)
        VALUES (?, ?, ?, ?)
        """,
        (config_name, reason, json.dumps(config, indent=2, sort_keys=True), now()),
    )


def snapshot_settings(config_name: str, config: dict[str, Any], reason: str) -> None:
    init_db()
    with connect() as db:
        insert_settings_snapshot(db, config_name, config, reason)


def upsert_channel(config_name: str, channel: dict[str, Any], db: sqlite3.Connection | None = None) -> None:
    channel_name = str(channel.get("name", "")).strip()
    if not channel_name:
        return
    timestamp = now()
    owns_connection = db is None
    if db is None:
        db = connect()
    try:
        db.execute(
            """
            INSERT INTO channels(
              config_name, name, enabled, stream_key_env, has_inline_key,
              youtube_auto_start, youtube_auto_stop, youtube_studio_url,
              normalize_profile_json, raw_playlist_json, playlist_json,
              created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(config_name, name) DO UPDATE SET
              enabled=excluded.enabled,
              stream_key_env=excluded.stream_key_env,
              has_inline_key=excluded.has_inline_key,
              youtube_auto_start=excluded.youtube_auto_start,
              youtube_auto_stop=excluded.youtube_auto_stop,
              youtube_studio_url=excluded.youtube_studio_url,
              normalize_profile_json=excluded.normalize_profile_json,
              raw_playlist_json=excluded.raw_playlist_json,
              playlist_json=excluded.playlist_json,
              updated_at=excluded.updated_at
            """,
            (
                config_name,
                channel_name,
                int(channel.get("enabled", True)),
                channel.get("stream_key_env"),
                int(bool(channel.get("stream_key"))),
                int(bool(channel.get("youtube_auto_start"))),
                int(bool(channel.get("youtube_auto_stop"))),
                channel.get("youtube_studio_url", ""),
                json.dumps(channel.get("normalize_profile", {}), sort_keys=True),
                json.dumps(channel.get("raw_playlist", []), sort_keys=True),
                json.dumps(channel.get("playlist", []), sort_keys=True),
                timestamp,
                timestamp,
            ),
        )
        if owns_connection:
            db.commit()
    finally:
        if owns_connection:
            db.close()


def upsert_video(
    config_name: str,
    channel_name: str,
    path_text: str,
    kind: str,
    status: str,
    selected: bool = False,
    db: sqlite3.Connection | None = None,
) -> None:
    if not path_text:
        return
    size_bytes, mtime = file_info(path_text)
    path = Path(path_text)
    timestamp = now()
    owns_connection = db is None
    if db is None:
        db = connect()
    try:
        db.execute(
            """
            INSERT INTO videos(
              config_name, channel_name, path, name, folder, kind, status,
              selected, size_bytes, mtime, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(config_name, channel_name, path, kind) DO UPDATE SET
              name=excluded.name,
              folder=excluded.folder,
              status=excluded.status,
              selected=excluded.selected,
              size_bytes=excluded.size_bytes,
              mtime=excluded.mtime,
              updated_at=excluded.updated_at
            """,
            (
                config_name,
                channel_name,
                path_text,
                path.name,
                str(path.parent).replace("\\", "/"),
                kind,
                status,
                int(selected),
                size_bytes,
                mtime,
                timestamp,
                timestamp,
            ),
        )
        if owns_connection:
            db.commit()
    finally:
        if owns_connection:
            db.close()


def sync_config(config_name: str, config: dict[str, Any], reason: str | None = None) -> None:
    init_db()
    with connect() as db:
        if reason:
            insert_settings_snapshot(db, config_name, config, reason)

        defaults = config.get("defaults", {})
        raw_root = resolve_project_path(defaults.get("raw_dir", "Raw Videos"))
        normalized_root = resolve_project_path(defaults.get("normalized_dir", "Go Live"))
        current_channel_names = set()

        for channel in config.get("channels", []):
            channel_name = str(channel.get("name", "")).strip()
            if not channel_name:
                continue
            current_channel_names.add(channel_name)
            upsert_channel(config_name, channel, db)

            selected_paths = {
                str(path)
                for path in channel.get("raw_playlist", [])
                if isinstance(path, str)
            }
            for path_text in selected_paths:
                upsert_video(config_name, channel_name, path_text, "raw", "selected", True, db)

            raw_channel_dir = raw_root / channel_name
            if raw_channel_dir.exists():
                for path in sorted(raw_channel_dir.rglob("*")):
                    if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS:
                        path_text = relative_or_absolute(path)
                        upsert_video(
                            config_name,
                            channel_name,
                            path_text,
                            "raw",
                            "selected" if path_text in selected_paths else "available",
                            path_text in selected_paths,
                            db,
                        )

            normalized_channel_dir = normalized_root / channel_name
            if normalized_channel_dir.exists():
                for path in sorted(normalized_channel_dir.iterdir()):
                    if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS:
                        upsert_video(config_name, channel_name, relative_or_absolute(path), "normalized", "ready", False, db)

        if current_channel_names:
            placeholders = ",".join("?" for _name in current_channel_names)
            db.execute(
                f"""
                UPDATE channels
                SET enabled = 0, updated_at = ?
                WHERE config_name = ? AND name NOT IN ({placeholders})
                """,
                (now(), config_name, *sorted(current_channel_names)),
            )
        else:
            db.execute("UPDATE channels SET enabled = 0, updated_at = ? WHERE config_name = ?", (now(), config_name))

        log_dir = resolve_project_path(defaults.get("log_dir", "logs"))
        if log_dir.exists():
            for path in sorted(log_dir.glob("*.log")):
                channel_name = path.name.rsplit("-", 1)[0] if "-" in path.name else None
                db.execute(
                    """
                    INSERT OR IGNORE INTO logs(config_name, channel_name, source, path, message, created_at)
                    VALUES (?, ?, 'file', ?, ?, ?)
                    """,
                    (
                        config_name,
                        channel_name,
                        relative_or_absolute(path),
                        f"Log file indexed: {path.name}",
                        now(),
                    ),
                )


def record_task_start(
    task_uid: str,
    action: str,
    config_name: str,
    channel_name: str | None,
    command: str,
) -> int:
    init_db()
    with connect() as db:
        cursor = db.execute(
            """
            INSERT INTO tasks(task_uid, action, config_name, channel_name, command, status, started_at)
            VALUES (?, ?, ?, ?, ?, 'running', ?)
            """,
            (task_uid, action, config_name, channel_name, command, now()),
        )
        return int(cursor.lastrowid)


def record_task_finish(task_uid: str, returncode: int | None, output_tail: str) -> None:
    init_db()
    with connect() as db:
        db.execute(
            """
            UPDATE tasks
            SET status = ?, returncode = ?, finished_at = ?, output_tail = ?
            WHERE task_uid = ?
            """,
            ("success" if returncode == 0 else "failed", returncode, now(), output_tail, task_uid),
        )


def record_stream_start(
    config_name: str,
    channel_name: str,
    pid: int,
    command: str,
    log_path: str,
    live_title: str | None = None,
) -> int:
    init_db()
    with connect() as db:
        cursor = db.execute(
            """
            INSERT INTO stream_sessions(config_name, channel_name, live_title, pid, command, log_path, status, started_at)
            VALUES (?, ?, ?, ?, ?, ?, 'running', ?)
            """,
            (config_name, channel_name, live_title, pid, command, log_path, now()),
        )
        db.execute(
            """
            INSERT OR IGNORE INTO logs(config_name, channel_name, source, path, message, created_at)
            VALUES (?, ?, 'stream', ?, 'Stream log created', ?)
            """,
            (config_name, channel_name, log_path, now()),
        )
        return int(cursor.lastrowid)


def record_stream_stop(config_name: str, channel_name: str, returncode: int | None) -> None:
    init_db()
    with connect() as db:
        db.execute(
            """
            UPDATE stream_sessions
            SET status = 'stopped', returncode = ?, stopped_at = ?
            WHERE id = (
              SELECT id FROM stream_sessions
              WHERE config_name = ? AND channel_name = ? AND status = 'running'
              ORDER BY started_at DESC
              LIMIT 1
            )
            """,
            (returncode, now(), config_name, channel_name),
        )


def recent_stream_sessions(config_name: str | None = None, limit: int = 12) -> list[dict[str, Any]]:
    init_db()
    safe_limit = max(1, min(int(limit), 100))
    with connect() as db:
        if config_name:
            rows = db.execute(
                """
                SELECT id, config_name, channel_name, live_title, status, returncode, started_at, stopped_at
                FROM stream_sessions
                WHERE config_name = ?
                ORDER BY datetime(started_at) DESC, id DESC
                LIMIT ?
                """,
                (config_name, safe_limit),
            ).fetchall()
        else:
            rows = db.execute(
                """
                SELECT id, config_name, channel_name, live_title, status, returncode, started_at, stopped_at
                FROM stream_sessions
                ORDER BY datetime(started_at) DESC, id DESC
                LIMIT ?
                """,
                (safe_limit,),
            ).fetchall()

    sessions: list[dict[str, Any]] = []
    for row in rows:
        sessions.append(
            {
                "id": int(row["id"]),
                "config_name": row["config_name"],
                "channel_name": row["channel_name"],
                "live_title": str(row["live_title"] or row["channel_name"] or "Untitled live"),
                "status": str(row["status"] or ""),
                "returncode": row["returncode"],
                "started_at": str(row["started_at"] or ""),
                "stopped_at": str(row["stopped_at"] or ""),
            }
        )
    return sessions


def stats() -> dict[str, Any]:
    init_db()
    tables = ["channels", "videos", "settings_snapshots", "tasks", "stream_sessions", "logs", "app_events"]
    with connect() as db:
        return {
            "path": str(DB_PATH),
            **{table: db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] for table in tables},
        }


def recent_app_events(config_name: str | None = None, limit: int = 40) -> list[dict[str, Any]]:
    init_db()
    safe_limit = max(1, min(int(limit), 200))
    with connect() as db:
        if config_name:
            rows = db.execute(
                """
                SELECT id, event_type, config_name, channel_name, details_json, created_at
                FROM app_events
                WHERE config_name = ? OR config_name IS NULL
                ORDER BY id DESC
                LIMIT ?
                """,
                (config_name, safe_limit),
            ).fetchall()
        else:
            rows = db.execute(
                """
                SELECT id, event_type, config_name, channel_name, details_json, created_at
                FROM app_events
                ORDER BY id DESC
                LIMIT ?
                """,
                (safe_limit,),
            ).fetchall()

    events: list[dict[str, Any]] = []
    for row in rows:
        raw_details = row["details_json"] or "{}"
        try:
            details = json.loads(raw_details)
            if not isinstance(details, dict):
                details = {"raw": raw_details}
        except Exception:
            details = {"raw": raw_details}
        events.append(
            {
                "id": int(row["id"]),
                "event_type": str(row["event_type"] or ""),
                "config_name": row["config_name"],
                "channel_name": row["channel_name"],
                "created_at": str(row["created_at"] or ""),
                "details": details,
            }
        )
    return events


def clear_app_events(config_name: str | None = None, include_global: bool = True) -> int:
    init_db()
    with connect() as db:
        if config_name:
            if include_global:
                cursor = db.execute(
                    "DELETE FROM app_events WHERE config_name = ? OR config_name IS NULL",
                    (config_name,),
                )
            else:
                cursor = db.execute("DELETE FROM app_events WHERE config_name = ?", (config_name,))
        else:
            cursor = db.execute("DELETE FROM app_events")
    return int(cursor.rowcount or 0)
