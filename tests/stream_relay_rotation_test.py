import sys
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock
import time

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT))

import web_ui


def test_normalize_stream_relay_settings():
    # Empty / None defaults
    norm = web_ui.normalize_stream_relay_settings(None)
    assert norm["enabled"] is False
    assert norm["cooldown_seconds"] >= 60  # Handover cooldown buffer >= 1 minute
    assert norm["loop"] is True

    # Cooldown under 60 seconds must be clamped to 60 seconds for YouTube autostop buffer
    clamped = web_ui.normalize_stream_relay_settings({"cooldown_seconds": 15})
    assert clamped["cooldown_seconds"] == 60

    # Custom settings respected
    custom = web_ui.normalize_stream_relay_settings({
        "enabled": True,
        "cooldown_seconds": 120,
        "randomize_cooldown": True,
        "cooldown_random_minutes": 5,
        "loop": False,
    })
    assert custom["enabled"] is True
    assert custom["cooldown_seconds"] == 120
    assert custom["randomize_cooldown"] is True
    assert custom["cooldown_random_minutes"] == 5
    assert custom["loop"] is False


def test_stream_relay_persistence():
    with tempfile.TemporaryDirectory() as tmp_dir:
        temp_file = Path(tmp_dir) / "test-stream-relay-runtime.json"
        orig_file = web_ui.STREAM_RELAY_RUNTIME_FILE
        try:
            web_ui.STREAM_RELAY_RUNTIME_FILE = temp_file
            runtime_data = {
                "channel": "Test Channel",
                "phase": "waiting_cooldown",
                "cooldown_ends_at": 1000.0,
                "cooldown_seconds": 75,
                "active_stream_id": "",
                "next_stream_id": "stream_2",
            }
            web_ui.set_stream_relay_runtime(("config.test.json", "Test Channel"), runtime_data)
            assert temp_file.exists()

            # Clear state and restore
            web_ui.STATE.stream_relay_channels.clear()
            web_ui.load_stream_relay_runtime()
            restored = web_ui.STATE.stream_relay_channels.get(("config.test.json", "Test Channel"))
            assert restored is not None
            assert restored["phase"] == "waiting_cooldown"
            assert restored["next_stream_id"] == "stream_2"
        finally:
            web_ui.STREAM_RELAY_RUNTIME_FILE = orig_file
            web_ui.STATE.stream_relay_channels.clear()


def test_relay_rotation_five_streams_and_loop_wrap():
    config_name = "config.relay_test.json"
    channel_name = "Test Channel"

    streams = [
        {"id": f"stream_{i}", "name": f"Stream {i}", "enabled": True, "stream_cycle": {"duration_seconds": 30}}
        for i in range(1, 6)
    ]
    channel = {
        "name": channel_name,
        "streams": streams,
        "stream_relay": {
            "enabled": True,
            "cooldown_seconds": 75,
            "loop": True,
        }
    }
    config = {
        "channels": [channel],
    }

    now = 1000.0

    # Mock start_stream and stop_stream
    mock_running_stream = MagicMock()
    mock_running_stream.process.poll.return_value = None
    mock_running_stream.stop_requested = False

    mock_state = MagicMock()
    mock_state.config_name = config_name
    mock_state.started_at = now
    mock_state.running = mock_running_stream

    with patch.object(web_ui, "start_stream") as mock_start, \
         patch.object(web_ui, "stop_stream") as mock_stop, \
         patch.object(web_ui, "assert_youtube_channel_keys_match"), \
         patch.object(web_ui.app_db, "record_event"):

        mock_start.return_value = [f"{channel_name}:stream_1"]

        # 1. Initially idle, evaluate_channel_relay should kick off stream_1
        web_ui.evaluate_channel_relay(config_name, config, channel, streams, now=now)
        mock_start.assert_called_once_with(config_name, channel_name, stream_id="stream_1")
        runtime = web_ui.STATE.stream_relay_channels[(config_name, channel_name)]
        assert runtime["phase"] == "running"
        assert runtime["active_stream_id"] == "stream_1"
        assert runtime["next_stream_id"] == "stream_2"

        # 2. Simulate stream_1 running for 10 seconds (duration is 30s) -> should NOT stop
        mock_start.reset_mock()
        web_ui.STATE.streams[f"{channel_name}:stream_1"] = mock_state
        mock_state.started_at = now
        web_ui.evaluate_channel_relay(config_name, config, channel, streams, now=now + 10.0)
        assert mock_stop.call_count == 0
        assert web_ui.STATE.stream_relay_channels[(config_name, channel_name)]["phase"] == "running"

        # 3. Simulate stream_1 reaching 30s -> should stop and transition to waiting_cooldown
        web_ui.evaluate_channel_relay(config_name, config, channel, streams, now=now + 31.0)
        mock_stop.assert_called_once()
        _, stop_kwargs = mock_stop.call_args
        assert stop_kwargs["request_source"] == "stream_relay"
        assert stop_kwargs["stream_id"] == "stream_1"

        runtime = web_ui.STATE.stream_relay_channels[(config_name, channel_name)]
        assert runtime["phase"] == "waiting_cooldown"
        assert runtime["cooldown_seconds"] == 75
        assert runtime["next_stream_id"] == "stream_2"
        cooldown_ends = runtime["cooldown_ends_at"]
        assert cooldown_ends == (now + 31.0) + 75

        # Remove stream_1 from STATE.streams as it stopped
        web_ui.STATE.streams.pop(f"{channel_name}:stream_1", None)

        # 4. During cooldown (e.g. +40s into cooldown) -> should NOT start stream_2 yet (waiting for YouTube buffer)
        mock_start.reset_mock()
        web_ui.evaluate_channel_relay(config_name, config, channel, streams, now=now + 31.0 + 40.0)
        assert mock_start.call_count == 0
        assert web_ui.STATE.stream_relay_channels[(config_name, channel_name)]["phase"] == "waiting_cooldown"

        # 5. Cooldown expires (+76s) -> should automatically start stream_2!
        mock_start.return_value = [f"{channel_name}:stream_2"]
        web_ui.evaluate_channel_relay(config_name, config, channel, streams, now=cooldown_ends + 1.0)
        mock_start.assert_called_once_with(config_name, channel_name, stream_id="stream_2")

        runtime = web_ui.STATE.stream_relay_channels[(config_name, channel_name)]
        assert runtime["phase"] == "running"
        assert runtime["active_stream_id"] == "stream_2"
        assert runtime["next_stream_id"] == "stream_3"

        # 6. Test wrap-around from Stream 5 to Stream 1:
        # Simulate stream_5 waiting_cooldown expiring
        runtime["phase"] = "waiting_cooldown"
        runtime["next_stream_id"] = "stream_1"
        runtime["cooldown_ends_at"] = 2000.0
        mock_start.reset_mock()
        mock_start.return_value = [f"{channel_name}:stream_1"]

        web_ui.evaluate_channel_relay(config_name, config, channel, streams, now=2001.0)
        mock_start.assert_called_once_with(config_name, channel_name, stream_id="stream_1")
        runtime = web_ui.STATE.stream_relay_channels[(config_name, channel_name)]
        assert runtime["phase"] == "running"
        assert runtime["active_stream_id"] == "stream_1"
        assert runtime["next_stream_id"] == "stream_2"


def test_relay_skips_disabled_streams():
    config_name = "config.relay_test.json"
    channel_name = "Test Channel"

    # Stream 2 is disabled
    streams = [
        {"id": "stream_1", "enabled": True},
        {"id": "stream_2", "enabled": False},
        {"id": "stream_3", "enabled": True},
    ]
    channel = {
        "name": channel_name,
        "streams": streams,
        "stream_relay": {"enabled": True, "cooldown_seconds": 60, "loop": True}
    }
    config = {"channels": [channel]}

    now = 5000.0
    with patch.object(web_ui, "start_stream") as mock_start, \
         patch.object(web_ui, "stop_stream") as mock_stop, \
         patch.object(web_ui, "assert_youtube_channel_keys_match"), \
         patch.object(web_ui.app_db, "record_event"):

        # Simulate stream_1 finishing: next should skip disabled stream_2 and point directly to stream_3!
        mock_state = MagicMock()
        mock_state.config_name = config_name
        mock_state.started_at = now - 22000 # past default duration
        mock_state.running.process.poll.return_value = None
        web_ui.STATE.streams[f"{channel_name}:stream_1"] = mock_state

        web_ui.evaluate_channel_relay(config_name, config, channel, streams, now=now)
        runtime = web_ui.STATE.stream_relay_channels[(config_name, channel_name)]
        assert runtime["phase"] == "waiting_cooldown"
        assert runtime["next_stream_id"] == "stream_3"  # Skipped disabled stream_2!


def test_relay_manual_stop_continues_with_next_stream():
    channel_name = "Test Channel"
    config_name = "config.relay_test.json"

    streams = [
        {"id": f"stream_{i}", "enabled": True, "title_sets": [{"title": f"S{i} set {n}"} for n in range(1, 4)]}
        for i in range(1, 6)
    ]
    channel = {
        "name": channel_name,
        "streams": streams,
        "stream_relay": {"enabled": True, "cooldown_seconds": 75, "loop": True},
    }
    config = {"channels": [channel]}

    # Earlier tests leave mock streams for this channel in STATE.streams.
    for key in [k for k in web_ui.STATE.streams if k == channel_name or k.startswith(f"{channel_name}:")]:
        web_ui.STATE.streams.pop(key, None)

    # Relay is on stream 3 (index 2), title round 1 (set 2).
    web_ui.STATE.stream_relay_channels[(config_name, channel_name)] = {
        "phase": "running",
        "active_stream_id": "stream_3",
        "current_index": 2,
        "next_stream_id": "stream_4",
        "cycle_count": 7,
        "title_set_round": 1,
        "active_title_set_index": 1,
    }

    mock_state = MagicMock()
    mock_state.config_name = config_name
    mock_state.running.process.poll.return_value = None
    mock_state.running.preview_manifest = None
    mock_state.cloud_asset_ids = []
    mock_state.transferred_bytes.return_value = 0
    web_ui.STATE.streams[f"{channel_name}:stream_3"] = mock_state

    with tempfile.TemporaryDirectory() as tmp_dir, \
         patch.object(web_ui, "STREAM_RELAY_RUNTIME_FILE", Path(tmp_dir) / "relay.json"), \
         patch.object(web_ui, "request_stop_running_stream"), \
         patch.object(web_ui, "start_stream") as mock_start, \
         patch.object(web_ui, "assert_youtube_channel_keys_match"), \
         patch.object(web_ui.app_db, "record_stream_stop"), \
         patch.object(web_ui.app_db, "record_event"):

        web_ui.stop_stream(channel_name, stream_id="stream_3", request_source="api_stream_stop")

        runtime = web_ui.STATE.stream_relay_channels[(config_name, channel_name)]
        assert runtime["phase"] == "running"
        assert runtime["last_action"] == "manual_stop"

        # Next evaluation: no stream running -> handover cooldown towards stream_4, not a restart at stream_1.
        now = 3000.0
        web_ui.evaluate_channel_relay(config_name, config, channel, streams, now=now)
        runtime = web_ui.STATE.stream_relay_channels[(config_name, channel_name)]
        assert runtime["phase"] == "waiting_cooldown"
        assert runtime["next_stream_id"] == "stream_4"
        assert runtime["last_action"] == "manual_stop_transition_to_cooldown"
        assert mock_start.call_count == 0

        # Cooldown over -> stream_4 starts on the same title round.
        mock_start.return_value = [f"{channel_name}:stream_4"]
        web_ui.evaluate_channel_relay(config_name, config, channel, streams, now=runtime["cooldown_ends_at"] + 1.0)
        mock_start.assert_called_once_with(
            config_name, channel_name, stream_id="stream_4", title_set={"title": "S4 set 2", "description": "", "thumbnail_path": "", "index": 1}
        )
        runtime = web_ui.STATE.stream_relay_channels[(config_name, channel_name)]
        assert runtime["phase"] == "running"
        assert runtime["current_index"] == 3
        assert runtime["title_set_round"] == 1
        assert runtime["active_title_set_index"] == 1
        assert runtime["cycle_count"] == 7

    web_ui.STATE.streams.pop(f"{channel_name}:stream_3", None)
    web_ui.STATE.stream_relay_channels.pop((config_name, channel_name), None)


def test_resolve_channel_relay_duration_hierarchy():
    channel_name = "Inside Us"
    stream_entry = {"id": "stream_1", "name": "Test Stream"}
    channel = {"name": channel_name}

    # 1. Default fallback: 21600s (6h), False, 0s
    config = {"channels": [channel]}
    base_dur, is_rand, rand_sec = web_ui.resolve_channel_relay_duration(config, channel_name, channel, stream_entry)
    assert base_dur == 21600
    assert is_rand is False
    assert rand_sec == 0

    # 2. Inherits from channel-level stream_cycles in config["stream_cycles"]["channels"] (e.g. 100 mins random)
    config = {
        "stream_cycles": {
            "enabled": False,
            "randomized": True,
            "channels": [
                {
                    "channel": "Inside Us",
                    "duration_seconds": 21600,
                    "duration_random_minutes": 100,
                }
            ],
        },
        "channels": [channel],
    }
    base_dur, is_rand, rand_sec = web_ui.resolve_channel_relay_duration(config, channel_name, channel, stream_entry)
    assert base_dur == 21600
    assert is_rand is True
    assert rand_sec == 100 * 60

    # 3. Relay-level duration overrides channel cycle
    channel_with_relay = {
        "name": channel_name,
        "stream_relay": {
            "duration_seconds": 18000,
            "randomize_duration": True,
            "duration_random_minutes": 50,
        },
    }
    base_dur, is_rand, rand_sec = web_ui.resolve_channel_relay_duration(config, channel_name, channel_with_relay, stream_entry)
    assert base_dur == 18000
    assert is_rand is True
    assert rand_sec == 50 * 60

    # 4. Stream-level cycle overrides relay-level
    stream_entry_with_cycle = {
        "id": "stream_1",
        "stream_cycle": {
            "duration_seconds": 7200,
            "randomized": True,
            "duration_random_minutes": 15,
        },
    }
    base_dur, is_rand, rand_sec = web_ui.resolve_channel_relay_duration(config, channel_name, channel_with_relay, stream_entry_with_cycle)
    assert base_dur == 7200
    assert is_rand is True
    assert rand_sec == 15 * 60


def test_relay_premature_stream_exit_transitions_to_cooldown():
    channel_name = "Test Channel"
    config_name = "config.relay_test.json"

    streams = [
        {"id": "stream_1", "enabled": True},
        {"id": "stream_2", "enabled": True},
    ]
    channel = {
        "name": channel_name,
        "streams": streams,
        "stream_relay": {
            "enabled": True,
            "cooldown_seconds": 75,
            "loop": True,
        },
    }
    config = {"channels": [channel]}

    # State: stream_1 was running, but process has now exited (no entry in STATE.streams)
    now = 2000.0
    web_ui.STATE.stream_relay_channels[(config_name, channel_name)] = {
        "phase": "running",
        "active_stream_id": "stream_1",
        "current_index": 0,
        "next_stream_id": "stream_2",
        "stream_started_at": 1000.0,
    }
    web_ui.STATE.streams.pop(f"{channel_name}:stream_1", None)

    with patch.object(web_ui.app_db, "record_event") as mock_record, \
         patch.object(web_ui, "persist_stream_relay_runtime"):
        # When evaluate_channel_relay runs, it should detect stream exited and transition to waiting_cooldown
        web_ui.evaluate_channel_relay(config_name, config, channel, streams, now=now)

        runtime = web_ui.STATE.stream_relay_channels[(config_name, channel_name)]
        assert runtime["phase"] == "waiting_cooldown"
        assert runtime["next_stream_id"] == "stream_2"
        assert runtime["previous_stream_id"] == "stream_1"
        assert runtime["cooldown_seconds"] == 75
        assert runtime["cooldown_ends_at"] == now + 75.0
        assert runtime["last_action"] == "stream_exited_transition_to_cooldown"
        assert mock_record.call_count >= 1


def test_normalize_stream_relay_duration_and_random():
    norm = web_ui.normalize_stream_relay_settings({
        "enabled": True,
        "duration_seconds": 21600,
        "randomize_duration": True,
        "duration_random_minutes": 100,
        "cooldown_seconds": 75,
    })
    assert norm["enabled"] is True
    assert norm["duration_seconds"] == 21600
    assert norm["randomize_duration"] is True
    assert norm["duration_random_minutes"] == 100
    assert norm["cooldown_seconds"] == 75


