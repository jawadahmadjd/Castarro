import paramiko
import time

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('204.12.218.50', port=22, username='administrator', password='tjV3M2#)&n', timeout=10)

print("1. Killing stale port 8888 listener (PID 2499400)...")
ssh.exec_command('fuser -k 8888/tcp; pkill -9 -f network_watcher; pkill -9 -f http.server')
time.sleep(2)

remote_dir = "/home/administrator/Downloads/Network Logs"
remote_script = f"{remote_dir}/network_watcher.py"

print("2. Generating fresh HTML and JSON...")
stdin, stdout, stderr = ssh.exec_command(f'python3 "{remote_script}" --test-now')
print(stdout.read().decode())
time.sleep(2)

print("3. Starting 24/7 Watchdog Supervisor...")
watchdog_cmd = f'nohup bash -c \'while true; do python3 "{remote_script}" --daemon; sleep 3; done\' > "{remote_dir}/watcher.log" 2>&1 &'
ssh.exec_command(watchdog_cmd)
time.sleep(4)

print("4. Executing Headless Chrome screenshot...")
chrome_cmd = f'google-chrome --headless --no-sandbox --disable-gpu --window-size=1280,800 --screenshot=/home/administrator/Downloads/v6_fixed_screenshot.png http://127.0.0.1:8888/live_network_monitor.html'
stdin, stdout, stderr = ssh.exec_command(chrome_cmd)
print("Chrome Output:\n", stdout.read().decode(), stderr.read().decode())

time.sleep(2)
sftp = ssh.open_sftp()
sftp.get('/home/administrator/Downloads/v6_fixed_screenshot.png', 'd:/Tools of Jawad/17- Live Streaming via FFMPEG/remote_chrome_screenshot.png')
sftp.close()
ssh.close()
print("🎉 Port 8888 cleared and fresh screenshot downloaded successfully!")
