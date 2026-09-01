import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('204.12.218.50', port=22, username='administrator', password='tjV3M2#)&n', timeout=10)

print("=== REMOTE FILE PERMISSIONS ===")
stdin, stdout, stderr = ssh.exec_command('ls -la "/home/administrator/Downloads/Network Logs"')
print(stdout.read().decode())
ssh.close()
