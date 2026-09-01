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

def diagnose_and_fix():
    print(f"Connecting SSH to {ip}:22...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(ip, port=22, username=user, password=pwd, timeout=12)
    print("✅ SSH Connection Established!")

    remote_dir = "/home/administrator/Downloads/Network Logs"
    remote_script = f"{remote_dir}/network_watcher.py"
    ssh.exec_command(f'mkdir -p "{remote_dir}"')

    # Upload fresh v6.0 network_watcher.py
    sftp = ssh.open_sftp()
    local_script = "scripts/network_watcher.py"
    sftp.put(local_script, remote_script)
    print("MB Uploaded network_watcher.py v6.0")

    # Update Desktop Shortcut to Port 8899
    shortcut_path = "/home/administrator/Desktop/Network Dashboard.desktop"
    shortcut_content = f"""[Desktop Entry]
Version=1.0
Type=Application
Name=Network Dashboard
Comment=Open Castarro Live Network Dashboard
Exec=google-chrome --password-store=basic http://localhost:{port_num}/live_network_monitor.html
Icon=google-chrome
Terminal=false
StartupNotify=true
Categories=Network;
"""
    with sftp.file(shortcut_path, "w") as f:
        f.write(shortcut_content)
    ssh.exec_command(f'chmod +x "{shortcut_path}"')
    print(f"🖥️ Updated Desktop Shortcut to http://localhost:{port_num}/live_network_monitor.html")

    # Kill any old instances
    ssh.exec_command(f'pkill -9 -f network_watcher.py; pkill -9 -f "http.server {port_num}"; fuser -k {port_num}/tcp')
    time.sleep(2)

    # 1. Run immediate speed sample
    print("1. Running immediate speed sample...")
    stdin, stdout, stderr = ssh.exec_command(f'python3 "{remote_script}" --test-now')
    print("Test Sample Output:\n", stdout.read().decode())
    time.sleep(2)

    # 2. Launch Standalone HTTP Server on Port 8899
    print(f"2. Starting Standalone HTTP Web Server on Port {port_num}...")
    ssh.exec_command(f'nohup python3 -m http.server {port_num} --directory "{remote_dir}" > "{remote_dir}/http_server.log" 2>&1 &')
    time.sleep(2)

    # 3. Launch 24/7 Watchdog Supervisor
    print("3. Launching 24/7 Watchdog Daemon Supervisor...")
    watchdog_cmd = f'nohup bash -c \'while true; do python3 "{remote_script}" --daemon; sleep 3; done\' > "{remote_dir}/watcher.log" 2>&1 &'
    ssh.exec_command(watchdog_cmd)
    time.sleep(3)

    # 4. Open Google Chrome inside active RDP GUI display session on Port 8899
    print(f"4. Opening Google Chrome in RDP Desktop session (Port {port_num})...")
    stdin, stdout, stderr = ssh.exec_command('ls /tmp/.X11-unix/X* 2>/dev/null')
    displays = stdout.read().decode().strip().split()
    disp_val = ":10.0"
    if displays:
        disp_num = displays[0].replace("/tmp/.X11-unix/X", "")
        disp_val = f":{disp_num}.0"

    print(f"   Targeting RDP Graphical Display {disp_val}")
    chrome_gui_cmd = f'nohup env DISPLAY={disp_val} google-chrome --password-store=basic "http://localhost:{port_num}/live_network_monitor.html" > /dev/null 2>&1 &'
    ssh.exec_command(chrome_gui_cmd)
    time.sleep(2)

    # 5. Capture Verification Screenshot using Headless Chrome on Port 8899
    print("5. Capturing Headless Chrome verification screenshot...")
    remote_screenshot = f"{remote_dir}/port8899_live_dashboard.png"
    chrome_head_cmd = f'google-chrome --headless --no-sandbox --disable-gpu --window-size=1280,800 --screenshot="{remote_screenshot}" "http://127.0.0.1:{port_num}/live_network_monitor.html"'
    stdin, stdout, stderr = ssh.exec_command(chrome_head_cmd)
    print("Chrome Screenshot Output:\n", stdout.read().decode() + stderr.read().decode())
    time.sleep(2)

    # 6. Download screenshot to local machine
    local_screenshot = "d:/Tools of Jawad/17- Live Streaming via FFMPEG/remote_chrome_screenshot.png"
    try:
        sftp.get(remote_screenshot, local_screenshot)
        print(f"✅ Verified Screenshot downloaded locally to: {local_screenshot}")
    except Exception as se:
        print("Note on screenshot download:", se)

    sftp.close()
    ssh.close()
    print("🎉 All steps completed successfully on Port 8899!")

if __name__ == "__main__":
    diagnose_and_fix()
