#!/usr/bin/env python3
"""Smoke-test backend shutdown API for persistent desktop service mode."""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "web_ui.py"
WEB_ROOT = ROOT / "web"
CODE_ROOT = ROOT


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def get_json(url: str) -> dict:
    with urlopen(url, timeout=2) as response:
        return json.loads(response.read().decode("utf-8"))


def post_json(url: str, payload: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    request = Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Content-Length": str(len(body))},
    )
    with urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def wait_until_ready(base_url: str, timeout_seconds: float = 15.0) -> dict:
    deadline = time.time() + timeout_seconds
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            return get_json(f"{base_url}/api/status")
        except Exception as exc:  # noqa: BLE001 - test utility
            last_error = exc
            time.sleep(0.25)
    raise RuntimeError(f"Backend did not become ready: {last_error}")


def wait_until_stopped(base_url: str, timeout_seconds: float = 15.0) -> None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            get_json(f"{base_url}/api/status")
            time.sleep(0.25)
        except URLError:
            return
        except Exception:
            return
    raise RuntimeError("Backend did not shut down after /api/system/shutdown.")


def main() -> int:
    port = free_port()
    base_url = f"http://127.0.0.1:{port}"
    temp_root = Path(tempfile.mkdtemp(prefix="castarro-backend-test-", dir=str(ROOT)))
    data_root = temp_root / "data"
    data_root.mkdir(parents=True, exist_ok=True)

    env = os.environ.copy()
    env.update(
        {
            "STREAM_UI_PORT": str(port),
            "STREAM_APP_CODE_DIR": str(CODE_ROOT),
            "STREAM_APP_DATA_DIR": str(data_root),
            "STREAM_WEB_ROOT": str(WEB_ROOT),
            "STREAM_DISABLE_AUTO_UPDATE": "1",
        }
    )

    process = subprocess.Popen(
        [os.environ.get("PYTHON", "python"), str(SCRIPT)],
        cwd=str(data_root),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        status = wait_until_ready(base_url)
        assert status.get("root"), "status.root missing"
        assert isinstance(status.get("tasks"), list), "status.tasks missing"

        stop_payload = post_json(f"{base_url}/api/system/shutdown", {"stop_streams": True, "stop_tasks": True})
        assert stop_payload.get("ok") is True, "shutdown response missing ok=true"
        assert stop_payload.get("shutting_down") is True, "shutdown response missing shutting_down=true"

        wait_until_stopped(base_url)

        process.wait(timeout=10)
        if process.returncode not in (0, None):
            output = process.stdout.read() if process.stdout else ""
            raise RuntimeError(f"Backend exited with {process.returncode}\n{output}")
        print("backend_shutdown_test: PASS")
        return 0
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)
        shutil.rmtree(temp_root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
