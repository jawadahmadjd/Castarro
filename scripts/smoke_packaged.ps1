param(
    [string]$ExePath = "",
    [switch]$RequireYoutubeCredentials
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
$YoutubeSeed = Join-Path $Resources "seed-data\youtube.oauth.seed.json"
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
    try {
        Remove-Item -LiteralPath $UserData -Recurse -Force -ErrorAction Stop
    }
    catch {
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and ($_.CommandLine -like "*$DataRoot*" -or $_.CommandLine -like "*$UserData*") } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Milliseconds 500
        Remove-Item -LiteralPath $UserData -Recurse -Force -ErrorAction SilentlyContinue
    }
}
New-Item -ItemType Directory -Force -Path $DataRoot, $LogRoot | Out-Null
@{
    youtube = @{
        client_id = ""
        client_secret = ""
        oauth_client_type = "desktop"
    }
    channels = @()
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $DataRoot "config.ready.json") -Encoding UTF8

$PreviousElectronRunAsNode = $env:ELECTRON_RUN_AS_NODE
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

$MaxAttempts = 3
$ProbeIterations = 120
$Success = $false
$LastError = $null
try {
    for ($Attempt = 1; $Attempt -le $MaxAttempts; $Attempt++) {
        $Process = $null
        $OutTask = $null
        $ErrTask = $null
        try {
            $Listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), 0)
            $Listener.Start()
            $Port = $Listener.LocalEndpoint.Port
            $Listener.Stop()

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

            $Ready = $false
            $Url = "http://127.0.0.1:$Port"
            for ($i = 0; $i -lt $ProbeIterations; $i++) {
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
                $ExitSummary = ""
                if ($Process.HasExited) {
                    $ExitSummary = " Process exited with code $($Process.ExitCode)."
                }
                $ErrOutput = if ($ErrTask) { ($ErrTask.Result | Out-String).Trim() } else { "" }
                if ($ErrOutput) {
                    $ExitSummary += " stderr: $ErrOutput"
                }
                throw "Packaged backend did not expose a healthy API within timeout.$ExitSummary"
            }

            $ConfigName = if (($Status.configs -contains "config.ready.json")) { "config.ready.json" } elseif (($Status.configs -contains "config.json")) { "config.json" } else { [string]$Status.config }
            $YoutubeStatus = Invoke-RestMethod -Uri "$Url/api/youtube/status?config=$([uri]::EscapeDataString($ConfigName))" -TimeoutSec 5
            if (-not $YoutubeStatus.has_client_credentials) {
                if ($RequireYoutubeCredentials -or (Test-Path -LiteralPath $YoutubeSeed)) {
                    throw "Packaged backend reports missing YouTube owner OAuth credentials for $ConfigName. Verify resources\seed-data\youtube.oauth.seed.json is bundled and readable."
                }
                Write-Warning "Packaged backend reports missing YouTube owner OAuth credentials for $ConfigName. No bundled youtube.oauth.seed.json was found, so this smoke check is informational."
            }
            [pscustomobject]@{
                youtubeConfig = $ConfigName
                youtubeHasClientCredentials = [bool]$YoutubeStatus.has_client_credentials
                youtubeOauthClientType = [string]$YoutubeStatus.oauth_client_type
                youtubeSeedBundled = Test-Path -LiteralPath $YoutubeSeed
            } | ConvertTo-Json -Depth 3

            $Success = $true
            break
        }
        catch {
            $LastError = $_
            if ($Attempt -lt $MaxAttempts) {
                Write-Warning "Packaged backend smoke attempt $Attempt failed. Retrying..."
                Start-Sleep -Seconds $Attempt
            }
        }
        finally {
            if ($Process -and -not $Process.HasExited) {
                $Process.Kill()
                $Process.WaitForExit()
            }
            if ($OutTask) {
                Set-Content -LiteralPath $OutLog -Value $OutTask.Result -Encoding UTF8
            }
            if ($ErrTask) {
                Set-Content -LiteralPath $ErrLog -Value $ErrTask.Result -Encoding UTF8
            }
        }
    }

    if (-not $Success) {
        throw $LastError
    }
}
finally {
    if ($PreviousElectronRunAsNode) {
        $env:ELECTRON_RUN_AS_NODE = $PreviousElectronRunAsNode
    }
    else {
        Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    }
}
