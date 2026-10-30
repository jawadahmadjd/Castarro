import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT))

import web_ui

CONFIG_NAME = "config.title_sets_test.json"
CHANNEL_NAME = "Title Sets Channel"


def make_channel(set_counts, disabled=()):
    streams = []
    for i, count in enumerate(set_counts, start=1):
        streams.append({
            "id": f"stream_{i}",
            "enabled": i not in disabled,
            "title": f"S{i} own title",
            "title_sets": [{"title": f"S{i} T{n}", "thumbnail_path": f"/thumbs/s{i}_{n}.jpg"} for n in range(1, count + 1)],
        })
    channel = {"name": CHANNEL_NAME, "streams": streams, "stream_relay": {"enabled": True, "cooldown_seconds": 60, "loop": True}}
    return {"channels": [channel]}, channel, streams


def start_next(config, channel, streams, next_sid, now):
    """Put the relay at the end of a cooldown pointing at next_sid and let it start that stream."""
    runtime = web_ui.STATE.stream_relay_channels.setdefault((CONFIG_NAME, CHANNEL_NAME), {})
    runtime.update({"phase": "waiting_cooldown", "next_stream_id": next_sid, "cooldown_ends_at": now - 1})
    with patch.object(web_ui, "start_stream") as mock_start, \
         patch.object(web_ui, "assert_youtube_channel_keys_match"), \
         patch.object(web_ui.app_db, "record_event"), \
         patch.object(web_ui, "persist_stream_relay_runtime"), \
         patch.object(web_ui, "write_stream_relay_runtime_items"):
        mock_start.return_value = [f"{CHANNEL_NAME}:{next_sid}"]
        web_ui.evaluate_channel_relay(CONFIG_NAME, config, channel, streams, now=now)
        mock_start.assert_called_once()
        title_set = mock_start.call_args.kwargs.get("title_set")
    return title_set["title"] if title_set else None


def reset_state():
    web_ui.STATE.stream_relay_channels.pop((CONFIG_NAME, CHANNEL_NAME), None)
    for key in [k for k in web_ui.STATE.streams if str(k).startswith(CHANNEL_NAME)]:
        web_ui.STATE.streams.pop(key, None)


def test_round_in_progress_keeps_own_titles_then_sets_rotate_per_round():
    reset_state()
    config, channel, streams = make_channel([3, 3, 2])
    order = ["stream_2", "stream_3"] + ["stream_1", "stream_2", "stream_3"] * 4
    got = [start_next(config, channel, streams, sid, 1000.0 + i) for i, sid in enumerate(order)]
    assert got == [
        None, None,                      # round already running when sets were added
        "S1 T1", "S2 T1", "S3 T1",       # round 1
        "S1 T2", "S2 T2", "S3 T2",       # round 2
        "S1 T3", "S2 T3", "S3 T1",       # round 3: stream 3 has only 2 sets, wraps on its own list
        "S1 T1", "S2 T1", "S3 T2",       # round 4
    ]
    runtime = web_ui.STATE.stream_relay_channels[(CONFIG_NAME, CHANNEL_NAME)]
    assert runtime["title_set_round"] == 3
    assert runtime["active_title_set_index"] == 1
    reset_state()


def test_disabled_stream_is_skipped_and_round_advances_after_last_enabled():
    reset_state()
    config, channel, streams = make_channel([2, 2, 2], disabled=(3,))
    order = ["stream_1", "stream_2", "stream_1", "stream_2"]
    got = [start_next(config, channel, streams, sid, 2000.0 + i) for i, sid in enumerate(order)]
    assert got == ["S1 T1", "S2 T1", "S1 T2", "S2 T2"]
    reset_state()


def test_no_title_sets_means_no_override_and_no_round_counter():
    reset_state()
    config, channel, streams = make_channel([0, 0])
    got = [start_next(config, channel, streams, sid, 3000.0 + i) for i, sid in enumerate(["stream_1", "stream_2", "stream_1"])]
    assert got == [None, None, None]
    assert web_ui.STATE.stream_relay_channels[(CONFIG_NAME, CHANNEL_NAME)].get("title_set_round") is None
    reset_state()


def test_parse_title_sets_markdown():
    md = """
## 3 & 4. Livestreams

### Stream 1: Anatomy, color: teal

**Titles**
1. Title one
2. Title two

**Thumbnail prompts**
1. > prompt one

### Stream 2: Organs

**Titles**
1. Organs one

## 5. Other videos
1. Not a live title
"""
    assert web_ui.parse_title_sets_markdown(md) == {1: ["Title one", "Title two"], 2: ["Organs one"]}


def test_import_keeps_existing_thumbnails_by_slot():
    config, channel, streams = make_channel([2, 1])
    md = "### Stream 1\n**Titles**\n1. New A\n2. New B\n3. New C\n"
    with patch.object(web_ui, "load_config_or_none", return_value=(config, None)), \
         patch.object(web_ui, "save_config"):
        result = web_ui.import_title_sets_markdown_api(CONFIG_NAME, {"channel": CHANNEL_NAME, "markdown": md})
    assert result["imported"] == [{"stream_number": 1, "stream_id": "stream_1", "count": 3}]
    sets = streams[0]["title_sets"]
    assert [s["title"] for s in sets] == ["New A", "New B", "New C"]
    assert [s["thumbnail_path"] for s in sets] == ["/thumbs/s1_1.jpg", "/thumbs/s1_2.jpg", ""]
    assert streams[1]["title_sets"][0]["title"] == "S2 T1"


def test_title_over_youtube_limit_is_rejected():
    try:
        web_ui.validate_title_sets(web_ui.normalize_title_sets([{"title": "x" * 101}]))
    except ValueError as exc:
        assert "100" in str(exc)
    else:
        raise AssertionError("expected ValueError")


def test_new_broadcast_uses_set_and_keeps_stream_fallback_fields():
    with tempfile.TemporaryDirectory() as tmp:
        thumb = Path(tmp) / "set.jpg"
        thumb.write_bytes(b"\xff\xd8set-thumb")
        stream = {"id": "stream_1", "title": "Own title", "description": "Own description", "stream_key": "abcd-efgh-ijkl", "thumbnail_path": ""}
        channel = {"name": CHANNEL_NAME, "streams": [stream]}
        config = {"channels": [channel]}
        title_set = {"title": "Set title", "description": "", "thumbnail_path": str(thumb), "index": 4}
        with patch.object(web_ui, "channel_account_id", return_value="acct"), \
             patch.object(web_ui, "find_youtube_account", return_value={"id": "acct"}), \
             patch.object(web_ui, "account_config_view", return_value={}), \
             patch.object(web_ui.youtube_service, "valid_access_token", return_value=("token", {})), \
             patch.object(web_ui.youtube_service, "find_stream_and_broadcast_by_key", return_value=None), \
             patch.object(web_ui.youtube_service, "merge_settings", return_value={}), \
             patch.object(web_ui.youtube_service, "ensure_future_iso_time", side_effect=lambda t, **_: t), \
             patch.object(web_ui.youtube_service, "schedule_broadcast", return_value={"broadcast": {"id": "new-b", "studio_url": "u"}, "stream": {"id": "s"}}) as sched, \
             patch.object(web_ui.youtube_service, "upload_thumbnail") as upload, \
             patch.object(web_ui.youtube_service, "copy_video_thumbnail"), \
             patch.object(web_ui, "save_config"), \
             patch.object(web_ui, "clear_youtube_account_caches"), \
             patch.object(web_ui.app_db, "record_event"):
            replaced = web_ui.replace_stale_youtube_broadcast_for_start(CONFIG_NAME, config, channel, target_stream=stream, title_set=title_set)
        assert replaced is True
        assert sched.call_args.kwargs["title"] == "Set title"
        assert sched.call_args.kwargs["description"] == "Own description"  # set has no description -> stream's
        assert upload.call_args.kwargs["image_data"] == b"\xff\xd8set-thumb"
        assert stream["title"] == "Own title"
        assert stream["description"] == "Own description"
        assert stream["active_title_set"] == {"index": 4, "title": "Set title"}


def test_mirrored_config_json_is_not_automated_twice():
    with patch.object(web_ui, "available_configs", return_value=["config.json", "config.ready.json", "config_8streams.json"]):
        assert web_ui.automation_config_names() == ["config.ready.json", "config_8streams.json"]
    with patch.object(web_ui, "available_configs", return_value=["config.json", "other.json"]):
        assert web_ui.automation_config_names() == ["config.json", "other.json"]
