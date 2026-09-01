@echo off
TITLE Castarro Network Watcher 24/7
echo Starting Castarro Network Watcher 24/7 Daemon...
python "%~dp0scripts\network_watcher.py" --daemon
pause
