param(
    [string]$InstallerPath = "",
    [switch]$ElevatedRelaunch,
    [string]$SmokeLogPath = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$TranscriptStarted = $false
if ($SmokeLogPath) {
    try {
        $SmokeLogDir = Split-Path -Parent $SmokeLogPath
        if ($SmokeLogDir) {
            New-Item -ItemType Directory -Force -Path $SmokeLogDir | Out-Null
        }
        Start-Transcript -Path $SmokeLogPath -Force | Out-Null
        $TranscriptStarted = $true
        Write-Host "Installer smoke log: $SmokeLogPath"
    }
    catch {
        Write-Warning "Could not start installer smoke transcript at $SmokeLogPath. $($_.Exception.Message)"
    }
}

trap {
    if ($TranscriptStarted) {
        try { Stop-Transcript | Out-Null } catch {}
    }
    break
}

$Package = Get-Content -Raw -LiteralPath (Join-Path $Root "package.json") | ConvertFrom-Json
$ProductName = [string]$Package.build.productName
if (-not $InstallerPath) {
    $InstallerPath = Join-Path $Root "dist\$ProductName-Setup-$($Package.version).exe"
}
if (-not (Test-Path -LiteralPath $InstallerPath)) {
    throw "Installer not found: $InstallerPath"
}

function Test-IsAdministrator {
    try {
        $Identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
        $Principal = [System.Security.Principal.WindowsPrincipal]::new($Identity)
        return $Principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
    }
    catch {
        return $false
    }
}

function Assert-NoRunningCastarro {
    $Running = @(Get-Process -Name "Castarro" -ErrorAction SilentlyContinue)
    if ($Running.Count -gt 0) {
        $Ids = ($Running | ForEach-Object { $_.Id }) -join ", "
        throw "Castarro is currently running (PID: $Ids). Stop active streams and close Castarro before running installer smoke."
    }
}

Assert-NoRunningCastarro

if (-not (Test-IsAdministrator)) {
    if ($ElevatedRelaunch) {
        throw "Installer smoke requires administrator privileges. Elevation was requested but was not granted."
    }
    Write-Host "Installer smoke requires administrator privileges. Requesting UAC elevation..."
    if (-not $SmokeLogPath) {
        $PreferredLogBase = if ($env:CASTARRO_INSTALLER_SMOKE_ROOT) { $env:CASTARRO_INSTALLER_SMOKE_ROOT } else { "C:\tmp" }
        try {
            New-Item -ItemType Directory -Force -Path $PreferredLogBase | Out-Null
        }
        catch {
            $PreferredLogBase = [System.IO.Path]::GetTempPath()
        }
        $SmokeLogPath = Join-Path $PreferredLogBase "castarro-installer-smoke-elevated.log"
    }
    Remove-Item -LiteralPath $SmokeLogPath -Force -ErrorAction SilentlyContinue
    $ArgumentString = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -ElevatedRelaunch"
    if ($InstallerPath) {
        $ArgumentString += " -InstallerPath `"$InstallerPath`""
    }
    $ArgumentString += " -SmokeLogPath `"$SmokeLogPath`""
    try {
        $ElevatedProcess = Start-Process `
            -FilePath "powershell.exe" `
            -ArgumentList $ArgumentString `
            -Verb RunAs `
            -WorkingDirectory $Root `
            -PassThru `
            -Wait
    }
    catch {
        throw "Installer smoke requires elevation and could not start elevated. Run PowerShell as Administrator and retry. Original error: $($_.Exception.Message)"
    }
    if ($ElevatedProcess.ExitCode -ne 0) {
        if (Test-Path -LiteralPath $SmokeLogPath) {
            Write-Host ""
            Write-Host "Elevated installer smoke log:"
            Write-Host "----------------------------------------"
            Write-Host (Get-Content -Raw -LiteralPath $SmokeLogPath)
            Write-Host "----------------------------------------"
        }
        throw "Elevated installer smoke failed with exit code $($ElevatedProcess.ExitCode). Log: $SmokeLogPath"
    }
    exit 0
}

function Remove-SmokeTree {
    param([string]$Path)

    $FullPath = [System.IO.Path]::GetFullPath($Path)
    if ((Split-Path -Leaf $FullPath) -ne $SmokeRootName) {
        throw "Refusing to remove non-smoke directory: $FullPath"
    }
    if ($FullPath.Length -lt 10) {
        throw "Refusing to remove suspiciously short path: $FullPath"
    }
    for ($Attempt = 1; $Attempt -le 6; $Attempt++) {
        try {
            if (Test-Path -LiteralPath $FullPath) {
                Remove-Item -LiteralPath $FullPath -Recurse -Force
            }
            return
        }
        catch {
            if ($Attempt -eq 6) {
                throw
            }
            Start-Sleep -Milliseconds (250 * $Attempt)
        }
    }
}

function Test-WritableDirectory {
    param([string]$Path)

    if (-not $Path) {
        return $false
    }
    try {
        New-Item -ItemType Directory -Force -Path $Path | Out-Null
    }
    catch {
        return $false
    }
    if (-not (Test-Path -LiteralPath $Path)) {
        return $false
    }
    $Probe = Join-Path $Path ".castarro-write-probe"
    try {
        New-Item -ItemType Directory -Force -Path $Probe | Out-Null
        Remove-Item -LiteralPath $Probe -Recurse -Force
        return $true
    }
    catch {
        return $false
    }
}

function Test-PathContainsWhitespace {
    param([string]$Path)
    return [bool]($Path -match "\s")
}

$SmokeRootName = "castarro-installer-smoke"
$SmokeBase = $null
if ($env:CASTARRO_INSTALLER_SMOKE_ROOT) {
    $SmokeBase = $env:CASTARRO_INSTALLER_SMOKE_ROOT
    if (Test-PathContainsWhitespace -Path $SmokeBase) {
        throw "Installer smoke base path cannot contain spaces for NSIS /D reliability. Current value: $SmokeBase"
    }
    if (-not (Test-WritableDirectory -Path $SmokeBase)) {
        throw "Installer smoke base path is not writable: $SmokeBase"
    }
}
else {
    $Candidates = @(
        "C:\tmp",
        $env:RUNNER_TEMP
    ) | Where-Object { $_ -and -not (Test-PathContainsWhitespace -Path $_) }
    foreach ($Candidate in $Candidates) {
        if (Test-WritableDirectory -Path $Candidate) {
            $SmokeBase = $Candidate
            break
        }
    }
    if (-not $SmokeBase) {
        throw "No writable no-space base path found for installer smoke. Set CASTARRO_INSTALLER_SMOKE_ROOT to a path like C:\tmp."
    }
}

$SmokeRoot = Join-Path $SmokeBase $SmokeRootName
$InstallDir = Join-Path $SmokeRoot "Programs\$ProductName"
$UserData = Join-Path $SmokeRoot "user-data"
$InstalledExe = Join-Path $InstallDir "$ProductName.exe"

function Invoke-ProcessChecked {
    param(
        [string]$FilePath,
        [string]$Arguments,
        [string]$WorkingDirectory = $Root,
        [hashtable]$Environment = @{},
        [int]$TimeoutSeconds = 120
    )

    $StartInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $StartInfo.FileName = $FilePath
    $StartInfo.Arguments = $Arguments
    $StartInfo.WorkingDirectory = $WorkingDirectory
    $StartInfo.UseShellExecute = $false
    $StartInfo.CreateNoWindow = $true
    $StartInfo.RedirectStandardOutput = $true
    $StartInfo.RedirectStandardError = $true
    $StartInfo.Environment.Remove("ELECTRON_RUN_AS_NODE") | Out-Null
    foreach ($Key in $Environment.Keys) {
        $StartInfo.Environment[$Key] = [string]$Environment[$Key]
    }

    $Process = [System.Diagnostics.Process]::new()
    $Process.StartInfo = $StartInfo
    $Process.Start() | Out-Null
    $OutTask = $Process.StandardOutput.ReadToEndAsync()
    $ErrTask = $Process.StandardError.ReadToEndAsync()
    if (-not $Process.WaitForExit($TimeoutSeconds * 1000)) {
        try { $Process.Kill() } catch {}
        try { $Process.WaitForExit() } catch {}
        throw "Process timed out: $FilePath $Arguments"
    }
    $StdOut = ($OutTask.Result | Out-String).Trim()
    $StdErr = ($ErrTask.Result | Out-String).Trim()
    if ($Process.ExitCode -ne 0) {
        $Message = "Process failed with exit code $($Process.ExitCode): $FilePath $Arguments"
        if ($StdOut) {
            $Message += "`nstdout:`n$StdOut"
        }
        if ($StdErr) {
            $Message += "`nstderr:`n$StdErr"
        }
        throw $Message
    }
}

function Get-ShortcutInfo {
    param([string]$Path)

    $Shell = New-Object -ComObject WScript.Shell
    $Shortcut = $Shell.CreateShortcut($Path)
    [pscustomobject]@{
        Path = $Path
        TargetPath = $Shortcut.TargetPath
    }
}

function Find-ProductShortcut {
    param([string[]]$Roots)

    foreach ($ShortcutRoot in $Roots) {
        if (-not $ShortcutRoot -or -not (Test-Path -LiteralPath $ShortcutRoot)) {
            continue
        }
        $Candidates = Get-ChildItem -LiteralPath $ShortcutRoot -Filter "$ProductName*.lnk" -Recurse -ErrorAction SilentlyContinue
        foreach ($Candidate in $Candidates) {
            $Info = Get-ShortcutInfo -Path $Candidate.FullName
            if ($Info.TargetPath -and ([System.IO.Path]::GetFullPath($Info.TargetPath) -eq [System.IO.Path]::GetFullPath($InstalledExe))) {
                return $Info
            }
        }
    }
    return $null
}

function Invoke-InstallerWithRetry {
    param(
        [string]$InstallerPath,
        [string]$InstallDir,
        [int]$MaxAttempts = 3
    )

    for ($Attempt = 1; $Attempt -le $MaxAttempts; $Attempt++) {
        try {
            if ($Attempt -gt 1) {
                Write-Host "Retrying installer smoke ($Attempt/$MaxAttempts)"
            }
            # NSIS requirement: /D must be the final argument and must not be quoted.
            Invoke-ProcessChecked -FilePath $InstallerPath -Arguments "/S /D=$InstallDir" -TimeoutSeconds 180
            return
        }
        catch {
            $Message = $_.Exception.Message
            if ($Attempt -eq $MaxAttempts) {
                throw
            }
            Write-Warning "Installer attempt $Attempt failed. $Message"
            Write-Host "Cleaning smoke directory before retry"
            Remove-SmokeTree -Path $SmokeRoot
            New-Item -ItemType Directory -Force -Path $SmokeRoot | Out-Null
            Start-Sleep -Seconds (2 * $Attempt)
        }
    }
}

Remove-SmokeTree -Path $SmokeRoot
New-Item -ItemType Directory -Force -Path $SmokeRoot | Out-Null

$Uninstaller = Join-Path $InstallDir "Uninstall $ProductName.exe"
$SmokeSucceeded = $false
try {
    Assert-NoRunningCastarro
    Write-Host "Installing $ProductName silently to $InstallDir"
    Invoke-InstallerWithRetry -InstallerPath $InstallerPath -InstallDir $InstallDir -MaxAttempts 3

    if (-not (Test-Path -LiteralPath $InstalledExe)) {
        throw "Installed executable was not created: $InstalledExe"
    }

    $StartMenuRoots = @(
        [Environment]::GetFolderPath("Programs"),
        [Environment]::GetFolderPath("CommonPrograms"),
        (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs")
    ) | Where-Object { $_ } | Select-Object -Unique
    $DesktopRoots = @(
        [Environment]::GetFolderPath("Desktop"),
        [Environment]::GetFolderPath("CommonDesktopDirectory")
    ) | Where-Object { $_ } | Select-Object -Unique

    $StartMenuShortcut = Find-ProductShortcut -Roots $StartMenuRoots
    if (-not $StartMenuShortcut) {
        throw "Start Menu shortcut was not created for $InstalledExe"
    }

    $DesktopShortcut = Find-ProductShortcut -Roots $DesktopRoots
    if (-not $DesktopShortcut) {
        throw "Desktop shortcut was not created for $InstalledExe"
    }

    Write-Host "Launching installed $ProductName in headless smoke mode"
    Invoke-ProcessChecked `
        -FilePath $InstalledExe `
        -Arguments "" `
        -WorkingDirectory $InstallDir `
        -Environment @{
            STREAM_HEADLESS_SMOKE = "1"
            STREAM_DISABLE_AUTO_UPDATE = "1"
            STREAM_DESKTOP_USER_DATA_DIR = $UserData
        } `
        -TimeoutSeconds 90

    $SmokeOk = Join-Path $UserData "packaged-smoke-ok.json"
    if (-not (Test-Path -LiteralPath $SmokeOk)) {
        throw "Installed app did not write smoke success file: $SmokeOk"
    }

    Write-Host "Installer smoke test passed"
    $SmokeSucceeded = $true
}
finally {
    if (Test-Path -LiteralPath $Uninstaller) {
        try {
            Write-Host "Uninstalling smoke-test installation"
            Invoke-ProcessChecked -FilePath $Uninstaller -Arguments "/S" -WorkingDirectory $InstallDir -TimeoutSeconds 120
            Start-Sleep -Seconds 2
        }
        catch {
            Write-Warning $_
        }
    }
    if ($SmokeSucceeded) {
        try {
            Remove-SmokeTree -Path $SmokeRoot
        }
        catch {
            Write-Warning "Smoke-test cleanup could not remove $SmokeRoot. $($_.Exception.Message)"
        }
    }
    else {
        Write-Warning "Installer smoke failed; preserving smoke directory for inspection: $SmokeRoot"
    }
    if ($TranscriptStarted) {
        try { Stop-Transcript | Out-Null } catch {}
    }
}
