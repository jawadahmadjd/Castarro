#!/usr/bin/env python3
"""YouTube Studio Live Control Room Automator for Dual Stream (Shorts).

Automates flipping the 'Dual stream' toggle switch in YouTube Studio
Live Control Room while the broadcast is in the upcoming/scheduled state.
Uses Chrome DevTools Protocol (CDP) with the local Chrome session and
dynamically binds to the correct Chrome Profile for each channel.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.parse
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any


class SimpleWebSocket:
    """Minimal zero-dependency WebSocket client for Chrome DevTools Protocol."""

    def __init__(self, ws_url: str, timeout: float = 10.0):
        parsed = urllib.parse.urlparse(ws_url)
        self.host = parsed.hostname or "127.0.0.1"
        self.port = parsed.port or (443 if parsed.scheme == "wss" else 80)
        self.path = parsed.path or "/"
        if parsed.query:
            self.path += f"?{parsed.query}"
        self.use_ssl = parsed.scheme == "wss"
        self.timeout = timeout
        self.sock: socket.socket | None = None
        self._connect()

    def _connect(self) -> None:
        raw_sock = socket.create_connection((self.host, self.port), timeout=self.timeout)
        if self.use_ssl:
            context = ssl.create_default_context()
            self.sock = context.wrap_socket(raw_sock, server_hostname=self.host)
        else:
            self.sock = raw_sock

        key = "dGhlIHNhbXBsZSBub25jZQ=="
        handshake = (
            f"GET {self.path} HTTP/1.1\r\n"
            f"Host: {self.host}:{self.port}\r\n"
            f"Upgrade: websocket\r\n"
            f"Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            f"Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(handshake.encode("utf-8"))
        resp = self.sock.recv(4096).decode("utf-8", errors="replace")
        if "101 " not in resp and "101\r\n" not in resp:
            raise ConnectionError(f"WebSocket handshake failed: {resp[:100]}")

    def send_command(self, method: str, params: dict[str, Any] | None = None, req_id: int = 1) -> None:
        msg = json.dumps({"id": req_id, "method": method, "params": params or {}})
        payload = msg.encode("utf-8")
        length = len(payload)
        header = bytearray([0x81])
        if length <= 125:
            header.append(0x80 | length)
        elif length <= 65535:
            header.append(0x80 | 126)
            header.extend(length.to_bytes(2, "big"))
        else:
            header.append(0x80 | 127)
            header.extend(length.to_bytes(8, "big"))

        mask = os.urandom(4)
        header.extend(mask)
        masked = bytearray(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(header + masked)

    def _read_exact(self, n: int) -> bytes:
        buf = bytearray()
        while len(buf) < n:
            try:
                chunk = self.sock.recv(n - len(buf))
                if not chunk:
                    break
                buf.extend(chunk)
            except (TimeoutError, socket.timeout):
                break
        return bytes(buf)

    def recv_message(self, target_id: int | None = None, max_messages: int = 40) -> dict[str, Any] | None:
        for _ in range(max_messages):
            head = self._read_exact(2)
            if not head or len(head) < 2:
                continue
            masked = bool(head[1] & 0x80)
            length = head[1] & 0x7F
            if length == 126:
                length = int.from_bytes(self._read_exact(2), "big")
            elif length == 127:
                length = int.from_bytes(self._read_exact(8), "big")

            if masked:
                mask = self._read_exact(4)
                raw_payload = self._read_exact(length)
                data = bytearray(b ^ mask[i % 4] for i, b in enumerate(raw_payload))
            else:
                data = self._read_exact(length)

            try:
                parsed = json.loads(data.decode("utf-8", errors="replace"))
                if target_id is None or parsed.get("id") == target_id:
                    return parsed
            except Exception:
                continue
        return None

    def close(self) -> None:
        if self.sock:
            try:
                self.sock.close()
            except Exception:
                pass
            self.sock = None


def find_chrome_executable() -> str | None:
    candidates = [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ]
    for c in candidates:
        if os.path.isfile(c) and os.access(c, os.X_OK):
            return c
    return shutil.which("google-chrome") or shutil.which("chromium") or shutil.which("chrome")


def get_chrome_user_data_dir() -> Path | None:
    """Return default Chrome User Data directory for the current operating system."""
    if os.name == "nt":
        local_app_data = os.environ.get("LOCALAPPDATA", "")
        if local_app_data:
            p = Path(local_app_data) / "Google" / "Chrome" / "User Data"
            if p.exists():
                return p
    elif sys.platform == "darwin":
        p = Path.home() / "Library" / "Application Support" / "Google" / "Chrome"
        if p.exists():
            return p
    else:
        p = Path.home() / ".config" / "google-chrome"
        if p.exists():
            return p
    return None


def get_available_chrome_profiles(chrome_user_data_dir: str | None = None) -> list[dict[str, Any]]:
    """Scan and list all Chrome profiles from Local State."""
    ud = Path(chrome_user_data_dir) if chrome_user_data_dir else get_chrome_user_data_dir()
    if not ud:
        return []
    ls = ud / "Local State"
    if not ls.exists():
        if (ud / "Default").exists():
            return [{"id": "Default", "name": "Default Profile", "user_name": "", "gaia_name": "", "gaia_id": ""}]
        return []
    try:
        data = json.loads(ls.read_text(encoding="utf-8", errors="replace"))
        cache = data.get("profile", {}).get("info_cache", {})
        profiles = []
        for pid, pdata in cache.items():
            profiles.append({
                "id": pid,
                "name": pdata.get("name", pid),
                "user_name": pdata.get("user_name", ""),
                "gaia_name": pdata.get("gaia_name", ""),
                "gaia_id": pdata.get("gaia_id", ""),
            })
        return profiles
    except Exception as exc:
        print(f"[YOUTUBE STUDIO AUTOMATOR] Failed to read Local State: {exc}")
        return []


def resolve_chrome_profile_for_channel(
    channel_name: str,
    account: dict[str, Any] | None = None,
    profiles: list[dict[str, Any]] | None = None,
    explicit_profile: str | None = None,
) -> tuple[str, str, float]:
    """Resolve the best matching Chrome profile ID for a given Castarro channel.
    
    Returns: (profile_id, match_reason, confidence_score)
    """
    if explicit_profile:
        return explicit_profile, "explicit_binding", 1.0

    if profiles is None:
        profiles = get_available_chrome_profiles()

    if not profiles:
        return "Default", "fallback_no_profiles", 0.0

    account_data = account or {}

    # 1. Exact email match if account has email
    acc_email = str(account_data.get("email") or "").strip().lower()
    if acc_email:
        for p in profiles:
            if str(p.get("user_name", "")).strip().lower() == acc_email:
                return p["id"], f"email_match ({acc_email})", 1.0

    # 2. Match channel title / expected channel name / profile name
    names_to_try = [
        channel_name,
        account_data.get("channel_title", ""),
        account_data.get("expected_channel_name", ""),
        account_data.get("label", ""),
    ]
    names_to_try = [n.strip().lower() for n in names_to_try if n and n.strip()]

    best_p = None
    best_score = 0.0

    for p in profiles:
        p_names = [
            str(p.get("name", "")),
            str(p.get("gaia_name", "")),
            str(p.get("user_name", "")).split("@")[0],
        ]
        p_names = [pn.strip().lower() for pn in p_names if pn and pn.strip()]
        for target in names_to_try:
            for candidate in p_names:
                score = SequenceMatcher(None, target, candidate).ratio()
                if score > best_score:
                    best_score = score
                    best_p = p

    if best_p and best_score >= 0.6:
        return best_p["id"], f"name_match ({best_p.get('name')})", best_score

    return "Default", "fallback_default", best_score


def enable_dual_stream_in_studio(
    studio_url: str,
    *,
    port: int = 9222,
    timeout_seconds: float = 35.0,
    chrome_profile_dir: str | None = None,
    profile_id: str = "Default",
) -> dict[str, Any]:
    """Opens YouTube Studio Live Control Room in pre-live state and flips Dual Stream ON."""
    chrome_bin = find_chrome_executable()
    if not chrome_bin:
        return {"ok": False, "error": "Google Chrome executable not found."}

    src_user_data = Path(chrome_profile_dir) if chrome_profile_dir else get_chrome_user_data_dir()
    if not src_user_data or not src_user_data.exists():
        return {"ok": False, "error": f"Chrome User Data directory not found: {src_user_data}"}

    temp_dir = tempfile.mkdtemp(prefix="castarro_studio_cdp_")
    temp_profile = Path(temp_dir)

    print(f"[YOUTUBE STUDIO AUTOMATOR] Using Chrome Profile: '{profile_id}' from '{src_user_data}'")

    # 1. Copy Local State (holds cookie encryption keys)
    src_local_state = src_user_data / "Local State"
    if src_local_state.exists():
        try:
            shutil.copy2(src_local_state, temp_profile / "Local State")
        except Exception as exc:
            print(f"[YOUTUBE STUDIO AUTOMATOR] Warning: could not copy Local State: {exc}")

    # 2. Copy the targeted profile directory (Default, Profile 1, Profile 4, etc.)
    src_target = src_user_data / profile_id
    dest_target = temp_profile / profile_id
    dest_target.mkdir(parents=True, exist_ok=True)

    if src_target.exists():
        for item in ["Cookies", "Network", "Preferences", "Secure Preferences", "Local Storage", "IndexedDB", "Login Data", "Web Data"]:
            s = src_target / item
            d = dest_target / item
            try:
                if s.is_file():
                    shutil.copy2(s, d)
                elif s.is_dir():
                    shutil.copytree(s, d, dirs_exist_ok=True)
            except Exception as exc:
                pass

    chrome_cmd = [
        chrome_bin,
        "--headless=new",
        f"--remote-debugging-port={port}",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-extensions",
        "--password-store=basic",
        "--window-size=1600,1000",
        f"--user-data-dir={temp_profile}",
        f"--profile-directory={profile_id}",
        "about:blank",
    ]

    proc = None
    try:
        proc = subprocess.Popen(chrome_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(2.0)

        # 3. Connect to CDP list and get the default page
        list_url = f"http://127.0.0.1:{port}/json/list"
        with urllib.request.urlopen(list_url, timeout=10) as resp:
            pages = json.loads(resp.read().decode())

        if not pages:
            return {"ok": False, "error": "No pages returned by Chrome CDP."}

        target_page = next((p for p in pages if p.get("type") == "page"), pages[0])
        ws_url = target_page.get("webSocketDebuggerUrl")
        if not ws_url:
            return {"ok": False, "error": "Failed to get WebSocket Debugger URL from Chrome."}

        ws = SimpleWebSocket(ws_url, timeout=10.0)

        # 4. Navigate to studio_url
        print(f"[YOUTUBE STUDIO AUTOMATOR] Navigating to Control Room: {studio_url}")
        ws.send_command("Page.enable", {}, req_id=1)
        ws.send_command("Page.navigate", {"url": studio_url}, req_id=2)
        time.sleep(7.0)  # 7 seconds wait for Studio initial assets

        # 5. Search DOM (and Shadow DOM) for Stream settings tab and Dual stream toggle
        check_js = """
        (() => {
            function querySelectorAllDeep(selector, root = document) {
                let results = Array.from(root.querySelectorAll(selector));
                const treeWalker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null, false);
                while (treeWalker.nextNode()) {
                    const node = treeWalker.currentNode;
                    if (node.shadowRoot) {
                        results = results.concat(querySelectorAllDeep(selector, node.shadowRoot));
                    }
                }
                return results;
            }

            const tabs = querySelectorAllDeep('tp-yt-paper-tab, ytcp-tab, button, [role="tab"]');
            const settingsTab = tabs.find(t => (t.textContent || '').trim().includes('Stream settings'));
            if (settingsTab) {
                const isSelected = settingsTab.classList.contains('iron-selected') || settingsTab.getAttribute('aria-selected') === 'true';
                if (!isSelected) {
                    settingsTab.click();
                }
            }

            const allToggles = querySelectorAllDeep('tp-yt-paper-toggle-button, ytcp-toggle, [role="switch"], input[type="checkbox"]');
            let dualToggle = allToggles.find(t => {
                const parent = t.closest('.setting-row, .row, ytcp-settings-row, div') || t.parentElement;
                return (parent && (parent.textContent || '').includes('Dual stream')) || (t.getAttribute('aria-label') || '').includes('Dual stream');
            });

            if (!dualToggle) {
                const allElements = querySelectorAllDeep('*');
                const textEl = allElements.find(el => el.children.length === 0 && (el.textContent || '').trim() === 'Dual stream');
                if (textEl) {
                    const row = textEl.closest('.setting-row, .row, div') || textEl.parentElement;
                    if (row) {
                        dualToggle = row.querySelector('tp-yt-paper-toggle-button, ytcp-toggle, [role="switch"], input[type="checkbox"]');
                    }
                }
            }

            if (dualToggle) {
                const isChecked = dualToggle.checked || dualToggle.getAttribute('aria-checked') === 'true' || dualToggle.classList.contains('checked');
                if (!isChecked) {
                    dualToggle.click();
                    return { ready: true, success: true, action: "flipped_on" };
                }
                return { ready: true, success: true, action: "already_on" };
            }

            return {
                ready: false,
                title: document.title,
                url: window.location.href,
                tabCount: tabs.length,
                toggleCount: allToggles.length
            };
        })()
        """

        result_val = {}
        for attempt in range(1, 15):
            req_id = 100 + attempt
            ws.send_command("Runtime.evaluate", {"expression": check_js, "returnByValue": True}, req_id=req_id)
            time.sleep(0.3)
            msg = ws.recv_message(target_id=req_id, max_messages=15)
            if msg and "result" in msg:
                result_val = msg.get("result", {}).get("result", {}).get("value", {})
                print(f"[YOUTUBE STUDIO AUTOMATOR] (Attempt {attempt}) Status: {result_val}")
                if result_val.get("ready"):
                    break
            time.sleep(1.0)

        ws.close()
        print(f"[YOUTUBE STUDIO AUTOMATOR] Final Result: {result_val}")

        return {"ok": True, "profile_used": profile_id, "result": result_val}

    except Exception as exc:
        print(f"[YOUTUBE STUDIO AUTOMATOR] Error: {exc}")
        return {"ok": False, "profile_used": profile_id, "error": str(exc)}
    finally:
        if proc:
            try:
                proc.terminate()
                proc.wait(timeout=3)
            except Exception:
                pass
        shutil.rmtree(temp_profile, ignore_errors=True)


if __name__ == "__main__":
    profiles = get_available_chrome_profiles()
    print("Detected Chrome Profiles:")
    for p in profiles:
        print(f"  [{p['id']}] {p['name']} ({p['user_name']})")

    if len(sys.argv) > 1:
        target_url = sys.argv[1]
        target_profile = sys.argv[2] if len(sys.argv) > 2 else "Default"
    else:
        target_url = "https://studio.youtube.com"
        target_profile = "Default"

    res = enable_dual_stream_in_studio(target_url, profile_id=target_profile)
    print("Final Output:", json.dumps(res, indent=2))
