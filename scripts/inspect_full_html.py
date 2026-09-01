import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('204.12.218.50', port=22, username='administrator', password='tjV3M2#)&n', timeout=10)

stdin, stdout, stderr = ssh.exec_command('cat "/home/administrator/Downloads/Network Logs/live_network_monitor.html"')
content = stdout.read().decode()
print("=== FILE LENGTH ===", len(content))
lines = content.splitlines()
print("\n--- FIRST 35 LINES ---")
for l in lines[:35]:
    print(l)

print("\n--- LAST 35 LINES ---")
for l in lines[-35:]:
    print(l)

ssh.close()
