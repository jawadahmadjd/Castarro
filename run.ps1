param(
    [ValidateSet("ui", "start", "validate", "normalize", "print-command")]
    [string]$Action = "start",

    [string]$Config = "config.json",
    [string]$Channel = "",
    [switch]$Force,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

if ($Action -eq "validate") {
    $argsList = @("scripts/validate_media.py", "--config", $Config)
    if ($Channel) { $argsList += @("--channel", $Channel) }
    & python @argsList
    exit $LASTEXITCODE
}

if ($Action -eq "ui") {
    & python scripts/web_ui.py
    exit $LASTEXITCODE
}

if ($Action -eq "print-command") {
    $argsList = @("scripts/stream_manager.py", "--config", $Config, "print-command")
    if ($Channel) { $argsList += @("--channel", $Channel) }
    & python @argsList
    exit $LASTEXITCODE
}

if ($Action -eq "normalize") {
    $argsList = @("scripts/normalize_media.py", "--config", $Config)
    if ($Channel) { $argsList += @("--channel", $Channel) }
    if ($Force) { $argsList += "--force" }
    if ($DryRun) { $argsList += "--dry-run" }
    & python @argsList
    exit $LASTEXITCODE
}

$argsList = @("scripts/stream_manager.py", "--config", $Config, "start")
if ($Channel) { $argsList += @("--channel", $Channel) }
& python @argsList
exit $LASTEXITCODE
