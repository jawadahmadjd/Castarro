import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('204.12.218.50', port=22, username='administrator', password='tjV3M2#)&n', timeout=10)

sftp = ssh.open_sftp()
remote_test_script = "/home/administrator/Downloads/Network Logs/test_remote.py"
test_code = """import urllib.request
import socket
import time

socket.setdefaulttimeout(5.0)

print("1. Testing Ping Probe...")
t0 = time.time()
try:
    req = urllib.request.Request('https://1.1.1.1', headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=3.0) as resp:
        resp.read(10)
    print("  Ping Probe OK! Duration:", round((time.time() - t0)*1000, 2), "ms")
except Exception as e:
    print("  Ping Probe Error:", e)

print("2. Testing Download Probe...")
t0 = time.time()
try:
    req = urllib.request.Request('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js', headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=5.0) as resp:
        data = resp.read()
        print("  Download Probe OK! Bytes:", len(data), "Duration:", round(time.time() - t0, 2), "s")
except Exception as e:
    print("  Download Probe Error:", e)

print("3. Testing Upload Probe (Cloudflare)...")
t0 = time.time()
try:
    ul_payload = b'X' * (500 * 1024)
    req = urllib.request.Request('https://speed.cloudflare.com/__up', data=ul_payload, headers={'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/octet-stream'}, method='POST')
    with urllib.request.urlopen(req, timeout=5.0) as resp:
        resp.read()
        print("  Upload Probe OK! Duration:", round(time.time() - t0, 2), "s")
except Exception as e:
    print("  Upload Probe Error:", e)
"""

with sftp.file(remote_test_script, "w") as f:
    f.write(test_code)

print("Executing test_remote.py on server...")
stdin, stdout, stderr = ssh.exec_command(f'python3 "{remote_test_script}"')
print("OUTPUT:\n", stdout.read().decode())
print("ERR:\n", stderr.read().decode())

sftp.close()
ssh.close()
