import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('204.12.218.50', port=22, username='administrator', password='tjV3M2#)&n', timeout=10)

test_cmd = """python3 -c "
import sys
sys.path.insert(0, '/home/administrator/Downloads/Network Logs')
import network_watcher

print('1. Testing resolve_paths()...')
target_dir, db_path, json_path, html_path, csv_path = network_watcher.resolve_paths()
print('  Target dir:', target_dir)
print('  DB path:', db_path)
print('  JSON path:', json_path)

print('2. Testing log_sample()...')
network_watcher.log_sample(150.0, 150.0, 30.0, 'SPEED', 'OK')
print('  log_sample() executed!')

print('3. Querying latest DB row...')
import sqlite3
conn = sqlite3.connect(db_path)
cur = conn.cursor()
cur.execute('SELECT id, timestamp, upload_mbps FROM speed_samples ORDER BY id DESC LIMIT 3')
print('  DB Rows:', cur.fetchall())
conn.close()
"
"""

stdin, stdout, stderr = ssh.exec_command(test_cmd)
print("TEST DIRECT INSERT OUT:\n", stdout.read().decode())
print("TEST DIRECT INSERT ERR:\n", stderr.read().decode())

ssh.close()
