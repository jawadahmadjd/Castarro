#!/usr/bin/env python3
import paramiko
import sys
import time
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

ip = '204.12.218.50'
user = 'administrator'
pwd = 'tjV3M2#)&n'

local_script = Path(__file__).parent / "network_watcher.py"

def deploy():
    for attempt in range(1, 4):
        for port in [22, 1097]:
            try:
                print(f"[Attempt {attempt}] Connecting SSH to {ip}:{port}...")
                ssh = paramiko.SSHClient()
                ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                ssh.connect(ip, port=port, username=user, password=pwd, timeout=15)
                print(f"✅ Connected to {ip}:{port}!")
                
                transport = ssh.get_transport()
                if transport:
                    transport.set_keepalive(5)

                remote_dir = "/home/administrator/Downloads/Network Logs"
                ssh.exec_command(f'mkdir -p "{remote_dir}"')
                
                sftp = ssh.open_sftp()
                remote_script = f"{remote_dir}/network_watcher.py"
                sftp.put(str(local_script), remote_script)
                print(f"📤 Uploaded network_watcher.py (v6.0) to {remote_script}")
                sftp.close()

                # Kill existing watchers
                ssh.exec_command('pkill -f network_watcher.py; pkill -f "http.server 8888"')
                time.sleep(1)

                # Start 24/7 Watchdog Supervisor
                print("⚙️ Launching 24/7 Watchdog Daemon Supervisor...")
                watchdog_cmd = f'nohup bash -c \'while true; do python3 "{remote_script}" --daemon; sleep 3; done\' > "{remote_dir}/watcher.log" 2>&1 &'
                ssh.exec_command(watchdog_cmd)
                time.sleep(2)

                # Run immediate speed sample
                stdin, stdout, stderr = ssh.exec_command(f'python3 "{remote_script}" --test-now')
                out = stdout.read().decode()
                print("🚀 Speed sample completed:\n", out)

                ssh.close()
                print("🎉 Deployment of v6.0 High-Performance Engine Complete!")
                return True
            except Exception as e:
                print(f"⚠️ Attempt {attempt} port {port} error: {e}")
                time.sleep(2)
            
    return False

if __name__ == "__main__":
    deploy()
