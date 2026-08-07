#!/bin/bash
set -e

# Ensure executable permissions on Castarro main binary
chmod +x /opt/Castarro/castarro-desktop 2>/dev/null || true

# Create convenient symlinks in system PATH
ln -sf /opt/Castarro/castarro-desktop /usr/bin/castarro-desktop 2>/dev/null || true
ln -sf /opt/Castarro/castarro-desktop /usr/bin/castarro 2>/dev/null || true

# Update desktop application database and MIME registration
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database -q /usr/share/applications 2>/dev/null || true
fi

if command -v update-mime-database >/dev/null 2>&1; then
    update-mime-database /usr/share/mime 2>/dev/null || true
fi
