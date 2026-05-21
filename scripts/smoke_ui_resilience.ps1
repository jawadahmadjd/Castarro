param(
    [string]$ExePath = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $ExePath) {
    $ExePath = Join-Path $Root "dist\win-unpacked\Castarro.exe"
}
if (-not (Test-Path -LiteralPath $ExePath)) {
    throw "Packaged app executable not found: $ExePath"
}

$SmokeRoot = Join-Path $Root ".ui-resilience-smoke"
$UserData = Join-Path $SmokeRoot "user-data"
$DataRoot = Join-Path $UserData "data"
$BackendInfoPath = Join-Path $DataRoot "backend-info.json"
$AppDir = Split-Path -Parent $ExePath

function Remove-SmokeRoot {
    if (Test-Path -LiteralPath $SmokeRoot) {
        Remove-Item -LiteralPath $SmokeRoot -Recurse -Force
    }
}

function Get-RunningCastarroProcesses {
    return @(Get-Process -Name "Castarro" -ErrorAction SilentlyContinue)
}

function Assert-NoCastarroRunning {
    $Processes = Get-RunningCastarroProcesses
    if ($Processes.Count -gt 0) {
        $Ids = ($Processes | ForEach-Object { $_.Id }) -join ", "
        throw "Castarro is currently running (PID: $Ids). Close it first, then rerun smoke:resilience."
    }
}

function Stop-ProcessSafe {
    param([System.Diagnostics.Process]$Process)
    if (-not $Process) { return }
    $Processes = Get-Process -Name "Castarro" -ErrorAction SilentlyContinue
    if ($Process.HasExited) { return }
    try {
        Stop-Process -Id $Process.Id -Force
    }
    catch {
        if ($Processes.Count -eq 1 -and $Processes[0].Id -eq $Process.Id) {
            return
        }
        throw
    }
}

function Start-CastarroUi {
    $PrevDisable = $env:STREAM_DISABLE_AUTO_UPDATE
    $PrevUserData = $env:STREAM_DESKTOP_USER_DATA_DIR
    $PrevHeadless = $env:STREAM_HEADLESS_SMOKE
    try {
        $env:STREAM_DISABLE_AUTO_UPDATE = "1"
        $env:STREAM_DESKTOP_USER_DATA_DIR = $UserData
        Remove-Item Env:STREAM_HEADLESS_SMOKE -ErrorAction SilentlyContinue
        return Start-Process -FilePath $ExePath -WorkingDirectory $AppDir -PassThru
    }
    finally {
        if ($null -ne $PrevDisable) { $env:STREAM_DISABLE_AUTO_UPDATE = $PrevDisable } else { Remove-Item Env:STREAM_DISABLE_AUTO_UPDATE -ErrorAction SilentlyContinue }
        if ($null -ne $PrevUserData) { $env:STREAM_DESKTOP_USER_DATA_DIR = $PrevUserData } else { Remove-Item Env:STREAM_DESKTOP_USER_DATA_DIR -ErrorAction SilentlyContinue }
        if ($null -ne $PrevHeadless) { $env:STREAM_HEADLESS_SMOKE = $PrevHeadless } else { Remove-Item Env:STREAM_HEADLESS_SMOKE -ErrorAction SilentlyContinue }
    }
}

function Wait-BackendReady {
    param([int]$TimeoutSeconds = 120)

    $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $Deadline) {
        if (Test-Path -LiteralPath $BackendInfoPath) {
            try {
                $Info = Get-Content -Raw -LiteralPath $BackendInfoPath | ConvertFrom-Json
                $Port = [int]$Info.port
                if ($Port -gt 0) {
                    $Url = "http://127.0.0.1:$Port"
                    $Status = Invoke-RestMethod -Uri "$Url/api/status" -TimeoutSec 1
                    if ($Status.root -and $Status.code_root) {
                        return [pscustomobject]@{
                            Url = $Url
                            Port = $Port
                            Pid = [int]$Info.pid
                        }
                    }
                }
            }
            catch {
                # keep waiting
            }
        }
        Start-Sleep -Milliseconds 500
    }
    throw "Backend did not become ready within $TimeoutSeconds seconds."
}

function Assert-BackendAlive {
    param(
        [string]$Url,
        [int]$TimeoutSeconds = 20
    )
    $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $Deadline) {
        try {
            $Status = Invoke-RestMethod -Uri "$Url/api/status" -TimeoutSec 1
            if ($Status.root -and $Status.code_root) {
                return $true
            }
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }
    return $false
}

function Request-BackendShutdown {
    param([string]$Url)
    $Body = @{ stop_streams = $true; stop_tasks = $true } | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri "$Url/api/system/shutdown" -Method Post -ContentType "application/json" -Body $Body | Out-Null
}

function Wait-BackendStopped {
    param(
        [string]$Url,
        [int]$TimeoutSeconds = 20
    )
    $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $Deadline) {
        try {
            Invoke-RestMethod -Uri "$Url/api/status" -TimeoutSec 1 | Out-Null
            Start-Sleep -Milliseconds 500
        }
        catch {
            return $true
        }
    }
    return $false
}

Assert-NoCastarroRunning
Remove-SmokeRoot
New-Item -ItemType Directory -Force -Path $DataRoot | Out-Null

$Ui1 = $null
$Ui2 = $null
$Succeeded = $false
try {
    Write-Host "Starting UI instance #1"
    $Ui1 = Start-CastarroUi
    $FirstBackend = Wait-BackendReady
    Write-Host "Backend ready on $($FirstBackend.Url) (pid=$($FirstBackend.Pid))"

    Write-Host "Closing UI instance #1 (stream service should keep running)"
    Stop-ProcessSafe -Process $Ui1
    Start-Sleep -Seconds 2

    if (-not (Assert-BackendAlive -Url $FirstBackend.Url -TimeoutSeconds 20)) {
        throw "Backend stopped after UI close. Expected backend to keep running."
    }
    Write-Host "Backend remained alive after UI close"

    Write-Host "Starting UI instance #2 (should reconnect to existing backend)"
    $Ui2 = Start-CastarroUi
    $SecondBackend = Wait-BackendReady
    if ($SecondBackend.Port -ne $FirstBackend.Port) {
        throw "UI did not reconnect to existing backend. Expected port $($FirstBackend.Port), got $($SecondBackend.Port)."
    }
    Write-Host "UI reconnected to the same backend port $($SecondBackend.Port)"

    Write-Host "Requesting backend shutdown via API"
    Request-BackendShutdown -Url $SecondBackend.Url
    if (-not (Wait-BackendStopped -Url $SecondBackend.Url -TimeoutSeconds 20)) {
        throw "Backend did not shut down after /api/system/shutdown."
    }
    Write-Host "Backend shutdown confirmed"
    Write-Host "UI resilience smoke test passed"
    $Succeeded = $true
}
finally {
    Stop-ProcessSafe -Process $Ui1
    Stop-ProcessSafe -Process $Ui2
    if ($Succeeded) {
        Remove-SmokeRoot
    }
    else {
        Write-Warning "Smoke artifacts preserved at: $SmokeRoot"
    }
}
