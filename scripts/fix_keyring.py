import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('204.12.218.50', port=22, username='administrator', password='tjV3M2#)&n', timeout=10)

shortcut_path = '/home/administrator/Desktop/Network Dashboard.desktop'
shortcut_content = """[Desktop Entry]
Version=1.0
Type=Application
Name=Network Dashboard
Comment=Open Castarro Live Network Dashboard
Exec=google-chrome --password-store=basic http://localhost:8888/live_network_monitor.html
Icon=google-chrome
Terminal=false
StartupNotify=true
Categories=Network;
"""

sftp = ssh.open_sftp()
with sftp.file(shortcut_path, 'w') as f:
    f.write(shortcut_content)
sftp.close()

ssh.exec_command(f'chmod +x "{shortcut_path}"')
print("Successfully updated Desktop Shortcut with --password-store=basic flag!")
ssh.close()
