from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding="utf-8-sig")


def test_restart_to_update_keeps_stream_service_running():
    main = read("desktop/main.js")
    restart_handler = main.split('ipcMain.handle("desktop:request-restart-to-update"', 1)[1].split("});", 1)[0]
    request_quit = main.split('async function requestQuit(', 1)[1].split('ipcMain.handle("desktop:get-update-status"', 1)[0]
    updater = main.split("function configureAutoUpdates()", 1)[1].split("function writePidFile", 1)[0]

    assert '"restart-to-update"' in restart_handler
    assert '"stop-streams-and-exit"' not in restart_handler
    assert 'if (mode === "restart-to-update")' in request_quit
    restart_branch = request_quit.split('if (mode === "restart-to-update")', 1)[1].split('} else if (mode === "stop-streams-and-exit")', 1)[0]
    assert "/api/stream/stop" not in restart_branch
    assert "/api/system/shutdown" not in restart_branch
    assert 'quitMode = "ui-only"' in restart_branch
    assert "scheduleAutomaticUpdateInstall(version)" in updater
    assert 'requestQuit("auto-update", "restart-to-update"' in main


def test_packaged_ui_loads_new_files_and_routes_to_existing_backend():
    main = read("desktop/main.js")
    preload = read("desktop/preload.js")
    app_js = read("web/app.js")

    assert "service-runtimes" in main
    assert "prepareBackendRuntime()" in main
    assert 'mainWindow.loadFile(path.join(codeRoot(), "web", "index.html"))' in main
    assert 'ipcMain.handle("desktop:get-backend-url"' in main
    assert "getBackendUrl()" in preload
    assert "state.backendBaseUrl" in app_js
    assert "apiRequestUrl(path)" in app_js
    assert "fetch(requestUrl" in app_js


def test_backend_handoff_waits_for_idle_and_restarts_current_runtime():
    main = read("desktop/main.js")
    handoff = main.split('async function maybeHandoffIdleBackend(', 1)[1].split("async function hideUiToTray", 1)[0]

    assert "streamCountFromStatus(status)" in handoff
    running_branch = handoff.split("if (runningStreams > 0)", 1)[1].split("diagnosticLog(`backend update handoff starting", 1)[0]
    assert "/api/system/shutdown" not in running_branch
    assert "startBackendUpdateHandoffMonitor" in running_branch
    assert "backend-pending" in running_branch
    assert '"/api/system/shutdown"' in handoff
    assert "stop_streams: false" in handoff
    assert "startBackend(backendPort, { persistent: true })" in handoff
    assert "loadApplicationUi()" in handoff


def test_stream_cycle_cooldown_state_survives_backend_handoff():
    backend = read("scripts/web_ui.py")

    assert "STREAM_CYCLE_RUNTIME_FILE" in backend
    assert "def persist_stream_cycle_runtime()" in backend
    assert "def load_stream_cycle_runtime()" in backend
    assert "load_stream_cycle_runtime()" in backend.split("def main()", 1)[1]
    assert '"phase") != "waiting_restart"' in backend
    assert "set_stream_cycle_runtime(runtime_key, runtime)" in backend


if __name__ == "__main__":
    test_restart_to_update_keeps_stream_service_running()
    test_packaged_ui_loads_new_files_and_routes_to_existing_backend()
    test_backend_handoff_waits_for_idle_and_restarts_current_runtime()
    test_stream_cycle_cooldown_state_survives_backend_handoff()
    print("no_downtime_update_contract_test: PASS")
