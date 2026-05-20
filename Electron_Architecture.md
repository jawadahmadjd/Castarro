# Electron Packaging Architecture Plan

## Goal

Package Castarro's Python + FFmpeg + web UI project into a stable Windows-first Electron desktop app with minimal behavior change from the current local workflow.

## Recommended Architecture

1. Electron main process starts.
2. Electron spawns bundled Python runtime as a child process.
3. Python launches `scripts/web_ui.py` on localhost (dynamic or configured port).
4. Electron waits for backend healthcheck (`/api/status`) to succeed.
5. Electron BrowserWindow loads the local URL.
6. Existing Python orchestration continues to manage FFmpeg/FFprobe and stream tasks.
7. FFmpeg/FFprobe are shipped in app resources and injected via absolute runtime paths.

## Why This Approach

1. Current core logic is Python-first and already production-aligned for streaming workflows.
2. Reusing backend logic reduces rewrite risk and preserves behavior.
3. Electron provides straightforward Windows packaging and installer support for mixed-runtime apps.

## Component Design

### 1. Electron Main Process

Responsibilities:

1. App lifecycle (`ready`, `activate`, `before-quit`, `window-all-closed`).
2. Single-instance lock.
3. Backend process supervisor.
4. Healthcheck polling and timeout handling.
5. Safe shutdown of backend on quit.
6. System tray/menu actions.
7. Diagnostics and log folder shortcuts.

### 2. Backend Runtime (Python)

Responsibilities:

1. Serve web dashboard (`scripts/web_ui.py`).
2. Handle API endpoints (`status`, `task`, `stream`, `config`).
3. Spawn/manage FFmpeg subprocesses.
4. Write logs/tasks/state to SQLite and log files.
5. Gracefully stop tasks/streams on signal.

### 3. FFmpeg Layer

Responsibilities:

1. Bundled `ffmpeg.exe` and `ffprobe.exe`.
2. Runtime path injection into active config.
3. Validation checks at startup.
4. Clear user-facing errors if binaries are missing/corrupt.

### 4. Data and Filesystem Model

Mutable app data should be in user-writable app-data (not install directory):

1. `config.json`
2. `config.ready.json`
3. `stream_control.db`
4. `logs/`
5. `.runtime/`
6. `Raw Videos/`
7. `Go Live/`
8. `playlists/`

## Packaging Phases

### Phase 0: Baseline Freeze

1. Capture known-good behavior from current repo state.
2. Run baseline smoke flows:
   1. validate
   2. normalize
   3. start stream
   4. stop stream
3. Archive baseline logs/artifacts for comparison.

### Phase 1: Electron Shell Scaffolding

1. Create `desktop/` app structure.
2. Add Electron main/preload/renderer shell.
3. Implement backend launcher and healthcheck wait.
4. Show loading/error UI while backend initializes.

### Phase 2: Python Runtime Bundling

1. Bundle portable embedded Python for Windows.
2. Include required packages/dependencies.
3. Resolve backend script paths in packaged environment.
4. Ensure startup works without system-wide Python.

### Phase 3: FFmpeg/FFprobe Bundling

1. Place binaries in app resources.
2. Resolve absolute binary paths at runtime.
3. Inject into loaded config defaults.
4. Add startup verification and actionable error reporting.

### Phase 4: App-Data Path Migration

1. Redirect all mutable outputs to app-data root.
2. Implement first-run migration from legacy folder layout.
3. Keep backups during migration for safety.
4. Add rollback/error guidance if migration fails.

### Phase 5: Lifecycle Hardening

1. Graceful app quit drains tasks and streams.
2. Ensure no orphan Python/FFmpeg processes remain.
3. Add crash recovery behavior on relaunch.
4. Add optional watchdog/retry for backend failures.

### Phase 6: Installer and Release

1. Configure `electron-builder` (NSIS, icons, metadata).
2. Build signed/unsigned variants as needed.
3. Create versioned release artifacts.
4. Publish with release checklist gates.

## Test Strategy

### Unit Tests

Python:

1. Config loading and path resolution.
2. Playlist generation and media discovery.
3. Stream key resolution (`stream_key`, `stream_key_env`, inferred key fallback).
4. Task progress parsing.
5. Preview path safety checks.

Electron:

1. Backend launch argument construction.
2. Healthcheck retry and timeout logic.
3. Shutdown hooks and process cleanup.
4. Single-instance behavior.

### Integration Tests

1. Electron starts backend and loads UI URL successfully.
2. Backend API reachable in packaged mode.
3. FFmpeg/FFprobe binaries discovered from bundled paths.
4. Config create/save flows persist in app-data.

### End-to-End (Packaged App) Tests

1. Fresh install -> first launch -> config create.
2. Add videos -> normalize -> stream start -> stream stop.
3. Close/reopen app -> state persists.
4. Upgrade install keeps user data.
5. Uninstall/reinstall behavior matches policy.

### Resilience Tests

1. Kill Python process mid-session -> app shows recovery state.
2. Kill FFmpeg process -> expected restart/failed state behavior.
3. Network drop while streaming -> stable error handling and logs.
4. Force-close app during stream -> relaunch cleanup verification.

### Security and Hardening Tests

1. `contextIsolation: true`, `nodeIntegration: false`.
2. Renderer cannot access Node directly.
3. Navigation restricted to local trusted origin.
4. External URL opens only through explicit allowlist.

### Performance/Stability Tests

1. Cold startup time benchmark.
2. Idle memory footprint benchmark.
3. Active streaming memory/CPU profile.
4. Long-run stability test (8-12 hours streaming).

## Formal Test Matrix

| Layer | Scenario | Pass Criteria |
|---|---|---|
| Unit | Python config/playlist/key logic | Deterministic outputs, no regressions |
| Unit | Electron launcher/lifecycle | No zombie backend processes |
| Integration | Packaged launch + API health | UI loads and backend responds |
| Integration | FFmpeg path injection | Validate/normalize/start use bundled binaries |
| E2E | Fresh install full operator flow | Workflow completes without manual patching |
| E2E | Upgrade existing user data | Data retained and usable |
| Resilience | Crash/kill/restart conditions | Controlled recovery and clear errors |
| Security | Renderer and navigation restrictions | Unsafe access blocked |
| Performance | Startup and long-run metrics | Within agreed thresholds |

## Go-Live TODO Checklist

- [x] Scaffold Electron app (`desktop/`) with `electron-builder`.
- [x] Implement backend process supervisor in main process.
- [x] Bundle portable Python runtime and dependencies.
- [x] Bundle `ffmpeg.exe` and `ffprobe.exe`.
- [x] Add runtime binary path detection and validation.
- [x] Migrate all mutable paths to user app-data directory.
- [x] Implement first-run migration from legacy project layout.
- [x] Add graceful shutdown and orphan cleanup handling.
- [x] Add tray/menu actions and diagnostics shortcuts.
- [x] Enforce Electron security hardening defaults.
- [x] Build unsigned NSIS installer.
- [x] Run packaged backend smoke test with bundled Python and FFmpeg binaries.
- [x] Automate packaged smoke test command.
- [ ] Run full Windows 10/11 validation matrix.
- [x] Prepare release/versioning/signing workflow.
- [x] Publish operator docs (install, backup, recovery, troubleshooting).

## Implemented Electron Packaging Details

1. `package.json` now defines the Electron entry point, `electron-builder` Windows NSIS target, and resource inclusion rules.
2. `desktop/main.js` owns the desktop lifecycle:
   1. single-instance lock,
   2. dynamic localhost port allocation,
   3. Python backend spawn,
   4. `/api/status` healthcheck wait,
   5. BrowserWindow load,
   6. diagnostics menu shortcuts,
   7. graceful backend shutdown with Windows process-tree cleanup.
3. `desktop/preload.js` is intentionally tiny; the existing web UI is served by Python and Electron keeps `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.
4. Python now reads runtime paths from `scripts/runtime_paths.py`:
   1. code root: packaged app resources,
   2. data root: Electron user-data directory,
   3. web root: packaged `web/`,
   4. FFmpeg/FFprobe: bundled resources first, then local PATH fallback for development.
5. Mutable files are redirected to app-data:
   1. `config.json`,
   2. `config.ready.json`,
   3. `stream_control.db`,
   4. `logs/`,
   5. `.runtime/`,
   6. `Raw Videos/`,
   7. `Go Live/`,
   8. `playlists/`.
6. First-run migration copies legacy mutable files/folders when `STREAM_LEGACY_ROOT` is set by Electron.
7. Backend `/api/status` now reports `root`, `code_root`, database stats, and runtime binary status so packaging diagnostics are visible through the existing API.

## Definition of Done

1. Installer works on a clean Windows machine without dev tools.
2. Core workflows (`validate`, `normalize`, `start/stop`) behave the same as baseline.
3. No orphan Python or FFmpeg processes after normal exit or crash recovery.
4. User data persists correctly across app updates.
5. Test matrix passes for packaging, resilience, and security.

## Immediate Next Implementation Steps

1. Create `desktop/` Electron scaffold and process supervisor.
2. Wire backend boot + healthcheck + BrowserWindow load.
3. Add resource bundling for Python and FFmpeg.
4. Run first packaged smoke test against one sample channel.
