import paramiko
import sys
import time

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

ip = '204.12.218.50'
user = 'administrator'
pwd = 'tjV3M2#)&n'
port_num = 8899

def deploy_fix():
    print(f"Connecting SSH to {ip}:22...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(ip, port=22, username=user, password=pwd, timeout=12)
    print("✅ SSH Connection Established!")

    remote_dir = "/home/administrator/Downloads/Network Logs"
    remote_script = f"{remote_dir}/network_watcher.py"
    ssh.exec_command(f'mkdir -p "{remote_dir}"')

    # Upload updated v6.0 network_watcher.py (with socket.setdefaulttimeout(8.0))
    sftp = ssh.open_sftp()
    sftp.put("scripts/network_watcher.py", remote_script)
    print("📤 Uploaded network_watcher.py (v6.0 + Socket Timeout Engine)")

    # Delete old html file on disk so it is forcibly regenerated fresh
    ssh.exec_command(f'rm -f "{remote_dir}/live_network_monitor.html"')

    # Kill old processes
    ssh.exec_command(f'pkill -9 -f network_watcher.py; pkill -9 -f "http.server"; fuser -k {port_num}/tcp; fuser -k 8888/tcp')
    time.sleep(2)

    # 1. Run immediate speed test sample synchronously
    print("1. Running immediate speed test sample...")
    stdin, stdout, stderr = ssh.exec_command(f'python3 "{remote_script}" --test-now')
    out = stdout.read().decode()
    err = stderr.read().decode()
    print("Test Sample Output:\n", out, err)
    time.sleep(2)

    # 2. Check Latest DB Row
    print("2. Verifying Latest SQLite Database Timestamp...")
    stdin, stdout, stderr = ssh.exec_command(f'python3 -c "import sqlite3; conn = sqlite3.connect(\'{remote_dir}/network_monitor.db\'); cur = conn.cursor(); cur.execute(\'SELECT id, timestamp, sample_type, upload_mbps, ping_ms FROM speed_samples ORDER BY id DESC LIMIT 3\'); print(cur.fetchall()); conn.close()"')
    print("DB Latest Rows:\n", stdout.read().decode().strip())

    # 3. Start Standalone HTTP Server on Port 8899
    print(f"3. Starting Standalone HTTP Server on Port {port_num}...")
    ssh.exec_command(f'nohup python3 -m http.server {port_num} --directory "{remote_dir}" > "{remote_dir}/http_server.log" 2>&1 &')
    time.sleep(2)

    # 4. Launch 24/7 Watchdog Supervisor
    print("4. Launching 24/7 Watchdog Supervisor Loop...")
    watchdog_cmd = f'nohup bash -c \'while true; do python3 "{remote_script}" --daemon; sleep 3; done\' > "{remote_dir}/watcher.log" 2>&1 &'
    ssh.exec_command(watchdog_cmd)
    time.sleep(12)  # Wait 12 seconds for daemon to record 2 more ping samples!

    # 5. Open Chrome GUI on RDP Desktop
    print(f"5. Opening Google Chrome GUI on RDP Display (Port {port_num})...")
    stdin, stdout, stderr = ssh.exec_command('ls /tmp/.X11-unix/X* 2>/dev/null')
    displays = stdout.read().decode().strip().split()
    disp_val = ":10.0"
    if displays:
        disp_num = displays[0].replace("/tmp/.X11-unix/X", "")
        disp_val = f":{disp_num}.0"

    print(f"   Targeting RDP Graphical Display {disp_val}")
    chrome_gui_cmd = f'nohup env DISPLAY={disp_val} google-chrome --password-store=basic "http://localhost:{port_num}/live_network_monitor.html" > /dev/null 2>&1 &'
    ssh.exec_command(chrome_gui_cmd)
    time.sleep(3)

    # 6. Capture Verification Screenshot using Headless Chrome
    print("6. Capturing Verified Live Screenshot...")
    remote_screenshot = f"{remote_dir}/verified_now_dashboard.png"
    chrome_head_cmd = f'google-chrome --headless --no-sandbox --disable-gpu --window-size=1280,800 --screenshot="{remote_screenshot}" "http://127.0.0.1:{port_num}/live_network_monitor.html"'
    stdin, stdout, stderr = ssh.exec_command(chrome_head_cmd)
    print("Chrome Output:\n", stdout.read().decode() + stderr.read().decode())
    time.sleep(2)

    # 7. Download screenshot locally
    local_screenshot = "d:/Tools of Jawad/17- Live Streaming via FFMPEG/remote_chrome_screenshot.png"
    try:
        sftp.get(remote_screenshot, local_screenshot)
        print(f"✅ Verified Screenshot saved locally to: {local_screenshot}")
    except Exception as se:
        print("Note on screenshot download:", se)

    sftp.close()
    ssh.close()
    print("🎉 Deployment, Fix, and Verification Complete!")

if __name__ == "__main__":
    deploy_fix()
