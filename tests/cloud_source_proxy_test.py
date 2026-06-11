#!/usr/bin/env python3
"""Smoke-test the local cloud source proxy range behavior."""

from __future__ import annotations

from pathlib import Path
from urllib.request import Request, urlopen
import sys


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from cloud_source_proxy import CloudSourceProxy, file_proxy_asset  # noqa: E402


def main() -> int:
    sample = ROOT / ".runtime" / "cloud-proxy-test.bin"
    sample.parent.mkdir(parents=True, exist_ok=True)
    sample.write_bytes(b"abcdefghijklmnopqrstuvwxyz")

    proxy = CloudSourceProxy(port=0, cache_dir=ROOT / ".runtime" / "cloud-cache-test", retry_wait_seconds=0)
    proxy.start()
    try:
        url = proxy.register_asset(file_proxy_asset("sample", sample))
        request = Request(url, headers={"Range": "bytes=5-9"})
        with urlopen(request, timeout=5) as response:
            payload = response.read()
            assert response.status == 206, response.status
            assert response.headers.get("Accept-Ranges") == "bytes"
            assert response.headers.get("Content-Range") == "bytes 5-9/26"
            assert payload == b"fghij", payload

        with urlopen(url, timeout=5) as response:
            payload = response.read()
            assert response.status == 200, response.status
            assert response.headers.get("Content-Length") == "26"
            assert payload == b"abcdefghijklmnopqrstuvwxyz", payload
    finally:
        proxy.stop()
        sample.unlink(missing_ok=True)

    print("cloud_source_proxy_test: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
