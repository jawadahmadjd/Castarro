"""Local SQLite history for the streaming UI."""

from __future__ import annotations

import json
import sqlite3
import hashlib
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
              youtube_dual_stream INTEGER NOT NULL DEFAULT 1,
              youtube_studio_url TEXT,
              normalize_profile_json TEXT,
              raw_playlist_json TEXT,
              playlist_json TEXT,
              cloud_playlist_json TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              UNIQUE(config_name, name)
            );

            CREATE TABLE IF NOT EXISTS storage_providers (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              config_name TEXT NOT NULL,
              provider_id TEXT NOT NULL,
              provider_type TEXT NOT NULL,
              display_name TEXT NOT NULL,
              auth_mode TEXT NOT NULL,
              status TEXT NOT NULL,
              tokens_file TEXT,
              account_email TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              UNIQUE(config_name, provider_id)
            );

            CREATE TABLE IF NOT EXISTS cloud_videos (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              config_name TEXT NOT NULL,
              channel_name TEXT NOT NULL,
              provider_id TEXT NOT NULL,
              provider_file_id TEXT NOT NULL,
              display_name TEXT NOT NULL,
              source_uri TEXT,
              compatibility_status TEXT NOT NULL,
              compatibility_message TEXT,
              selected INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              UNIQUE(config_name, channel_name, provider_id, provider_file_id)
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
              youtube_broadcast_id TEXT,
              live_chat_id TEXT,
              pid INTEGER,
              command TEXT NOT NULL,
              log_path TEXT,
              status TEXT NOT NULL,
              returncode INTEGER,
              transferred_bytes INTEGER NOT NULL DEFAULT 0,
              started_at TEXT NOT NULL,
              stopped_at TEXT
            );

            CREATE TABLE IF NOT EXISTS live_chat_messages (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              config_name TEXT NOT NULL,
              channel_name TEXT NOT NULL,
              stream_session_id INTEGER,
              youtube_broadcast_id TEXT NOT NULL,
              live_chat_id TEXT NOT NULL,
              youtube_message_id TEXT NOT NULL,
              author_display_name TEXT,
              author_profile_image_url TEXT,
              display_message TEXT,
              message_text TEXT,
              published_at TEXT,
              received_at TEXT,
              sent_at TEXT,
              is_chat_owner INTEGER NOT NULL DEFAULT 0,
              is_chat_moderator INTEGER NOT NULL DEFAULT 0,
              is_chat_sponsor INTEGER NOT NULL DEFAULT 0,
              is_verified INTEGER NOT NULL DEFAULT 0,
              raw_json TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY(stream_session_id) REFERENCES stream_sessions(id) ON DELETE SET NULL,
              UNIQUE(config_name, channel_name, youtube_broadcast_id, youtube_message_id)
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
        if "youtube_broadcast_id" not in columns:
            db.execute("ALTER TABLE stream_sessions ADD COLUMN youtube_broadcast_id TEXT")
        if "live_chat_id" not in columns:
            db.execute("ALTER TABLE stream_sessions ADD COLUMN live_chat_id TEXT")
        if "transferred_bytes" not in columns:
            db.execute("ALTER TABLE stream_sessions ADD COLUMN transferred_bytes INTEGER NOT NULL DEFAULT 0")
        channel_columns = {
            str(row["name"])
            for row in db.execute("PRAGMA table_info(channels)").fetchall()
        }
        if "cloud_playlist_json" not in channel_columns:
            db.execute("ALTER TABLE channels ADD COLUMN cloud_playlist_json TEXT")
        if "youtube_dual_stream" not in channel_columns:
            db.execute("ALTER TABLE channels ADD COLUMN youtube_dual_stream INTEGER NOT NULL DEFAULT 1")


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
              youtube_auto_start, youtube_auto_stop, youtube_dual_stream, youtube_studio_url,
              normalize_profile_json, raw_playlist_json, playlist_json, cloud_playlist_json,
              created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(config_name, name) DO UPDATE SET
              enabled=excluded.enabled,
              stream_key_env=excluded.stream_key_env,
              has_inline_key=excluded.has_inline_key,
              youtube_auto_start=excluded.youtube_auto_start,
              youtube_auto_stop=excluded.youtube_auto_stop,
              youtube_dual_stream=excluded.youtube_dual_stream,
              youtube_studio_url=excluded.youtube_studio_url,
              normalize_profile_json=excluded.normalize_profile_json,
              raw_playlist_json=excluded.raw_playlist_json,
              playlist_json=excluded.playlist_json,
              cloud_playlist_json=excluded.cloud_playlist_json,
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
                int(bool(channel.get("youtube_dual_stream", True))),
                channel.get("youtube_studio_url", ""),
                json.dumps(channel.get("normalize_profile", {}), sort_keys=True),
                json.dumps(channel.get("raw_playlist", []), sort_keys=True),
                json.dumps(channel.get("playlist", []), sort_keys=True),
                json.dumps(channel.get("cloud_playlist", []), sort_keys=True),
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


def upsert_storage_provider(config_name: str, provider: dict[str, Any], db: sqlite3.Connection | None = None) -> None:
    provider_id = str(provider.get("id") or "").strip()
    if not provider_id:
        return
    timestamp = now()
    owns_connection = db is None
    if db is None:
        db = connect()
    try:
        db.execute(
            """
            INSERT INTO storage_providers(
              config_name, provider_id, provider_type, display_name, auth_mode,
              status, tokens_file, account_email, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(config_name, provider_id) DO UPDATE SET
              provider_type=excluded.provider_type,
              display_name=excluded.display_name,
              auth_mode=excluded.auth_mode,
              status=excluded.status,
              tokens_file=excluded.tokens_file,
              account_email=excluded.account_email,
              updated_at=excluded.updated_at
            """,
            (
                config_name,
                provider_id,
                str(provider.get("type") or ""),
                str(provider.get("display_name") or provider.get("displayName") or provider_id),
                str(provider.get("auth_mode") or provider.get("authMode") or ""),
                str(provider.get("status") or ""),
                str(provider.get("tokens_file") or ""),
                str(provider.get("account_email") or provider.get("accountEmail") or ""),
                timestamp,
                timestamp,
            ),
        )
        if owns_connection:
            db.commit()
    finally:
        if owns_connection:
            db.close()


def upsert_cloud_video(
    config_name: str,
    channel_name: str,
    item: dict[str, Any],
    db: sqlite3.Connection | None = None,
) -> None:
    provider_id = str(item.get("provider_id") or item.get("providerId") or "").strip()
    file_id = str(item.get("file_id") or item.get("provider_file_id") or item.get("providerFileId") or "").strip()
    if not channel_name or not provider_id or not file_id:
        return
    display_name = str(item.get("display_name") or item.get("displayName") or file_id).strip() or file_id
    timestamp = now()
    owns_connection = db is None
    if db is None:
        db = connect()
    try:
        db.execute(
            """
            INSERT INTO cloud_videos(
              config_name, channel_name, provider_id, provider_file_id, display_name,
              source_uri, compatibility_status, compatibility_message, selected,
              created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(config_name, channel_name, provider_id, provider_file_id) DO UPDATE SET
              display_name=excluded.display_name,
              source_uri=excluded.source_uri,
              compatibility_status=excluded.compatibility_status,
              compatibility_message=excluded.compatibility_message,
              selected=excluded.selected,
              updated_at=excluded.updated_at
            """,
            (
                config_name,
                channel_name,
                provider_id,
                file_id,
                display_name,
                str(item.get("source_uri") or item.get("sourceUri") or ""),
                str(item.get("compatibility_status") or item.get("compatibilityStatus") or "unknown"),
                str(item.get("compatibility_message") or item.get("compatibilityMessage") or ""),
                1,
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

        storage = config.get("storage") if isinstance(config.get("storage"), dict) else {}
        storage_providers = storage.get("providers", [])
        if not isinstance(storage_providers, list):
            storage_providers = []
        for provider in storage_providers:
            if isinstance(provider, dict):
                upsert_storage_provider(config_name, provider, db)

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

            cloud_playlist = channel.get("cloud_playlist", [])
            if isinstance(cloud_playlist, list):
                for item in cloud_playlist:
                    if isinstance(item, dict):
                        upsert_cloud_video(config_name, channel_name, item, db)

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
    youtube_broadcast_id: str | None = None,
    live_chat_id: str | None = None,
) -> int:
    init_db()
    with connect() as db:
        cursor = db.execute(
            """
            INSERT INTO stream_sessions(
              config_name, channel_name, live_title, youtube_broadcast_id, live_chat_id,
              pid, command, log_path, status, started_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)
            """,
            (
                config_name,
                channel_name,
                live_title,
                str(youtube_broadcast_id or "").strip() or None,
                str(live_chat_id or "").strip() or None,
                pid,
                command,
                log_path,
                now(),
            ),
        )
        db.execute(
            """
            INSERT OR IGNORE INTO logs(config_name, channel_name, source, path, message, created_at)
            VALUES (?, ?, 'stream', ?, 'Stream log created', ?)
            """,
            (config_name, channel_name, log_path, now()),
        )
        return int(cursor.lastrowid)


def live_chat_message_key(message: dict[str, Any], live_chat_id: str) -> str:
    explicit_id = str(message.get("id") or message.get("youtube_message_id") or "").strip()
    if explicit_id:
        return explicit_id
    identity = {
        "live_chat_id": live_chat_id,
        "author": str(message.get("author_display_name") or ""),
        "text": str(message.get("display_message") or message.get("message_text") or ""),
        "time": str(message.get("published_at") or message.get("sent_at") or message.get("received_at") or ""),
    }
    digest = hashlib.sha256(json.dumps(identity, sort_keys=True).encode("utf-8")).hexdigest()
    return f"generated-{digest[:24]}"


def live_chat_message_time(message: dict[str, Any]) -> str:
    return str(message.get("published_at") or message.get("sent_at") or message.get("received_at") or "")


def find_live_chat_stream_session_id(
    db: sqlite3.Connection,
    config_name: str,
    channel_name: str,
    youtube_broadcast_id: str,
) -> int | None:
    params: list[Any] = [config_name, channel_name]
    broadcast_clause = ""
    if youtube_broadcast_id:
        broadcast_clause = "AND (youtube_broadcast_id = ? OR youtube_broadcast_id IS NULL OR youtube_broadcast_id = '')"
        params.append(youtube_broadcast_id)
    row = db.execute(
        f"""
        SELECT id
        FROM stream_sessions
        WHERE config_name = ?
          AND channel_name = ?
          AND status = 'running'
          {broadcast_clause}
        ORDER BY datetime(started_at) DESC, id DESC
        LIMIT 1
        """,
        params,
    ).fetchone()
    if row:
        session_id = int(row["id"])
        if youtube_broadcast_id:
            db.execute(
                """
                UPDATE stream_sessions
                SET youtube_broadcast_id = COALESCE(NULLIF(youtube_broadcast_id, ''), ?)
                WHERE id = ?
                """,
                (youtube_broadcast_id, session_id),
            )
        return session_id

    if not youtube_broadcast_id:
        return None
    row = db.execute(
        """
        SELECT id
        FROM stream_sessions
        WHERE config_name = ?
          AND channel_name = ?
          AND youtube_broadcast_id = ?
        ORDER BY datetime(started_at) DESC, id DESC
        LIMIT 1
        """,
        (config_name, channel_name, youtube_broadcast_id),
    ).fetchone()
    return int(row["id"]) if row else None


def record_live_chat_messages(
    config_name: str,
    channel_name: str,
    youtube_broadcast_id: str,
    live_chat_id: str,
    messages: list[dict[str, Any]],
) -> None:
    if not messages:
        return
    init_db()
    broadcast_id = str(youtube_broadcast_id or "").strip()
    chat_id = str(live_chat_id or "").strip()
    if not broadcast_id or not chat_id:
        return
    timestamp = now()
    with connect() as db:
        session_id = find_live_chat_stream_session_id(db, config_name, channel_name, broadcast_id)
        for message in messages:
            if not isinstance(message, dict):
                continue
            message_id = live_chat_message_key(message, chat_id)
            display_message = str(message.get("display_message") or "")
            message_text = str(message.get("message_text") or display_message or "")
            db.execute(
                """
                INSERT INTO live_chat_messages(
                  config_name, channel_name, stream_session_id, youtube_broadcast_id, live_chat_id,
                  youtube_message_id, author_display_name, author_profile_image_url, display_message,
                  message_text, published_at, received_at, sent_at, is_chat_owner, is_chat_moderator,
                  is_chat_sponsor, is_verified, raw_json, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(config_name, channel_name, youtube_broadcast_id, youtube_message_id)
                DO UPDATE SET
                  stream_session_id = COALESCE(live_chat_messages.stream_session_id, excluded.stream_session_id),
                  live_chat_id = excluded.live_chat_id,
                  author_display_name = excluded.author_display_name,
                  author_profile_image_url = excluded.author_profile_image_url,
                  display_message = excluded.display_message,
                  message_text = excluded.message_text,
                  published_at = COALESCE(NULLIF(excluded.published_at, ''), live_chat_messages.published_at),
                  received_at = COALESCE(NULLIF(excluded.received_at, ''), live_chat_messages.received_at),
                  sent_at = COALESCE(NULLIF(excluded.sent_at, ''), live_chat_messages.sent_at),
                  is_chat_owner = excluded.is_chat_owner,
                  is_chat_moderator = excluded.is_chat_moderator,
                  is_chat_sponsor = excluded.is_chat_sponsor,
                  is_verified = excluded.is_verified,
                  raw_json = excluded.raw_json,
                  updated_at = excluded.updated_at
                """,
                (
                    config_name,
                    channel_name,
                    session_id,
                    broadcast_id,
                    chat_id,
                    message_id,
                    str(message.get("author_display_name") or ""),
                    str(message.get("author_profile_image_url") or ""),
                    display_message,
                    message_text,
                    str(message.get("published_at") or ""),
                    str(message.get("received_at") or ""),
                    str(message.get("sent_at") or ""),
                    1 if message.get("is_chat_owner") else 0,
                    1 if message.get("is_chat_moderator") else 0,
                    1 if message.get("is_chat_sponsor") else 0,
                    1 if message.get("is_verified") else 0,
                    json.dumps(message, sort_keys=True),
                    timestamp,
                    timestamp,
                ),
            )


def record_stream_stop(
    config_name: str,
    channel_name: str,
    returncode: int | None,
    transferred_bytes: int | None = None,
) -> None:
    init_db()
    safe_bytes = max(0, int(transferred_bytes or 0))
    with connect() as db:
        db.execute(
            """
            UPDATE stream_sessions
            SET status = 'stopped', returncode = ?, transferred_bytes = ?, stopped_at = ?
            WHERE id = (
              SELECT id FROM stream_sessions
              WHERE config_name = ? AND channel_name = ? AND status = 'running'
              ORDER BY started_at DESC
              LIMIT 1
            )
            """,
            (returncode, safe_bytes, now(), config_name, channel_name),
        )


def stream_transfer_today_bytes(config_name: str | None = None) -> int:
    init_db()
    local_midnight = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
    utc_midnight = local_midnight.astimezone(timezone.utc).isoformat(timespec="seconds")
    where = ["datetime(started_at) >= datetime(?)"]
    params: list[Any] = [utc_midnight]
    if config_name:
        where.append("config_name = ?")
        params.append(config_name)
    with connect() as db:
        row = db.execute(
            f"""
            SELECT COALESCE(SUM(transferred_bytes), 0) AS total
            FROM stream_sessions
            WHERE {' AND '.join(where)}
            """,
            params,
        ).fetchone()
    return int(row["total"] or 0) if row else 0


def live_chat_messages_for_session(db: sqlite3.Connection, session: dict[str, Any], limit: int = 4) -> dict[str, Any]:
    session_id = int(session.get("id") or 0)
    broadcast_id = str(session.get("youtube_broadcast_id") or "").strip()
    where = ["config_name = ?", "channel_name = ?"]
    params: list[Any] = [session.get("config_name"), session.get("channel_name")]
    if broadcast_id:
        where.append("(stream_session_id = ? OR youtube_broadcast_id = ?)")
        params.extend([session_id, broadcast_id])
    else:
        where.append("stream_session_id = ?")
        params.append(session_id)
    where_clause = " AND ".join(where)
    count_row = db.execute(
        f"SELECT COUNT(*) AS count FROM live_chat_messages WHERE {where_clause}",
        params,
    ).fetchone()
    rows = db.execute(
        f"""
        SELECT
          youtube_message_id,
          author_display_name,
          author_profile_image_url,
          display_message,
          message_text,
          published_at,
          received_at,
          sent_at,
          is_chat_owner,
          is_chat_moderator,
          is_chat_sponsor,
          is_verified
        FROM live_chat_messages
        WHERE {where_clause}
        ORDER BY datetime(COALESCE(NULLIF(published_at, ''), NULLIF(sent_at, ''), NULLIF(received_at, ''), created_at)) DESC,
                 id DESC
        LIMIT ?
        """,
        [*params, max(1, min(int(limit), 25))],
    ).fetchall()
    messages: list[dict[str, Any]] = []
    for row in rows:
        messages.append(
            {
                "id": str(row["youtube_message_id"] or ""),
                "author_display_name": str(row["author_display_name"] or ""),
                "author_profile_image_url": str(row["author_profile_image_url"] or ""),
                "display_message": str(row["display_message"] or ""),
                "message_text": str(row["message_text"] or ""),
                "published_at": str(row["published_at"] or ""),
                "received_at": str(row["received_at"] or ""),
                "sent_at": str(row["sent_at"] or ""),
                "is_chat_owner": bool(row["is_chat_owner"]),
                "is_chat_moderator": bool(row["is_chat_moderator"]),
                "is_chat_sponsor": bool(row["is_chat_sponsor"]),
                "is_verified": bool(row["is_verified"]),
            }
        )
    return {
        "comment_count": int(count_row["count"] or 0) if count_row else 0,
        "recent_comments": messages,
    }


def stream_sessions(
    config_name: str | None = None,
    *,
    channel_name: str | None = None,
    started_after: str | None = None,
    started_before: str | None = None,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    init_db()
    safe_limit = None if limit is None else max(1, min(int(limit), 10000))
    where: list[str] = []
    params: list[Any] = []
    if config_name:
        where.append("config_name = ?")
        params.append(config_name)
    if channel_name:
        where.append("channel_name = ?")
        params.append(channel_name)
    if started_after:
        where.append("datetime(started_at) >= datetime(?)")
        params.append(started_after)
    if started_before:
        where.append("datetime(started_at) <= datetime(?)")
        params.append(started_before)
    where_clause = f"WHERE {' AND '.join(where)}" if where else ""
    limit_clause = "LIMIT ?" if safe_limit is not None else ""
    if safe_limit is not None:
        params.append(safe_limit)
    with connect() as db:
        rows = db.execute(
            f"""
            SELECT
              id, config_name, channel_name, live_title, youtube_broadcast_id, live_chat_id,
              pid, log_path, status, returncode, transferred_bytes, started_at, stopped_at
            FROM stream_sessions
            {where_clause}
            ORDER BY datetime(started_at) DESC, id DESC
            {limit_clause}
            """,
            params,
        ).fetchall()

    sessions: list[dict[str, Any]] = []
    for row in rows:
        sessions.append(
            {
                "id": int(row["id"]),
                "config_name": row["config_name"],
                "channel_name": row["channel_name"],
                "live_title": str(row["live_title"] or row["channel_name"] or "Untitled live"),
                "youtube_broadcast_id": str(row["youtube_broadcast_id"] or ""),
                "live_chat_id": str(row["live_chat_id"] or ""),
                "pid": row["pid"],
                "log_path": str(row["log_path"] or ""),
                "status": str(row["status"] or ""),
                "returncode": row["returncode"],
                "transferred_bytes": int(row["transferred_bytes"] or 0),
                "started_at": str(row["started_at"] or ""),
                "stopped_at": str(row["stopped_at"] or ""),
            }
        )
    with connect() as db:
        for session in sessions:
            session.update(live_chat_messages_for_session(db, session))
    return sessions


def recent_stream_sessions(
    config_name: str | None = None,
    channel_name: str | None = None,
    limit: int = 12,
) -> list[dict[str, Any]]:
    return stream_sessions(config_name, channel_name=channel_name, limit=limit)


def stats() -> dict[str, Any]:
    init_db()
    tables = [
        "channels",
        "videos",
        "storage_providers",
        "cloud_videos",
        "settings_snapshots",
        "tasks",
        "stream_sessions",
        "live_chat_messages",
        "logs",
        "app_events",
    ]
    with connect() as db:
        return {
            "path": str(DB_PATH),
            **{table: db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] for table in tables},
        }


def recent_app_events(
    config_name: str | None = None,
    channel_name: str | None = None,
    event_type: str | None = None,
    limit: int = 40,
) -> list[dict[str, Any]]:
    init_db()
    safe_limit = max(1, min(int(limit), 200))
    where: list[str] = []
    params: list[Any] = []
    if config_name:
        where.append("(config_name = ? OR config_name IS NULL)")
        params.append(config_name)
    if channel_name:
        where.append("channel_name = ?")
        params.append(channel_name)
    if event_type:
        where.append("event_type = ?")
        params.append(event_type)
    where_clause = f"WHERE {' AND '.join(where)}" if where else ""
    params.append(safe_limit)
    with connect() as db:
        rows = db.execute(
            f"""
            SELECT id, event_type, config_name, channel_name, details_json, created_at
            FROM app_events
            {where_clause}
            ORDER BY id DESC
            LIMIT ?
            """,
            params,
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


def clear_app_events(
    config_name: str | None = None,
    include_global: bool = True,
    channel_name: str | None = None,
) -> int:
    init_db()
    where: list[str] = []
    params: list[Any] = []
    if config_name:
        if include_global and not channel_name:
            where.append("(config_name = ? OR config_name IS NULL)")
        else:
            where.append("config_name = ?")
        params.append(config_name)
    if channel_name:
        where.append("channel_name = ?")
        params.append(channel_name)
    where_clause = f" WHERE {' AND '.join(where)}" if where else ""
    with connect() as db:
        cursor = db.execute(f"DELETE FROM app_events{where_clause}", params)
    return int(cursor.rowcount or 0)
