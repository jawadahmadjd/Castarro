from __future__ import annotations

import os
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import web_ui  # noqa: E402



class FakeProcess:
    def __init__(self, pid: int, returncode: int | None = None) -> None:
        self.pid = pid
        self.returncode = returncode

    def poll(self) -> int | None:
        return self.returncode

    def terminate(self) -> None:
        self.returncode = 0

    def kill(self) -> None:
        self.returncode = 0

    def send_signal(self, sig: int) -> None:
        self.returncode = 0

    def wait(self, timeout: float | None = None) -> int:
        return self.returncode or 0




def fake_running_stream(name: str, *, log_dir: Path, pid: int) -> web_ui.stream_manager.RunningStream:
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / f"{name}-{pid}.log"
    handle = log_file.open("w+", encoding="utf-8")
    return web_ui.stream_manager.RunningStream(
        channel={"name": name},
        process=FakeProcess(pid),
        log_handle=handle,
        command=["fake-ffmpeg"],
        preview_manifest=None,
        preview_warning=None,
        started_monotonic=time.monotonic(),
        kind="stream",
        output_url="rtmp://127.0.0.1/live/test",
        masked_output_url="rtmp://127.0.0.1/live/***",
        log_redactions={},
        playlist_path=log_dir / "playlist.txt",
    )


def test_per_stream_cycle_lifecycle():
    original_state = web_ui.STATE
    original_load_config = web_ui.stream_manager.load_config
    original_stop_stream = web_ui.stream_manager.stop_stream
    original_start_stream = web_ui.stream_manager.start_stream
    original_assert_match = web_ui.assert_youtube_channel_keys_match
    original_record_event = web_ui.app_db.record_event
    original_record_stream_start = web_ui.app_db.record_stream_start
    original_record_stream_stop = web_ui.app_db.record_stream_stop
    original_unregister_cloud_assets = web_ui.unregister_cloud_assets
    original_runtime_file = web_ui.STREAM_CYCLE_RUNTIME_FILE

    events: list[tuple[str, str, dict]] = []
    started_calls: list[dict] = []

    with tempfile.TemporaryDirectory(prefix="castarro-multistream-cycle-", dir=str(ROOT)) as temp_dir:
        temp_root = Path(temp_dir)
        logs_dir = temp_root / "logs"

        running_a = fake_running_stream("Inside Us", log_dir=logs_dir, pid=3001)
        state_a = web_ui.StreamState("config.ready.json", running_a)
        state_a.stream_id = "stream_A"
        state_a.started_at = time.time() - 65  # Elapsed 65s (past 60s duration)

        running_b = fake_running_stream("Inside Us", log_dir=logs_dir, pid=3002)
        state_b = web_ui.StreamState("config.ready.json", running_b)
        state_b.stream_id = "stream_B"
        state_b.started_at = time.time() - 10  # Only elapsed 10s

        config = {
            "channels": [
                {
                    "name": "Inside Us",
                    "enabled": True,
                    "stream_key_env": "dummy-key",
                    "streams": [
                        {
                            "id": "stream_A",
                            "name": "Stream Alpha",
                            "enabled": True,
                            "stream_key": "key-alpha",
                            "stream_cycle": {
                                "enabled": True,
                                "duration_seconds": 60,
                                "restart_delay_seconds": 0,
                                "randomized": False,
                            },
                        },
                        {
                            "id": "stream_B",
                            "name": "Stream Beta",
                            "enabled": True,
                            "stream_key": "key-beta",
                            "stream_cycle": {
                                "enabled": False,
                                "duration_seconds": 3600,
                            },
                        },
                    ],
                }
            ]
        }

        def fake_stop(running_item: web_ui.stream_manager.RunningStream) -> None:
            running_item.stop_requested = True
            running_item.process.returncode = 0

        def fake_start(_config_dir: Path, _config: dict, channel: dict, *args, **kwargs):
            s_item = kwargs.get("stream_item") or {}
            sid = s_item.get("id") or "stream_1"
            pid = 4001 if sid == "stream_A" else 4002
            started_calls.append({"channel": channel.get("name"), "sid": sid, "pid": pid})
            return fake_running_stream(str(channel.get("name") or ""), log_dir=logs_dir, pid=pid)

        try:
            web_ui.STATE = web_ui.AppState()
            web_ui.STREAM_CYCLE_RUNTIME_FILE = temp_root / "stream-cycle-runtime.json"
            web_ui.STATE.streams["Inside Us:stream_A"] = state_a
            web_ui.STATE.streams["Inside Us:stream_B"] = state_b

            web_ui.stream_manager.load_config = lambda _path: (config, temp_root)
            web_ui.stream_manager.stop_stream = fake_stop
            web_ui.stream_manager.start_stream = fake_start
            web_ui.assert_youtube_channel_keys_match = lambda _config_name, _channel_name: None
            web_ui.app_db.record_event = lambda event, config_n, channel_n, details=None: events.append((event, channel_n, details or {}))
            web_ui.app_db.record_stream_start = lambda *_args, **_kwargs: None
            web_ui.app_db.record_stream_stop = lambda *_args, **_kwargs: None
            web_ui.unregister_cloud_assets = lambda _asset_ids: None

            # 1. Evaluate: Stream A duration reached -> should stop Stream A only!
            web_ui.evaluate_stream_cycles_for_config("config.ready.json", config)

            assert running_a.process.poll() == 0, "Stream A should have stopped."
            assert running_b.process.poll() is None, "Stream B should NOT have stopped."
            runtime_a = web_ui.STATE.stream_cycle_channels.get(("config.ready.json", "Inside Us:stream_A"))
            assert runtime_a is not None, "Stream A runtime should exist."
            assert runtime_a["phase"] == "waiting_restart"
            assert runtime_a["stream_id"] == "stream_A"

            # Check events recorded
            stop_events = [e for e in events if e[0] == "stream_cycle_stopped"]
            assert len(stop_events) == 1
            assert stop_events[0][2].get("stream_id") == "stream_A"

            # 2. Evaluate again: Cooldown is 0, so Stream A should restart immediately!
            web_ui.evaluate_stream_cycles_for_config("config.ready.json", config)
            assert len(started_calls) == 1, "Should have restarted Stream A only"
            assert started_calls[0]["sid"] == "stream_A"
            assert started_calls[0]["pid"] == 4001

            restarted_runtime_a = web_ui.STATE.stream_cycle_channels.get(("config.ready.json", "Inside Us:stream_A"))
            assert restarted_runtime_a["phase"] == "running"
            assert restarted_runtime_a["cycle_count"] == 1

            restart_events = [e for e in events if e[0] == "stream_cycle_restarted"]
            assert len(restart_events) == 1
            assert restart_events[0][2].get("stream_id") == "stream_A"

            # 3. Check stream_cycle_status returns stream rows
            st = web_ui.stream_cycle_status("config.ready.json", config)
            assert "streams" in st
            stream_row_a = next((s for s in st["streams"] if s["stream_id"] == "stream_A"), None)
            assert stream_row_a is not None
            assert stream_row_a["enabled"] is True
            assert stream_row_a["duration_seconds"] == 60

            print("test_per_stream_cycle_lifecycle: PASS")
        finally:
            for st in list(web_ui.STATE.streams.values()):
                if st.running and st.running.log_handle and not st.running.log_handle.closed:
                    st.running.log_handle.close()
            if running_a.log_handle and not running_a.log_handle.closed:
                running_a.log_handle.close()
            if running_b.log_handle and not running_b.log_handle.closed:
                running_b.log_handle.close()
            web_ui.STATE = original_state
            web_ui.stream_manager.load_config = original_load_config
            web_ui.stream_manager.stop_stream = original_stop_stream
            web_ui.stream_manager.start_stream = original_start_stream
            web_ui.assert_youtube_channel_keys_match = original_assert_match
            web_ui.app_db.record_event = original_record_event
            web_ui.app_db.record_stream_start = original_record_stream_start
            web_ui.app_db.record_stream_stop = original_record_stream_stop
            web_ui.STREAM_CYCLE_RUNTIME_FILE = original_runtime_file



def test_stream_cycle_apis_and_manual_stop():
    entry = web_ui.normalize_stream_cycle_entry(
        {"enabled": True, "duration_seconds": 180, "restart_delay_seconds": 180, "randomized": False}
    )
    assert entry["enabled"] is True
    assert entry["duration_seconds"] == 180
    assert entry["restart_delay_seconds"] == 180
    assert entry["randomized"] is False

    original_state = web_ui.STATE
    try:
        web_ui.STATE = web_ui.AppState()
        web_ui.STATE.stream_cycle_channels[("config.test.json", "Inside Us:stream_A")] = {
            "phase": "waiting_restart",
            "restart_at": time.time() + 180,
        }
        # Manual stop of stream_A should clear cycle runtime
        running = fake_running_stream("Inside Us", log_dir=Path(tempfile.gettempdir()) / "logs_dummy", pid=9999)
        st = web_ui.StreamState("config.test.json", running)
        web_ui.STATE.streams["Inside Us:stream_A"] = st
        web_ui.stop_stream("Inside Us", stream_id="stream_A", clear_cycle_runtime=True)
        assert ("config.test.json", "Inside Us:stream_A") not in web_ui.STATE.stream_cycle_channels
        if running.log_handle and not running.log_handle.closed:
            running.log_handle.close()
        print("test_stream_cycle_apis_and_manual_stop: PASS")
    finally:
        web_ui.STATE = original_state


if __name__ == "__main__":
    test_per_stream_cycle_lifecycle()
    test_stream_cycle_apis_and_manual_stop()

