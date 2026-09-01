#!/bin/bash
echo "Starting Castarro Network Watcher 24/7 Daemon..."
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
python3 "$DIR/scripts/network_watcher.py" --daemon
