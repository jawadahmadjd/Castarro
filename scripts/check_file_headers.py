import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('204.12.218.50', port=22, username='administrator', password='tjV3M2#)&n', timeout=10)

print("=== live_network_monitor.html ===")
stdin, stdout, stderr = ssh.exec_command('cat "/home/administrator/Downloads/Network Logs/live_network_monitor.html"')
print(stdout.read().decode()[:400])

print("\n=== live_stats.json ===")
stdin, stdout, stderr = ssh.exec_command('cat "/home/administrator/Downloads/Network Logs/live_stats.json"')
print(stdout.read().decode()[:300])

ssh.close()
