$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

& (Join-Path $Root "scripts\assert_windows_signing.ps1")
npx electron-builder --win nsis --publish never --config.forceCodeSigning=true
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}