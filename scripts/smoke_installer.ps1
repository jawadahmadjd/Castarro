param(
    [string]$InstallerPath = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$Package = Get-Content -Raw -LiteralPath (Join-Path $Root "package.json") | ConvertFrom-Json
$ProductName = [string]$Package.build.productName
if (-not $InstallerPath) {
    $InstallerPath = Join-Path $Root "dist\$ProductName-Setup-$($Package.version).exe"
}
if (-not (Test-Path -LiteralPath $InstallerPath)) {
    throw "Installer not found: $InstallerPath"
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

    if (-not $Path -or -not (Test-Path -LiteralPath $Path)) {
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

$SmokeRootName = "castarro-installer-smoke"
$SmokeBaseCandidates = @(
    $env:CASTARRO_INSTALLER_SMOKE_ROOT,
    $env:RUNNER_TEMP,
    "C:\tmp",
    $Root
) | Where-Object { $_ }
$SmokeBase = $SmokeBaseCandidates | Where-Object { Test-WritableDirectory -Path $_ } | Select-Object -First 1
if (-not $SmokeBase) {
    throw "No writable directory found for installer smoke test."
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
    $StartInfo.Environment.Remove("ELECTRON_RUN_AS_NODE") | Out-Null
    foreach ($Key in $Environment.Keys) {
        $StartInfo.Environment[$Key] = [string]$Environment[$Key]
    }

    $Process = [System.Diagnostics.Process]::new()
    $Process.StartInfo = $StartInfo
    $Process.Start() | Out-Null
    if (-not $Process.WaitForExit($TimeoutSeconds * 1000)) {
        try { $Process.Kill() } catch {}
        throw "Process timed out: $FilePath $Arguments"
    }
    if ($Process.ExitCode -ne 0) {
        throw "Process failed with exit code $($Process.ExitCode): $FilePath $Arguments"
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

Remove-SmokeTree -Path $SmokeRoot
New-Item -ItemType Directory -Force -Path $SmokeRoot | Out-Null

$Uninstaller = Join-Path $InstallDir "Uninstall $ProductName.exe"
try {
    Write-Host "Installing $ProductName silently to $InstallDir"
    Invoke-ProcessChecked -FilePath $InstallerPath -Arguments "/S `"/D=$InstallDir`"" -TimeoutSeconds 180

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
    try {
        Remove-SmokeTree -Path $SmokeRoot
    }
    catch {
        Write-Warning "Smoke-test cleanup could not remove $SmokeRoot. $($_.Exception.Message)"
    }
}
