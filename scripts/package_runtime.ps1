param(
    [string]$PythonVersion = "3.13.7",
    [string]$PythonUrl = "",
    [string]$FFmpegUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
    [string]$ExpectedFFmpegVersion = "8.1.2",
    [string]$ExpectedFFmpegSha256 = "",
    [switch]$SkipDownload
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$PythonDir = Join-Path $Root "desktop\resources\python"
$FFmpegDir = Join-Path $Root "desktop\resources\ffmpeg"
$CacheDir = Join-Path $Root ".runtime\package-cache"

New-Item -ItemType Directory -Force -Path $PythonDir, $FFmpegDir, $CacheDir | Out-Null

if (-not $PythonUrl) {
    $PythonUrl = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
}

function Invoke-Download {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$OutFile
    )

    if ((Test-Path -LiteralPath $OutFile) -and ((Get-Item -LiteralPath $OutFile).Length -gt 0)) {
        Write-Host "Using cached $OutFile"
        return
    }

    Write-Host "Downloading $Url"
    Invoke-WebRequest -Uri $Url -OutFile $OutFile
}

function Clear-Directory {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (Test-Path -LiteralPath $Path) {
        Get-ChildItem -LiteralPath $Path -Force | Remove-Item -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Assert-FFmpegVersion {
    param([Parameter(Mandatory = $true)][string]$ExePath)

    if (-not $ExpectedFFmpegVersion) {
        return
    }
    if (-not (Test-Path -LiteralPath $ExePath)) {
        throw "FFmpeg executable not found: $ExePath"
    }
    $VersionLine = (& $ExePath -hide_banner -version | Select-Object -First 1)
    if ($VersionLine -notmatch [regex]::Escape($ExpectedFFmpegVersion)) {
        throw "Unexpected FFmpeg version. Expected $ExpectedFFmpegVersion, got: $VersionLine"
    }
}

function Assert-FileSha256 {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [string]$ExpectedSha256
    )

    if (-not $ExpectedSha256) {
        return
    }
    $Actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($Actual -ne $ExpectedSha256.ToLowerInvariant()) {
        throw "Unexpected SHA-256 for $Path. Expected $ExpectedSha256, got: $Actual"
    }
}

function Update-PythonPathFile {
    $Pth = Get-ChildItem -LiteralPath $PythonDir -Filter "python*._pth" | Select-Object -First 1
    if (-not $Pth) {
        return
    }

    $Lines = @(Get-Content -LiteralPath $Pth.FullName)
    $Required = @(
        "Lib\site-packages",
        "..\app\scripts",
        "..\app.asar.unpacked\scripts",
        "..\..\..\scripts"
    )
    foreach ($Line in $Required) {
        if ($Lines -notcontains $Line) {
            $Lines += $Line
        }
    }
    Set-Content -LiteralPath $Pth.FullName -Value $Lines -Encoding ASCII
}

function Install-PythonRuntime {
    if ((Test-Path -LiteralPath (Join-Path $PythonDir "python.exe")) -and -not $SkipDownload) {
        Write-Host "Portable Python already exists at $PythonDir"
        Update-PythonPathFile
        return
    }

    $Archive = Join-Path $CacheDir "python-$PythonVersion-embed-amd64.zip"
    if (-not $SkipDownload) {
        Invoke-Download -Url $PythonUrl -OutFile $Archive
    }
    if (-not (Test-Path -LiteralPath $Archive)) {
        throw "Python archive not found: $Archive"
    }

    Clear-Directory -Path $PythonDir
    Expand-Archive -LiteralPath $Archive -DestinationPath $PythonDir -Force

    Update-PythonPathFile
}

function Install-FFmpegRuntime {
    $ExistingFfmpeg = Join-Path $FFmpegDir "ffmpeg.exe"
    $ExistingFfprobe = Join-Path $FFmpegDir "ffprobe.exe"
    if ((Test-Path -LiteralPath $ExistingFfmpeg) -and (Test-Path -LiteralPath $ExistingFfprobe)) {
        try {
            Assert-FFmpegVersion -ExePath $ExistingFfmpeg
            Write-Host "FFmpeg tools already exist at $FFmpegDir"
            return
        } catch {
            if ($SkipDownload) {
                throw
            }
            Write-Warning "$($_.Exception.Message) Reinstalling FFmpeg from $FFmpegUrl."
        }
    }

    $Archive = Join-Path $CacheDir ("ffmpeg-" + ($ExpectedFFmpegVersion -replace '[^A-Za-z0-9._-]', '_') + "-essentials.zip")
    if (-not $SkipDownload) {
        Invoke-Download -Url $FFmpegUrl -OutFile $Archive
    }
    if (-not (Test-Path -LiteralPath $Archive)) {
        throw "FFmpeg archive not found: $Archive"
    }
    Assert-FileSha256 -Path $Archive -ExpectedSha256 $ExpectedFFmpegSha256

    $ExtractDir = Join-Path $CacheDir "ffmpeg-extract"
    Clear-Directory -Path $ExtractDir
    Expand-Archive -LiteralPath $Archive -DestinationPath $ExtractDir -Force

    $Ffmpeg = Get-ChildItem -LiteralPath $ExtractDir -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
    $Ffprobe = Get-ChildItem -LiteralPath $ExtractDir -Recurse -Filter "ffprobe.exe" | Select-Object -First 1
    if (-not $Ffmpeg -or -not $Ffprobe) {
        throw "Could not find ffmpeg.exe and ffprobe.exe in $Archive"
    }

    Clear-Directory -Path $FFmpegDir
    Copy-Item -LiteralPath $Ffmpeg.FullName -Destination (Join-Path $FFmpegDir "ffmpeg.exe") -Force
    Copy-Item -LiteralPath $Ffprobe.FullName -Destination (Join-Path $FFmpegDir "ffprobe.exe") -Force
    Assert-FFmpegVersion -ExePath (Join-Path $FFmpegDir "ffmpeg.exe")

    $LicenseRoot = Split-Path -Parent (Split-Path -Parent $Ffmpeg.FullName)
    Get-ChildItem -LiteralPath $LicenseRoot -File -Include "LICENSE*", "README*" -ErrorAction SilentlyContinue |
        Copy-Item -Destination $FFmpegDir -Force
}

Install-PythonRuntime
Install-FFmpegRuntime

& (Join-Path $PythonDir "python.exe") --version
& (Join-Path $FFmpegDir "ffmpeg.exe") -version | Select-Object -First 1
& (Join-Path $FFmpegDir "ffprobe.exe") -version | Select-Object -First 1

Write-Host "Runtime bundle ready:"
Write-Host "  $PythonDir"
Write-Host "  $FFmpegDir"
