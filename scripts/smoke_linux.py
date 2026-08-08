#!/usr/bin/env python3
"""
Linux / Ubuntu cross-platform smoke test for Castarro backend & API contracts.
Verifies runtime path resolution, database schema sync, HTTP server lifecycle,
and API endpoint contracts.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

import runtime_paths
import app_db


def test_runtime_paths():
    print("[1/4] Testing runtime paths resolution...")
    runtime_paths.ensure_data_root()
    status = runtime_paths.runtime_binary_status()
    print(f"  Binary status: {json.dumps(status)}")
    assert "ffmpeg" in status
    assert "ffprobe" in status
    print("  Runtime paths check passed.")


def test_database_initialization():
    print("[2/4] Testing database schema initialization...")
    app_db.init_db()
    db_stats = app_db.stats()
    print(f"  Database stats: {json.dumps(db_stats)}")
    print("  Database check passed.")


def test_backend_http_server():
    print("[3/4] Testing Web UI backend HTTP server lifecycle...")
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]

    env = os.environ.copy()
    env["STREAM_UI_PORT"] = str(port)
    env["PYTHONUNBUFFERED"] = "1"

    proc = subprocess.Popen(
        [sys.executable, "-u", str(ROOT / "scripts" / "web_ui.py")],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    try:
        url = f"http://127.0.0.1:{port}/api/health"
        success = False
        for attempt in range(40):
            time.sleep(0.5)
            try:
                with urllib.request.urlopen(url, timeout=2) as resp:
                    if resp.status == 200:
                        data = json.loads(resp.read().decode("utf-8"))
                        print(f"  /api/health response: {data}")
                        success = True
                        break
            except Exception:
                pass

        if not success:
            proc.terminate()
            try:
                stdout_data, stderr_data = proc.communicate(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
                stdout_data, stderr_data = proc.communicate()
            raise RuntimeError(f"Backend server failed to respond on /api/health within 20s.\nSTDOUT:\n{stdout_data}\nSTDERR:\n{stderr_data}")

        # Test config API endpoint
        config_url = f"http://127.0.0.1:{port}/api/config"
        with urllib.request.urlopen(config_url, timeout=10) as resp:
            assert resp.status == 200, f"Expected 200 from /api/config, got {resp.status}"
            cfg = json.loads(resp.read().decode("utf-8"))
            print(f"  /api/config fetched successfully (channels count: {len(cfg.get('channels', []))}).")

    finally:
        print("  Stopping test backend server...")
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        print("  Backend server stopped successfully.")


def test_linux_sandbox_configuration():
    print("[4/4] Testing Linux sandbox & packaging configuration...")
    pkg_path = ROOT / "package.json"
    with open(pkg_path, "r", encoding="utf-8") as f:
        pkg = json.load(f)

    linux_cfg = pkg.get("build", {}).get("linux", {})
    exec_args = linux_cfg.get("executableArgs", [])
    assert "--no-sandbox" in exec_args, "package.json build.linux.executableArgs must contain '--no-sandbox'"

    targets = linux_cfg.get("target", [])
    assert "deb" in targets and "AppImage" in targets, "package.json build.linux.target must include 'deb' and 'AppImage'"

    deb_cfg = pkg.get("build", {}).get("deb", {})
    assert deb_cfg.get("afterInstall") == "scripts/after_install.sh", "package.json build.deb.afterInstall must be 'scripts/after_install.sh'"
    assert (ROOT / "scripts" / "after_install.sh").exists(), "scripts/after_install.sh must exist"

    desktop_cfg = linux_cfg.get("desktop", {})
    assert desktop_cfg.get("StartupWMClass") == "Castarro"
    assert desktop_cfg.get("Type") == "Application"

    main_js_path = ROOT / "desktop" / "main.js"
    main_js = main_js_path.read_text(encoding="utf-8")
    assert 'process.env.ELECTRON_DISABLE_SANDBOX = "1"' in main_js, "desktop/main.js must set ELECTRON_DISABLE_SANDBOX environment variable for Linux"
    assert "--no-sandbox" in main_js, "desktop/main.js must handle --no-sandbox switch"
    assert "app.relaunch" in main_js, "desktop/main.js must include auto-relaunch logic for Linux without --no-sandbox"

    # ---- Dependency regression checks ----
    deb_depends = deb_cfg.get("depends", [])
    deb_depends_str = " ".join(deb_depends)

    # policykit-1 must NOT be in deb.depends (deprecated, breaks on newer Ubuntu)
    assert "policykit-1" not in deb_depends, \
        "REGRESSION: package.json build.deb.depends must NOT list 'policykit-1' (use 'pkexec' instead)"

    # pkexec must be present (the correct replacement)
    assert "pkexec" in deb_depends, \
        "package.json build.deb.depends must list 'pkexec'"

    # Critical runtime dependencies that Electron/Chromium requires
    required_deps = ["python3", "ffmpeg", "pkexec", "libnotify4", "libnss3", "libxss1", "libxtst6", "xdg-utils", "libgbm1"]
    for dep in required_deps:
        assert dep in deb_depends, f"package.json build.deb.depends must list '{dep}'"

    # GTK3 and ALSA with t64 alternatives for Ubuntu 24.04+ compatibility
    assert any("libgtk-3-0" in d for d in deb_depends), \
        "package.json build.deb.depends must list 'libgtk-3-0' (with t64 alternative)"
    assert any("libasound2" in d for d in deb_depends), \
        "package.json build.deb.depends must list 'libasound2' (with t64 alternative)"

    # main.js must NOT reference policykit-1 in user-facing error messages
    # (Internal code like fallback package lists in tryAutoRepairPkexec is fine)
    import re
    user_facing_policykit_refs = re.findall(
        r'(?:message|userMsg)\s*[:=].*policykit-1', main_js
    )
    assert not user_facing_policykit_refs, \
        f"REGRESSION: desktop/main.js must not reference deprecated 'policykit-1' in user-facing messages. Found: {user_facing_policykit_refs}"

    # main.js must have auto-repair logic
    assert "tryAutoRepairPkexec" in main_js, \
        "desktop/main.js must include tryAutoRepairPkexec() auto-repair function"

    # after_install.sh must have dependency verification logic
    after_install = (ROOT / "scripts" / "after_install.sh").read_text(encoding="utf-8")
    assert "ensure_package" in after_install, \
        "scripts/after_install.sh must include ensure_package() dependency verification function"
    assert "pkexec" in after_install, \
        "scripts/after_install.sh must verify/install pkexec"

    print("  Linux sandbox configuration check passed.")
    print("  Dependency regression checks passed.")


def main():
    print("==================================================")
    print("Starting Castarro Linux / Cross-Platform Smoke Test")
    print("==================================================")
    test_runtime_paths()
    test_database_initialization()
    test_backend_http_server()
    test_linux_sandbox_configuration()
    print("\n[SUCCESS] All Linux smoke tests passed cleanly!")


if __name__ == "__main__":
    main()

