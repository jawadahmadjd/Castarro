"""Local HTTP source proxy for provider-backed copy-mode inputs."""

from __future__ import annotations

import mimetypes
import secrets
import threading
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable
from urllib.parse import quote, unquote, urlparse


RangeReader = Callable[[int, int], bytes]


@dataclass(frozen=True)
class ProxyAsset:
    asset_id: str
    size_bytes: int
    content_type: str
    read_range: RangeReader
    display_name: str = ""


class CloudSourceProxy:
    def __init__(
        self,
        *,
        host: str = "127.0.0.1",
        port: int = 8876,
        cache_dir: Path | None = None,
        retry_count: int = 2,
        retry_wait_seconds: float = 0.35,
    ) -> None:
        self.host = host or "127.0.0.1"
        self.port = int(port)
        self.cache_dir = cache_dir
        self.retry_count = max(0, int(retry_count))
        self.retry_wait_seconds = max(0.0, float(retry_wait_seconds))
        self.session_token = secrets.token_urlsafe(18)
        self._assets: dict[str, ProxyAsset] = {}
        self._lock = threading.RLock()
        self._server: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None

    @property
    def is_running(self) -> bool:
        return self._server is not None

    def start(self) -> None:
        if self._server is not None:
            return
        if self.host not in {"127.0.0.1", "localhost"}:
            raise ValueError("Cloud source proxy must bind to localhost.")
        if self.cache_dir is not None:
            self.cache_dir.mkdir(parents=True, exist_ok=True)

        proxy = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802
                proxy._handle_get(self)

            def log_message(self, _fmt: str, *_args: object) -> None:
                return

        self._server = ThreadingHTTPServer((self.host, self.port), Handler)
        self.port = int(self._server.server_address[1])
        self._thread = threading.Thread(target=self._server.serve_forever, name="cloud-source-proxy", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        server = self._server
        if server is not None:
            server.shutdown()
            server.server_close()
        self._server = None
        self._thread = None
        with self._lock:
            self._assets.clear()
        self.session_token = secrets.token_urlsafe(18)

    def register_asset(self, asset: ProxyAsset) -> str:
        if not asset.asset_id:
            raise ValueError("Proxy asset id is required.")
        if asset.size_bytes < 0:
            raise ValueError("Proxy asset size cannot be negative.")
        with self._lock:
            self._assets[asset.asset_id] = asset
        return self.asset_url(asset.asset_id)

    def unregister_asset(self, asset_id: str) -> None:
        with self._lock:
            self._assets.pop(asset_id, None)

    def asset_url(self, asset_id: str) -> str:
        if self._server is None:
            raise RuntimeError("Cloud source proxy is not running.")
        return f"http://{self.host}:{self.port}/assets/{self.session_token}/{quote(asset_id)}"

    def _asset_for_path(self, path: str) -> ProxyAsset | None:
        parts = [unquote(part) for part in path.strip("/").split("/")]
        if len(parts) != 3 or parts[0] != "assets":
            return None
        token, asset_id = parts[1], parts[2]
        if token != self.session_token:
            return None
        with self._lock:
            return self._assets.get(asset_id)

    def _handle_get(self, handler: BaseHTTPRequestHandler) -> None:
        parsed = urlparse(handler.path)
        asset = self._asset_for_path(parsed.path)
        if asset is None:
            self._write_empty(handler, 404)
            return

        try:
            start, end, partial = parse_range_header(handler.headers.get("Range"), asset.size_bytes)
        except ValueError:
            handler.send_response(416)
            handler.send_header("Content-Range", f"bytes */{asset.size_bytes}")
            handler.send_header("Accept-Ranges", "bytes")
            handler.end_headers()
            return

        try:
            data = self._read_with_retry(asset, start, end)
        except Exception:
            self._write_empty(handler, 502)
            return

        expected_length = end - start + 1
        if len(data) != expected_length:
            self._write_empty(handler, 502)
            return

        handler.send_response(206 if partial else 200)
        handler.send_header("Content-Type", asset.content_type or "application/octet-stream")
        handler.send_header("Accept-Ranges", "bytes")
        handler.send_header("Content-Length", str(len(data)))
        if partial:
            handler.send_header("Content-Range", f"bytes {start}-{end}/{asset.size_bytes}")
        handler.send_header("Cache-Control", "no-store")
        handler.end_headers()
        handler.wfile.write(data)

    def _read_with_retry(self, asset: ProxyAsset, start: int, end: int) -> bytes:
        last_error: Exception | None = None
        for attempt in range(self.retry_count + 1):
            try:
                return asset.read_range(start, end)
            except Exception as exc:
                last_error = exc
                if attempt < self.retry_count and self.retry_wait_seconds:
                    time.sleep(self.retry_wait_seconds)
        assert last_error is not None
        raise last_error

    @staticmethod
    def _write_empty(handler: BaseHTTPRequestHandler, status: int) -> None:
        handler.send_response(status)
        handler.send_header("Content-Length", "0")
        handler.send_header("Cache-Control", "no-store")
        handler.end_headers()


def parse_range_header(header: str | None, size_bytes: int) -> tuple[int, int, bool]:
    if size_bytes <= 0:
        return 0, -1, False
    if not header:
        return 0, size_bytes - 1, False
    if not header.startswith("bytes="):
        raise ValueError("Only bytes ranges are supported.")
    spec = header[len("bytes="):].strip()
    if "," in spec:
        raise ValueError("Multiple ranges are not supported.")
    start_text, separator, end_text = spec.partition("-")
    if separator != "-":
        raise ValueError("Invalid range.")
    if start_text == "":
        suffix_length = int(end_text)
        if suffix_length <= 0:
            raise ValueError("Invalid suffix range.")
        start = max(0, size_bytes - suffix_length)
        end = size_bytes - 1
    else:
        start = int(start_text)
        end = int(end_text) if end_text else size_bytes - 1
    if start < 0 or end < start or start >= size_bytes:
        raise ValueError("Range is outside asset bounds.")
    return start, min(end, size_bytes - 1), True


def file_proxy_asset(asset_id: str, path: Path) -> ProxyAsset:
    resolved = path.resolve()
    size = resolved.stat().st_size
    content_type = mimetypes.guess_type(resolved.name)[0] or "application/octet-stream"

    def read_range(start: int, end: int) -> bytes:
        with resolved.open("rb") as handle:
            handle.seek(start)
            return handle.read(max(0, end - start + 1))

    return ProxyAsset(
        asset_id=asset_id,
        size_bytes=size,
        content_type=content_type,
        read_range=read_range,
        display_name=resolved.name,
    )
