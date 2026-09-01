import paramiko
import sys

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('204.12.218.50', port=22, username='administrator', password='tjV3M2#)&n', timeout=10)

print("=== RUNNING TEST-NOW DIRECTLY ON SERVER ===")
stdin, stdout, stderr = ssh.exec_command('python3 "/home/administrator/Downloads/Network Logs/network_watcher.py" --test-now')
print("STDOUT:", stdout.read().decode())
print("STDERR:", stderr.read().decode())

print("\n=== CHECKING LAST SQLITE SAMPLE AFTER TEST-NOW ===")
stdin, stdout, stderr = ssh.exec_command('python3 -c "import sqlite3; conn = sqlite3.connect(\'/home/administrator/Downloads/Network Logs/network_monitor.db\'); cur = conn.cursor(); cur.execute(\'SELECT id, timestamp, sample_type, upload_mbps, ping_ms, status FROM speed_samples ORDER BY id DESC LIMIT 5\'); print(cur.fetchall()); conn.close()"')
print("SQLITE LATEST:", stdout.read().decode())

ssh.close()
