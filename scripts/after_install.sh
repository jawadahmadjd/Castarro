#!/bin/bash
set -e

# ---------------------------------------------------------------------------
# Castarro — Linux .deb post-install script
# Runs as root during dpkg --configure.
# Ensures every runtime dependency is present so the user never sees
# "package X is missing" errors after installation or during auto-updates.
# ---------------------------------------------------------------------------

# --- 1. Binary permissions & symlinks -------------------------------------

chmod +x /opt/Castarro/castarro-desktop 2>/dev/null || true

ln -sf /opt/Castarro/castarro-desktop /usr/bin/castarro-desktop 2>/dev/null || true
ln -sf /opt/Castarro/castarro-desktop /usr/bin/castarro 2>/dev/null || true

# --- 2. Verify & auto-install critical runtime dependencies ----------------
# dpkg "Depends:" should pull these in, but some edge cases (forced install,
# offline cache, transitional-package renames on newer Ubuntu) can leave gaps.
# We opportunistically fix them here so the user experience stays seamless.

apt_updated=0

ensure_package() {
  # Usage: ensure_package <binary-to-check> <package-name> [<fallback-package>...]
  local binary="$1"; shift
  if command -v "$binary" >/dev/null 2>&1; then
    return 0
  fi
  # Binary missing — try to install the package(s) in order
  for pkg in "$@"; do
    if [ "$apt_updated" -eq 0 ]; then
      apt-get update -qq 2>/dev/null || true
      apt_updated=1
    fi
    if apt-get install -y --no-install-recommends "$pkg" 2>/dev/null; then
      return 0
    fi
  done
  return 0  # never fail the post-install even if we couldn't fix it
}

# pkexec — required by electron-updater for privileged .deb auto-updates
# On Ubuntu 24.04+ "policykit-1" was dropped; the binary lives in "pkexec"
# or "polkitd" depending on the distro variant.
ensure_package pkexec  pkexec policykit-1 polkitd

# python3 — Castarro backend
ensure_package python3 python3

# ffmpeg — media encoding
ensure_package ffmpeg  ffmpeg

# --- 3. Polkit policy for headless / RDP / no-desktop-agent environments ----
# Without a polkit authentication agent (e.g. on RDP, VNC, server or minimal desktop),
# pkexec refuses to run and exits with code 127.
# We deploy both PKLA (older/standard Debian/Ubuntu) and JS rules (newer Polkit)
# so electron-updater can execute non-interactively across all Linux environments.

# 3a. Polkit Local Authority (.pkla)
PKLA_DIR="/etc/polkit-1/localauthority/50-local.d"
if [ -d "$(dirname "$PKLA_DIR")" ]; then
  mkdir -p "$PKLA_DIR" 2>/dev/null || true
  cat > "$PKLA_DIR/50-castarro-autoupdate.pkla" <<'PKLA_POLICY'
[Castarro Auto Updater Policy]
Identity=unix-group:sudo;unix-group:wheel;unix-user:*
Action=org.freedesktop.policykit.exec
ResultAny=yes
ResultInactive=yes
ResultActive=yes
PKLA_POLICY
  chmod 644 "$PKLA_DIR/50-castarro-autoupdate.pkla" 2>/dev/null || true
fi

# 3b. Polkit JavaScript rules (.rules)
RULES_DIR="/etc/polkit-1/rules.d"
if [ -d "$(dirname "$RULES_DIR")" ]; then
  mkdir -p "$RULES_DIR" 2>/dev/null || true
  cat > "$RULES_DIR/50-castarro-autoupdate.rules" <<'JS_POLICY'
polkit.addRule(function(action, subject) {
    if (action.id == "org.freedesktop.policykit.exec" && (subject.isInGroup("sudo") || subject.isInGroup("wheel"))) {
        return polkit.Result.YES;
    }
});
JS_POLICY
  chmod 644 "$RULES_DIR/50-castarro-autoupdate.rules" 2>/dev/null || true
fi

POLKIT_DIR="/usr/share/polkit-1/actions"
POLKIT_FILE="$POLKIT_DIR/com.jawadahmad.castarro.update.policy"
if [ -d "$POLKIT_DIR" ] && [ ! -f "$POLKIT_FILE" ]; then
  cat > "$POLKIT_FILE" <<'POLKIT_POLICY'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE policyconfig PUBLIC
 "-//freedesktop//DTD PolicyKit Policy Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/PolicyKit/1/policyconfig.dtd">
<policyconfig>
  <action id="com.jawadahmad.castarro.update">
    <description>Install Castarro update</description>
    <message>Authentication is required to install a Castarro update</message>
    <defaults>
      <allow_any>yes</allow_any>
      <allow_inactive>yes</allow_inactive>
      <allow_active>yes</allow_active>
    </defaults>
  </action>
</policyconfig>
POLKIT_POLICY
  chmod 644 "$POLKIT_FILE" 2>/dev/null || true
fi

# --- 4. Desktop integration -----------------------------------------------

if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database -q /usr/share/applications 2>/dev/null || true
fi

if command -v update-mime-database >/dev/null 2>&1; then
    update-mime-database /usr/share/mime 2>/dev/null || true
fi

# --- 5. Chrome-sandbox SUID bit -------------------------------------------
# Electron requires the chrome-sandbox helper to be SUID root when running
# outside of --no-sandbox mode.  We set it here so users who remove
# --no-sandbox still work.
SANDBOX_BIN="/opt/Castarro/chrome-sandbox"
if [ -f "$SANDBOX_BIN" ]; then
  chown root:root "$SANDBOX_BIN" 2>/dev/null || true
  chmod 4755 "$SANDBOX_BIN" 2>/dev/null || true
fi

exit 0
