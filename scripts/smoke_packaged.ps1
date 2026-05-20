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

$UnpackedRoot = Split-Path -Parent $ExePath
$Resources = Join-Path $UnpackedRoot "resources"
$Python = Join-Path $Resources "python\python.exe"
$AppRoot = Join-Path $Resources "app"
$Script = Join-Path $AppRoot "scripts\web_ui.py"
$WebRoot = Join-Path $AppRoot "web"
$FFmpeg = Join-Path $Resources "ffmpeg\ffmpeg.exe"
$FFprobe = Join-Path $Resources "ffmpeg\ffprobe.exe"
$UserData = Join-Path $Root ".packaged-smoke-user-data"
$DataRoot = Join-Path $UserData "data"
$LogRoot = Join-Path $UserData "logs"
$OutLog = Join-Path $LogRoot "backend.out.log"
$ErrLog = Join-Path $LogRoot "backend.err.log"

foreach ($Required in @($Python, $Script, $WebRoot, $FFmpeg, $FFprobe)) {
    if (-not (Test-Path -LiteralPath $Required)) {
        throw "Required packaged resource missing: $Required"
    }
}

if (Test-Path -LiteralPath $UserData) {
    Remove-Item -LiteralPath $UserData -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $DataRoot, $LogRoot | Out-Null

$Listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), 0)
$Listener.Start()
$Port = $Listener.LocalEndpoint.Port
$Listener.Stop()

$PreviousElectronRunAsNode = $env:ELECTRON_RUN_AS_NODE
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

$StartInfo = [System.Diagnostics.ProcessStartInfo]::new()
$StartInfo.FileName = $Python
$StartInfo.Arguments = '"' + $Script.Replace('"', '\"') + '"'
$StartInfo.WorkingDirectory = $DataRoot
$StartInfo.UseShellExecute = $false
$StartInfo.CreateNoWindow = $true
$StartInfo.RedirectStandardOutput = $true
$StartInfo.RedirectStandardError = $true
$StartInfo.Environment["STREAM_UI_PORT"] = [string]$Port
$StartInfo.Environment["STREAM_APP_CODE_DIR"] = $AppRoot
$StartInfo.Environment["STREAM_APP_DATA_DIR"] = $DataRoot
$StartInfo.Environment["STREAM_WEB_ROOT"] = $WebRoot
$StartInfo.Environment["STREAM_LEGACY_ROOT"] = Join-Path $Resources "seed-data"
$StartInfo.Environment["STREAM_FFMPEG_PATH"] = $FFmpeg
$StartInfo.Environment["STREAM_FFPROBE_PATH"] = $FFprobe

$Process = [System.Diagnostics.Process]::new()
$Process.StartInfo = $StartInfo
$Process.Start() | Out-Null

$OutTask = $Process.StandardOutput.ReadToEndAsync()
$ErrTask = $Process.StandardError.ReadToEndAsync()

try {
    $Ready = $false
    $Url = "http://127.0.0.1:$Port"
    for ($i = 0; $i -lt 40; $i++) {
        if ($Process.HasExited) {
            break
        }
        try {
            $Status = Invoke-RestMethod -Uri "$Url/api/status" -TimeoutSec 1
            if ($Status.root -and $Status.code_root -and $Status.binaries.ffmpeg.exists -and $Status.binaries.ffprobe.exists) {
                $Ready = $true
                $Status | ConvertTo-Json -Depth 4
                break
            }
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }

    if (-not $Ready) {
        throw "Packaged backend did not expose a healthy API within timeout."
    }
}
finally {
    if ($Process -and -not $Process.HasExited) {
        $Process.Kill()
        $Process.WaitForExit()
    }
    Set-Content -LiteralPath $OutLog -Value $OutTask.Result -Encoding UTF8
    Set-Content -LiteralPath $ErrLog -Value $ErrTask.Result -Encoding UTF8
    if ($PreviousElectronRunAsNode) {
        $env:ELECTRON_RUN_AS_NODE = $PreviousElectronRunAsNode
    }
    else {
        Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    }
}
