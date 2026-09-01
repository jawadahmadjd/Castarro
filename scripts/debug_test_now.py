import paramiko
import sys

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('204.12.218.50', port=22, username='administrator', password='tjV3M2#)&n', timeout=10)

print("=== EXECUTING TEST-NOW WITH FULL PYTHON TRACEBACK ===")
stdin, stdout, stderr = ssh.exec_command('python3 -u "/home/administrator/Downloads/Network Logs/network_watcher.py" --test-now')
print("STDOUT:\n", stdout.read().decode())
print("STDERR:\n", stderr.read().decode())

ssh.close()
