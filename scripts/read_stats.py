import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('204.12.218.50', port=22, username='administrator', password='tjV3M2#)&n', timeout=10)

stdin, stdout, stderr = ssh.exec_command('cat "/home/administrator/Downloads/Network Logs/live_stats.json"')
print("=== REMOTE LIVE STATS JSON ===")
print(stdout.read().decode()[:400])
ssh.close()
