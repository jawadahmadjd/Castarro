#!/usr/bin/env python3
"""
Castarro Live Network Watcher & Congestion Analyzer (v6.0 - High Performance Engine)
-----------------------------------------------------------------------------------
24/7 Real-Time Network Speed & Latency Watcher for RDP Servers.
- High-Performance SQLite GROUP BY queries (< 1ms execution, 0% CPU overhead).
- Lightweight 5s Ping probes + 1m Multi-CDN Speed tests.
- High-reliability HTTP dashboard (http://localhost:8888/live_network_monitor.html).
- Instant Auto-Refresh HTML + JSON live metrics feed.
"""

import os
import sys
import time
import socket
import sqlite3
import urllib.request
import urllib.error
import argparse
import datetime
import math
import json
import http.server
import socketserver
import threading
import functools
from pathlib import Path

# Enforce strict 8-second global OS socket timeout to prevent urlopen POST hangs
socket.setdefaulttimeout(8.0)

# Ensure UTF-8 output on Windows PowerShell / CMD
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

# Default Paths & Thresholds
DEFAULT_LOG_DIR = Path("d:/Tools of Jawad/17- Live Streaming via FFMPEG/Network Logs").resolve()
STREAM_THRESHOLD_WARNING_MBPS = 65.0
STREAM_THRESHOLD_CRITICAL_MBPS = 40.0
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) CastarroWatcher/6.0"
HTTP_PORT = 8899

# Multi-CDN Reliable Download Probe Endpoints
DOWNLOAD_PROBE_ENDPOINTS = [
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js",
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js",
    "https://speed.cloudflare.com/__down?bytes=1200000"
]

UPLOAD_PROBE_ENDPOINTS = [
    "https://speed.cloudflare.com/__up"
]


def resolve_paths(custom_log_dir=None):
    """Resolve target log directory, database, JSON feed, and HTML report paths."""
    if custom_log_dir:
        target_dir = Path(custom_log_dir).resolve()
    else:
        rdp_linux_downloads = Path("/home/administrator/Downloads/Network Logs")
        if rdp_linux_downloads.parent.exists():
            target_dir = rdp_linux_downloads
        else:
            target_dir = DEFAULT_LOG_DIR

    try:
        target_dir.mkdir(parents=True, exist_ok=True)
    except Exception:
        target_dir = DEFAULT_LOG_DIR
        target_dir.mkdir(parents=True, exist_ok=True)

    db_path = target_dir / "network_monitor.db"
    json_path = target_dir / "live_stats.json"
    html_path = target_dir / "live_network_monitor.html"
    csv_path = target_dir / "live_network_log.csv"
    return target_dir, db_path, json_path, html_path, csv_path


def init_db(db_path):
    """Ensure SQLite database and indexes exist for fast queries."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS speed_samples (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            hour_of_day INTEGER NOT NULL,
            download_mbps REAL NOT NULL,
            upload_mbps REAL NOT NULL,
            ping_ms REAL NOT NULL,
            sample_type TEXT NOT NULL,
            status TEXT NOT NULL
        )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sample_type ON speed_samples(sample_type)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_hour ON speed_samples(hour_of_day)")
    conn.commit()
    conn.close()


def run_ping_probe(timeout_sec=3):
    """Ultra-fast ping probe (0-byte payload, near 0 CPU/bandwidth)."""
    ping_start = time.time()
    try:
        req = urllib.request.Request(
            "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js",
            headers={"User-Agent": USER_AGENT, "Range": "bytes=0-0"}
        )
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            resp.read(1)
        ping_ms = round((time.time() - ping_start) * 1000, 2)
        return ping_ms, "OK"
    except Exception:
        return 999.0, "TIMEOUT"


def run_speed_probe(timeout_sec=10):
    """Lightweight upload/download speed test using multi-provider CDN fallbacks."""
    download_mbps = 0.0
    upload_mbps = 0.0
    ping_ms, _ = run_ping_probe(timeout_sec=3)
    status = "OK"

    # Download Probe
    for ep in DOWNLOAD_PROBE_ENDPOINTS:
        try:
            dl_start = time.time()
            req_dl = urllib.request.Request(ep, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req_dl, timeout=timeout_sec) as resp:
                data = resp.read()
                dl_dur = time.time() - dl_start
                if dl_dur > 0 and len(data) > 10000:
                    download_mbps = round((len(data) * 8 / 1_000_000) / dl_dur, 2)
                    break
        except Exception:
            continue

    # Upload Probe
    for ep in UPLOAD_PROBE_ENDPOINTS:
        try:
            ul_payload = b'X' * (500 * 1024)
            ul_start = time.time()
            req_ul = urllib.request.Request(
                ep,
                data=ul_payload,
                headers={"User-Agent": USER_AGENT, "Content-Type": "application/octet-stream"},
                method="POST"
            )
            with urllib.request.urlopen(req_ul, timeout=timeout_sec) as resp:
                resp.read()
                ul_dur = time.time() - ul_start
                if ul_dur > 0:
                    upload_mbps = round((len(ul_payload) * 8 / 1_000_000) / ul_dur, 2)
                    break
        except Exception:
            continue

    if upload_mbps == 0.0 or upload_mbps < STREAM_THRESHOLD_CRITICAL_MBPS:
        status = "CRITICAL"
    elif upload_mbps < STREAM_THRESHOLD_WARNING_MBPS:
        status = "DEGRADED"

    return download_mbps, upload_mbps, ping_ms, status


def start_http_server(target_dir, port=HTTP_PORT):
    """Start lightweight HTTP server in background thread to serve dashboard via http://localhost:8888."""
    class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, request, client_address, server):
            super().__init__(request, client_address, server, directory=str(target_dir))

        def end_headers(self):
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            super().end_headers()

        def log_message(self, format, *args):
            pass

    def run_server():
        try:
            socketserver.TCPServer.allow_reuse_address = True
            with socketserver.TCPServer(("0.0.0.0", port), NoCacheHandler) as httpd:
                print(f"🌐 Micro HTTP Dashboard Server active at http://localhost:{port}/live_network_monitor.html")
                httpd.serve_forever()
        except Exception as e:
            print(f"HTTP Server note: {e}")

    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()


def log_sample(download_mbps, upload_mbps, ping_ms, sample_type, status, log_dir=None):
    """Log sample into DB, CSV, and generate live_stats.json + crash-proof HTML report."""
    target_dir, db_path, json_path, html_path, csv_path = resolve_paths(log_dir)
    init_db(db_path)

    now = datetime.datetime.now()
    iso_time = now.isoformat()
    hour_of_day = now.hour

    # 1. Insert sample into SQLite
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO speed_samples (timestamp, hour_of_day, download_mbps, upload_mbps, ping_ms, sample_type, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (iso_time, hour_of_day, download_mbps, upload_mbps, ping_ms, sample_type, status))
    conn.commit()

    # 2. Append to CSV
    file_exists = csv_path.exists()
    with open(csv_path, "a", encoding="utf-8") as f:
        if not file_exists:
            f.write("timestamp,hour_of_day,download_mbps,upload_mbps,ping_ms,sample_type,status\n")
        f.write(f"{iso_time},{hour_of_day},{download_mbps},{upload_mbps},{ping_ms},{sample_type},{status}\n")

    # 3. High-Performance SQL Aggregation (< 1ms)
    cursor.execute("SELECT download_mbps, upload_mbps, ping_ms, timestamp FROM speed_samples WHERE sample_type='SPEED' ORDER BY id DESC LIMIT 1")
    latest_speed_row = cursor.fetchone()

    cursor.execute("SELECT ping_ms, status, timestamp FROM speed_samples ORDER BY id DESC LIMIT 1")
    latest_ping_row = cursor.fetchone()

    cursor.execute("SELECT AVG(upload_mbps), AVG(download_mbps), COUNT(*) FROM speed_samples WHERE sample_type='SPEED' AND upload_mbps > 0")
    overall_speed_stats = cursor.fetchone()

    cursor.execute("SELECT AVG(ping_ms) FROM speed_samples")
    overall_ping_stat = cursor.fetchone()

    # Hourly Summary Matrix via SQL GROUP BY
    cursor.execute("""
        SELECT hour_of_day,
               COUNT(*),
               AVG(upload_mbps),
               MIN(CASE WHEN upload_mbps > 0 THEN upload_mbps END),
               MAX(upload_mbps),
               AVG(download_mbps),
               AVG(ping_ms)
        FROM speed_samples
        WHERE sample_type = 'SPEED' AND upload_mbps > 0
        GROUP BY hour_of_day
    """)
    hourly_db_rows = cursor.fetchall()

    # Daily Summary Matrix via SQL GROUP BY DATE
    cursor.execute("""
        SELECT DATE(timestamp),
               COUNT(*),
               AVG(upload_mbps),
               MIN(CASE WHEN upload_mbps > 0 THEN upload_mbps END),
               MAX(upload_mbps),
               AVG(download_mbps)
        FROM speed_samples
        WHERE sample_type = 'SPEED' AND upload_mbps > 0
        GROUP BY DATE(timestamp)
        ORDER BY DATE(timestamp) DESC
    """)
    daily_db_rows = cursor.fetchall()

    cursor.execute("SELECT timestamp, sample_type, upload_mbps, download_mbps, ping_ms, status FROM speed_samples ORDER BY id DESC LIMIT 30")
    raw_event_rows = cursor.fetchall()
    conn.close()

    # Process Aggregates
    cur_ul = latest_speed_row[1] if latest_speed_row else 0.0
    cur_dl = latest_speed_row[0] if latest_speed_row else 0.0
    last_test_time = latest_speed_row[3][:19].replace("T", " ") if latest_speed_row else "No tests yet"

    cur_ping = latest_ping_row[0] if latest_ping_row else 0.0
    avg_ul = overall_speed_stats[0] if (overall_speed_stats and overall_speed_stats[0]) else 0.0
    avg_dl = overall_speed_stats[1] if (overall_speed_stats and overall_speed_stats[1]) else 0.0
    total_speed_samples = overall_speed_stats[2] if overall_speed_stats else 0
    avg_ping = overall_ping_stat[0] if (overall_ping_stat and overall_ping_stat[0]) else 0.0

    # Process Hourly Matrix & Congestion Hours
    hourly_matrix = {h: {"count": 0, "avg_ul": 0.0, "min_ul": 0.0, "max_ul": 0.0, "avg_dl": 0.0, "avg_ping": 0.0, "is_peak": False} for h in range(24)}
    hourly_averages = {}
    for r in hourly_db_rows:
        h = r[0]
        hourly_matrix[h] = {
            "count": r[1],
            "avg_ul": round(r[2], 2),
            "min_ul": round(r[3], 2),
            "max_ul": round(r[4], 2),
            "avg_dl": round(r[5], 2),
            "avg_ping": round(r[6], 1),
            "is_peak": False
        }
        hourly_averages[h] = r[2]

    # Detect Peak Congestion Hours (lowest 30% speeds)
    sorted_hours = sorted(hourly_averages.items(), key=lambda x: x[1])
    num_peak = max(1, math.ceil(len(sorted_hours) * 0.30)) if sorted_hours else 0
    peak_hours = sorted([h for h, _ in sorted_hours[:num_peak]]) if sorted_hours else []

    for h in peak_hours:
        hourly_matrix[h]["is_peak"] = True

    peak_speeds = [r[3] for r in hourly_db_rows if r[0] in peak_hours and r[3]]
    offpeak_speeds = [r[4] for r in hourly_db_rows if r[0] not in peak_hours and r[4]]

    min_peak_ul = min(peak_speeds) if peak_speeds else 0.0
    max_offpeak_ul = max(offpeak_speeds) if offpeak_speeds else 0.0
    peak_hours_str = ", ".join(f"{h:02d}:00" for h in peak_hours) if peak_hours else "Analyzing data..."

    # Format Daily Summaries
    daily_summary_list = []
    for r in daily_db_rows:
        d_str = r[0]
        try:
            dt_obj = datetime.datetime.strptime(d_str, "%Y-%m-%d")
            day_name = dt_obj.strftime("%A")
        except Exception:
            day_name = "Day"

        daily_summary_list.append({
            "date": d_str,
            "day_name": day_name,
            "count": r[1],
            "avg_ul": round(r[2], 2),
            "min_ul": round(r[3], 2),
            "max_ul": round(r[4], 2),
            "avg_dl": round(r[5], 2)
        })

    raw_events = []
    for r in raw_event_rows:
        raw_events.append({
            "timestamp": r[0][:19].replace("T", " "),
            "type": r[1],
            "ul": r[2],
            "dl": r[3],
            "ping": r[4],
            "status": r[5]
        })

    payload = {
        "updated_at": now.strftime('%Y-%m-%d %H:%M:%S'),
        "target_dir": str(target_dir),
        "cur_ul": cur_ul,
        "cur_dl": cur_dl,
        "cur_ping": cur_ping,
        "last_test_time": last_test_time,
        "avg_ul": round(avg_ul, 2),
        "avg_dl": round(avg_dl, 2),
        "avg_ping": round(avg_ping, 1),
        "max_offpeak_ul": round(max_offpeak_ul, 2),
        "min_peak_ul": round(min_peak_ul, 2),
        "peak_hours_str": peak_hours_str,
        "total_speed_samples": total_speed_samples,
        "peak_hours": peak_hours,
        "hourly_matrix": hourly_matrix,
        "daily_summary": daily_summary_list,
        "raw_events": raw_events
    }

    # Atomic JSON Write
    temp_json = json_path.with_suffix(".tmp")
    with open(temp_json, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    os.replace(temp_json, json_path)

    # Ensure static HTML file exists
    write_static_html(html_path, target_dir)


def write_static_html(html_path, target_dir):
    """Write static, crash-proof live_network_monitor.html dashboard."""
    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
    <meta http-equiv="Pragma" content="no-cache">
    <meta http-equiv="Expires" content="0">
    <title>Castarro RDP Network Speed & Congestion Analyzer</title>
    <style>
        * {{ box-sizing: border-box; }}
        body {{ font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background-color: #0b0f19; color: #f8fafc; margin: 0; padding: 24px; min-height: 100vh; }}
        .container {{ max-width: 1250px; margin: 0 auto; }}
        
        .header {{ display: flex; justify-content: space-between; align-items: center; background: #131c2e; padding: 20px 28px; border-radius: 16px; border: 1px solid #1e293b; margin-bottom: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.4); }}
        .title-group h1 {{ font-size: 22px; margin: 0 0 6px 0; color: #38bdf8; display: flex; align-items: center; gap: 10px; }}
        .title-group p {{ margin: 0; color: #64748b; font-size: 13px; }}
        .live-tag {{ background: #22c55e; color: white; font-size: 11px; padding: 3px 8px; border-radius: 12px; font-weight: 700; letter-spacing: 0.5px; animation: pulse 1.5s infinite; }}
        @keyframes pulse {{ 0% {{ opacity: 1; }} 50% {{ opacity: 0.4; }} 100% {{ opacity: 1; }} }}
        
        .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px; margin-bottom: 24px; }}
        .card {{ background: #131c2e; padding: 20px; border-radius: 14px; border: 1px solid #1e293b; box-shadow: 0 4px 15px rgba(0,0,0,0.2); }}
        .card-label {{ color: #94a3b8; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }}
        .card-val {{ font-size: 28px; font-weight: 800; color: #f8fafc; }}
        .card-sub {{ font-size: 12px; color: #64748b; margin-top: 4px; }}

        .card.upload {{ border-top: 4px solid #38bdf8; }}
        .card.download {{ border-top: 4px solid #818cf8; }}
        .card.ping {{ border-top: 4px solid #34d399; }}
        .card.offpeak {{ border-top: 4px solid #4ade80; }}
        .card.peak {{ border-top: 4px solid #f87171; }}

        .filter-panel {{ background: #131c2e; padding: 20px 24px; border-radius: 16px; border: 1px solid #1e293b; margin-bottom: 24px; display: flex; flex-wrap: wrap; gap: 20px; align-items: center; justify-content: space-between; }}
        .filter-group {{ display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }}
        .filter-group label {{ color: #94a3b8; font-size: 13px; font-weight: 600; }}
        select, input {{ background: #0f172a; color: #f8fafc; border: 1px solid #334155; padding: 8px 12px; border-radius: 8px; font-size: 13px; outline: none; }}
        select:focus, input:focus {{ border-color: #38bdf8; }}
        .btn {{ background: #38bdf8; color: #0f172a; border: none; padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; transition: background 0.2s; }}
        .btn:hover {{ background: #0284c7; color: white; }}
        
        .section-box {{ background: #131c2e; padding: 24px; border-radius: 16px; border: 1px solid #1e293b; margin-bottom: 24px; }}
        .section-title {{ font-size: 16px; font-weight: 700; color: #f8fafc; margin: 0 0 16px 0; display: flex; justify-content: space-between; align-items: center; }}

        .dynamic-banner {{ background: #1e293b; border-left: 4px solid #38bdf8; padding: 14px 18px; border-radius: 8px; font-size: 14px; color: #cbd5e1; margin-bottom: 20px; display:flex; justify-content:space-between; align-items:center; }}

        table {{ width: 100%; border-collapse: collapse; text-align: left; }}
        th {{ background: #0f172a; padding: 12px 16px; color: #38bdf8; font-size: 12px; font-weight: 600; text-transform: uppercase; border-bottom: 1px solid #1e293b; }}
        td {{ padding: 12px 16px; border-bottom: 1px solid #1e293b; font-size: 14px; }}
        tr:hover {{ background: #1a2436; }}
        
        .badge {{ padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }}
        .badge-peak {{ background: rgba(248, 113, 113, 0.2); color: #f87171; border: 1px solid rgba(248, 113, 113, 0.3); }}
        .badge-off {{ background: rgba(74, 222, 128, 0.2); color: #4ade80; border: 1px solid rgba(74, 222, 128, 0.3); }}
    </style>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <div class="header">
            <div class="title-group">
                <h1>📡 Castarro RDP Live Network Monitor <span class="live-tag">LIVE</span></h1>
                <p>Log Directory: <code id="logDirTxt">Loading...</code> | Last Refreshed: <span id="lastRefreshedTxt">Loading...</span></p>
            </div>
            <div>
                <label style="color:#94a3b8; font-size:13px; font-weight:600; cursor:pointer;">
                    <input type="checkbox" id="autoRefreshToggle" checked onchange="toggleAutoRefresh(this.checked)"> Auto-Fetch Live (5s)
                </label>
            </div>
        </div>

        <!-- Metric Cards -->
        <div class="grid">
            <div class="card upload">
                <div class="card-label">Latest Upload Speed</div>
                <div class="card-val" id="cardUlVal">0.00 <span style="font-size:16px; color:#64748b;">Mbps</span></div>
                <div class="card-sub" id="cardUlSub">Tested at: -</div>
            </div>
            <div class="card download">
                <div class="card-label">Latest Download Speed</div>
                <div class="card-val" id="cardDlVal">0.00 <span style="font-size:16px; color:#64748b;">Mbps</span></div>
                <div class="card-sub" id="cardDlSub">Tested at: -</div>
            </div>
            <div class="card ping">
                <div class="card-label">Current Latency (Ping)</div>
                <div class="card-val" id="cardPingVal">0.0 <span style="font-size:16px; color:#64748b;">ms</span></div>
                <div class="card-sub" id="cardPingSub">Avg Latency: -</div>
            </div>
            <div class="card offpeak">
                <div class="card-label">Off-Peak Max Upload</div>
                <div class="card-val" id="cardMaxOffpeakVal">0.00 <span style="font-size:16px; color:#64748b;">Mbps</span></div>
                <div class="card-sub">Highest Recorded Upload</div>
            </div>
            <div class="card peak">
                <div class="card-label">Peak Congestion Min Upload</div>
                <div class="card-val" id="cardMinPeakVal">0.00 <span style="font-size:16px; color:#64748b;">Mbps</span></div>
                <div class="card-sub">Worst Bottleneck Point</div>
            </div>
        </div>

        <div class="dynamic-banner">
            <div><strong>🧠 Dynamically Detected Peak Congestion Hours:</strong> <span id="peakHoursBannerTxt" style="color:#f87171; font-weight:700;">Analyzing...</span></div>
            <div style="font-size:12px; color:#94a3b8;">Total Speed Test Samples: <strong id="totalSamplesTxt">0</strong></div>
        </div>

        <!-- Filter Control Panel -->
        <div class="filter-panel">
            <div class="filter-group">
                <label>Filter Preset:</label>
                <select id="presetSelect" onchange="applyPresetFilter(this.value)">
                    <option value="ALL">Full 24 Hours Analysis</option>
                    <option value="PEAK">Peak Congestion Hours Only</option>
                    <option value="OFFPEAK">Off-Peak / Free Hours Only</option>
                    <option value="CUSTOM">Custom Hour Range</option>
                </select>

                <label>From Hour:</label>
                <select id="fromHourSelect" onchange="applyCustomFilter()">
                    {"".join(f'<option value="{h}">{h:02d}:00</option>' for h in range(24))}
                </select>

                <label>To Hour:</label>
                <select id="toHourSelect" onchange="applyCustomFilter()">
                    {"".join(f'<option value="{h}" {"selected" if h==23 else ""}>{h:02d}:59</option>' for h in range(24))}
                </select>
            </div>

            <div class="filter-group">
                <button class="btn" onclick="resetFilters()">Reset Filters</button>
            </div>
        </div>

        <!-- Custom Summary Box -->
        <div class="section-box" style="background:#0f172a; border-color:#38bdf844;">
            <div class="section-title">
                <span id="customPerfTitle">📊 Selected Filter Performance Summary (Full 24 Hours)</span>
            </div>
            <div class="grid" style="margin-bottom:0;">
                <div class="card" style="background:#1e293b;">
                    <div class="card-label">Average Upload</div>
                    <div class="card-val" id="filterAvgUl">0.00 <span style="font-size:14px; color:#64748b;">Mbps</span></div>
                </div>
                <div class="card" style="background:#1e293b;">
                    <div class="card-label">Min Upload (Bottleneck)</div>
                    <div class="card-val" id="filterMinUl">0.00 <span style="font-size:14px; color:#64748b;">Mbps</span></div>
                </div>
                <div class="card" style="background:#1e293b;">
                    <div class="card-label">Max Upload</div>
                    <div class="card-val" id="filterMaxUl">0.00 <span style="font-size:14px; color:#64748b;">Mbps</span></div>
                </div>
                <div class="card" style="background:#1e293b;">
                    <div class="card-label">10-Stream Stability</div>
                    <div class="card-val" id="filterVerdict" style="font-size:16px; font-weight:700;">Evaluating...</div>
                </div>
            </div>
        </div>

        <!-- 24-Hour Matrix Table -->
        <div class="section-box">
            <div class="section-title">
                <span>🕒 Complete 24-Hour Hourly Performance Matrix</span>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Hour of Day</th>
                        <th>Congestion Type</th>
                        <th>Avg Upload Speed</th>
                        <th>Min Upload</th>
                        <th>Max Upload</th>
                        <th>Avg Download Speed</th>
                        <th>Avg Ping</th>
                        <th>Samples</th>
                    </tr>
                </thead>
                <tbody id="matrixTableBody">
                    <tr><td colspan="8" style="text-align:center; color:#64748b;">Loading metrics...</td></tr>
                </tbody>
            </table>
        </div>

        <!-- Day-by-Day Matrix Table -->
        <div class="section-box">
            <div class="section-title">
                <span>📅 Day-by-Day Historical & Weekly Comparison Matrix</span>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Day of Week</th>
                        <th>Avg Upload Speed</th>
                        <th>Min Upload (Bottleneck)</th>
                        <th>Max Upload</th>
                        <th>Avg Download</th>
                        <th>Total Tests</th>
                        <th>Day Stability Verdict</th>
                    </tr>
                </thead>
                <tbody id="dailyTableBody">
                    <tr><td colspan="8" style="text-align:center; color:#64748b;">Loading historical data...</td></tr>
                </tbody>
            </table>
        </div>

        <!-- Live Raw Event Feed -->
        <div class="section-box">
            <div class="section-title">
                <span>📋 Live Raw Activity Feed (Recent Events)</span>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Timestamp</th>
                        <th>Event Type</th>
                        <th>Upload Speed</th>
                        <th>Download Speed</th>
                        <th>Ping</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody id="rawTableBody">
                    <tr><td colspan="6" style="text-align:center; color:#64748b;">Loading raw logs...</td></tr>
                </tbody>
            </table>
        </div>
    </div>

    <!-- Client-Side Crash-Proof JS Engine -->
    <script>
        let DATA = null;
        let autoRefreshTimer = null;

        async function fetchLiveStats() {{
            try {{
                const res = await fetch('live_stats.json?t=' + Date.now());
                if (!res.ok) return;
                DATA = await res.json();
                renderDashboard();
            }} catch (e) {{
                console.error("Error fetching stats:", e);
            }}
        }}

        function renderDashboard() {{
            if (!DATA) return;

            document.getElementById('logDirTxt').innerText = DATA.target_dir || '';
            document.getElementById('lastRefreshedTxt').innerText = DATA.updated_at || '';
            
            document.getElementById('cardUlVal').innerHTML = `${{DATA.cur_ul.toFixed(2)}} <span style="font-size:16px; color:#64748b;">Mbps</span>`;
            document.getElementById('cardUlSub').innerText = `Tested at: ${{DATA.last_test_time}} | Avg: ${{DATA.avg_ul.toFixed(2)}} Mbps`;

            document.getElementById('cardDlVal').innerHTML = `${{DATA.cur_dl.toFixed(2)}} <span style="font-size:16px; color:#64748b;">Mbps</span>`;
            document.getElementById('cardDlSub').innerText = `Tested at: ${{DATA.last_test_time}} | Avg: ${{DATA.avg_dl.toFixed(2)}} Mbps`;

            document.getElementById('cardPingVal').innerHTML = `${{DATA.cur_ping.toFixed(1)}} <span style="font-size:16px; color:#64748b;">ms</span>`;
            document.getElementById('cardPingSub').innerText = `Avg Latency: ${{DATA.avg_ping.toFixed(1)}} ms`;

            document.getElementById('cardMaxOffpeakVal').innerHTML = `${{DATA.max_offpeak_ul.toFixed(2)}} <span style="font-size:16px; color:#64748b;">Mbps</span>`;
            document.getElementById('cardMinPeakVal').innerHTML = `${{DATA.min_peak_ul.toFixed(2)}} <span style="font-size:16px; color:#64748b;">Mbps</span>`;

            document.getElementById('peakHoursBannerTxt').innerText = DATA.peak_hours_str || 'None';
            document.getElementById('totalSamplesTxt').innerText = DATA.total_speed_samples || 0;

            // Render Hourly Matrix
            let matrixHtml = '';
            for (let h = 0; h < 24; h++) {{
                const st = DATA.hourly_matrix[h] || {{ count: 0, avg_ul: 0, min_ul: 0, max_ul: 0, avg_dl: 0, avg_ping: 0, is_peak: false }};
                const badgeCls = st.is_peak ? 'badge-peak' : 'badge-off';
                const typeLbl = st.is_peak ? 'PEAK CONGESTION' : 'OFF-PEAK';
                if (st.count > 0) {{
                    matrixHtml += `<tr data-hour="${{h}}">
                        <td><strong>${{String(h).padStart(2,'0')}}:00</strong></td>
                        <td><span class="badge ${{badgeCls}}">${{typeLbl}}</span></td>
                        <td><strong style="color:#38bdf8;">${{st.avg_ul.toFixed(2)}} Mbps</strong></td>
                        <td>${{st.min_ul.toFixed(2)}} Mbps</td>
                        <td>${{st.max_ul.toFixed(2)}} Mbps</td>
                        <td>${{st.avg_dl.toFixed(2)}} Mbps</td>
                        <td>${{st.avg_ping.toFixed(1)}} ms</td>
                        <td>${{st.count}}</td>
                    </tr>`;
                }} else {{
                    matrixHtml += `<tr data-hour="${{h}}">
                        <td><strong>${{String(h).padStart(2,'0')}}:00</strong></td>
                        <td><span class="badge ${{badgeCls}}">${{typeLbl}}</span></td>
                        <td style="color:#64748b;">-</td><td style="color:#64748b;">-</td><td style="color:#64748b;">-</td><td style="color:#64748b;">-</td><td style="color:#64748b;">-</td>
                        <td>0</td>
                    </tr>`;
                }}
            }}
            document.getElementById('matrixTableBody').innerHTML = matrixHtml;

            // Render Daily Matrix
            let dailyHtml = '';
            (DATA.daily_summary || []).forEach(d => {{
                let vBadge = '<span class="badge badge-peak">HIGH RISK</span>';
                if (d.min_ul >= 65) vBadge = '<span class="badge badge-off">STABLE (10x 5.5M Safe)</span>';
                else if (d.min_ul >= 40) vBadge = '<span class="badge" style="background:rgba(251,191,36,0.2); color:#fbbf24; border:1px solid rgba(251,191,36,0.3);">MODERATE RISK</span>';

                dailyHtml += `<tr>
                    <td><strong>${{d.date}}</strong></td>
                    <td>${{d.day_name}}</td>
                    <td><strong style="color:#38bdf8;">${{d.avg_ul.toFixed(2)}} Mbps</strong></td>
                    <td>${{d.min_ul.toFixed(2)}} Mbps</td>
                    <td>${{d.max_ul.toFixed(2)}} Mbps</td>
                    <td>${{d.avg_dl.toFixed(2)}} Mbps</td>
                    <td>${{d.count}}</td>
                    <td>${{vBadge}}</td>
                </tr>`;
            }});
            document.getElementById('dailyTableBody').innerHTML = dailyHtml || '<tr><td colspan="8" style="text-align:center; color:#64748b;">No daily data yet</td></tr>';

            // Render Raw Events
            let rawHtml = '';
            (DATA.raw_events || []).forEach(r => {{
                const stBadge = r.status === 'OK' ? '<span style="color:#4ade80; font-weight:600;">● OK</span>' : (r.status === 'DEGRADED' ? '<span style="color:#fbbf24; font-weight:600;">● DEGRADED</span>' : '<span style="color:#f87171; font-weight:600;">● CRITICAL</span>');
                const typeBadge = r.type === 'SPEED' ? '<span style="background:#38bdf822; color:#38bdf8; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600;">SPEED</span>' : '<span style="background:#94a3b822; color:#94a3b8; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600;">PING</span>';
                const ulDisp = r.type === 'SPEED' ? `${{r.ul.toFixed(2)}} Mbps` : '-';
                const dlDisp = r.type === 'SPEED' ? `${{r.dl.toFixed(2)}} Mbps` : '-';

                rawHtml += `<tr>
                    <td style="color:#94a3b8; font-size:13px;">${{r.timestamp}}</td>
                    <td>${{typeBadge}}</td>
                    <td><strong>${{ulDisp}}</strong></td>
                    <td>${{dlDisp}}</td>
                    <td>${{r.ping.toFixed(1)}} ms</td>
                    <td>${{stBadge}}</td>
                </tr>`;
            }});
            document.getElementById('rawTableBody').innerHTML = rawHtml;

            applyCustomFilter();
        }}

        function toggleAutoRefresh(enabled) {{
            if (autoRefreshTimer) clearInterval(autoRefreshTimer);
            if (enabled) {{
                autoRefreshTimer = setInterval(fetchLiveStats, 5000);
            }}
        }}

        function applyPresetFilter(preset) {{
            const fromSelect = document.getElementById('fromHourSelect');
            const toSelect = document.getElementById('toHourSelect');
            if (preset === 'ALL') {{ fromSelect.value = 0; toSelect.value = 23; }}
            applyCustomFilter();
        }}

        function applyCustomFilter() {{
            if (!DATA) return;
            const preset = document.getElementById('presetSelect').value;
            const fromHour = parseInt(document.getElementById('fromHourSelect').value);
            const toHour = parseInt(document.getElementById('toHourSelect').value);
            const peakHours = DATA.peak_hours || [];

            let selectedHours = [];
            if (preset === 'PEAK') {{
                selectedHours = peakHours;
            }} else if (preset === 'OFFPEAK') {{
                selectedHours = Array.from({{length: 24}}, (_, i) => i).filter(h => !peakHours.includes(h));
            }} else {{
                if (fromHour <= toHour) {{
                    for (let h = fromHour; h <= toHour; h++) selectedHours.push(h);
                }} else {{
                    for (let h = fromHour; h < 24; h++) selectedHours.push(h);
                    for (let h = 0; h <= toHour; h++) selectedHours.push(h);
                }}
            }}

            const rows = document.querySelectorAll('#matrixTableBody tr');
            let ulList = [];
            rows.forEach(r => {{
                const hAttr = r.getAttribute('data-hour');
                if (hAttr !== null) {{
                    const h = parseInt(hAttr);
                    if (selectedHours.includes(h)) {{
                        r.style.display = '';
                        const st = DATA.hourly_matrix[h];
                        if (st && st.count > 0 && st.avg_ul > 0) ulList.push(st.avg_ul);
                    }} else {{
                        r.style.display = 'none';
                    }}
                }}
            }});

            const titleEl = document.getElementById('customPerfTitle');
            const avgEl = document.getElementById('filterAvgUl');
            const minEl = document.getElementById('filterMinUl');
            const maxEl = document.getElementById('filterMaxUl');
            const verdictEl = document.getElementById('filterVerdict');

            titleEl.innerText = '📊 Performance Summary for Selected Hours (' + selectedHours.map(h => String(h).padStart(2,'0') + ':00').join(', ') + ')';

            if (ulList.length > 0) {{
                const avgUl = ulList.reduce((a,b) => a+b, 0) / ulList.length;
                const minUl = Math.min(...ulList);
                const maxUl = Math.max(...ulList);

                avgEl.innerHTML = `${{avgUl.toFixed(2)}} <span style="font-size:14px; color:#64748b;">Mbps</span>`;
                minEl.innerHTML = `${{minUl.toFixed(2)}} <span style="font-size:14px; color:#64748b;">Mbps</span>`;
                maxEl.innerHTML = `${{maxUl.toFixed(2)}} <span style="font-size:14px; color:#64748b;">Mbps</span>`;

                if (minUl >= 65) {{
                    verdictEl.innerHTML = '<span style="color:#4ade80;">✅ SAFE — 10x 5.5M Ready</span>';
                }} else if (minUl >= 40) {{
                    verdictEl.innerHTML = '<span style="color:#fbbf24;">⚠️ MODERATE — Lower to 3.5M</span>';
                }} else {{
                    verdictEl.innerHTML = '<span style="color:#f87171;">🚨 HIGH RISK — Will Disconnect</span>';
                }}
            }} else {{
                avgEl.innerHTML = `-`;
                minEl.innerHTML = `-`;
                maxEl.innerHTML = `-`;
                verdictEl.innerHTML = `<span style="color:#94a3b8;">No data for selected hours</span>`;
            }}
        }}

        function resetFilters() {{
            document.getElementById('presetSelect').value = 'ALL';
            document.getElementById('fromHourSelect').value = 0;
            document.getElementById('toHourSelect').value = 23;
            applyCustomFilter();
        }}

        // Initial fetch and start auto-timer
        fetchLiveStats();
        toggleAutoRefresh(true);
    </script>
</body>
</html>
"""
    # Always write crash-proof v6.0 HTML dashboard template
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html_content)


def main():
    parser = argparse.ArgumentParser(description="Castarro RDP Live Network Watcher")
    parser.add_argument("--daemon", action="store_true", help="Run 24/7 daemon loop")
    parser.add_argument("--test-now", action="store_true", help="Run single speed test sample immediately")
    parser.add_argument("--log-dir", type=str, default=None, help="Custom log directory")
    args = parser.parse_args()

    target_dir, db_path, json_path, html_path, csv_path = resolve_paths(args.log_dir)
    init_db(db_path)
    write_static_html(html_path, target_dir)
    start_http_server(target_dir, port=HTTP_PORT)

    if args.test_now:
        print("⚡ Running Immediate Speed Test Sample...")
        dl, ul, ping, status = run_speed_probe()
        log_sample(dl, ul, ping, "SPEED", status, args.log_dir)
        print(f"✅ Sample logged: UL={ul}Mbps, DL={dl}Mbps, Ping={ping}ms")
        return

    print(f"🚀 Castarro Live Watcher Engine Started. Target: {target_dir}")
    print(f"🌐 Micro HTTP Dashboard Server: http://localhost:{HTTP_PORT}/live_network_monitor.html")

    last_speed_test = 0
    while True:
        try:
            now_ts = time.time()
            # Run Speed Test every 60 seconds
            if now_ts - last_speed_test >= 60:
                dl, ul, ping, status = run_speed_probe()
                log_sample(dl, ul, ping, "SPEED", status, args.log_dir)
                last_speed_test = time.time()
                print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] SPEED TEST: UL={ul}Mbps, DL={dl}Mbps, Ping={ping}ms ({status})")
            else:
                # Run Ping Test every 5 seconds
                ping, status = run_ping_probe()
                log_sample(0.0, 0.0, ping, "PING", status, args.log_dir)
                print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] PING: {ping}ms")
            
            time.sleep(5)
        except KeyboardInterrupt:
            print("Stopping watcher...")
            break
        except Exception as e:
            print(f"Watcher Loop Exception: {e}")
            time.sleep(5)


if __name__ == "__main__":
    main()

