param(
    [string]$Config = "config.json",
    [switch]$Require
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$SeedDir = Join-Path $Root "desktop\resources\seed-data"
$SeedPath = Join-Path $SeedDir "youtube.oauth.seed.json"

function Read-TextValue($Value) {
    if ($null -eq $Value) {
        return ""
    }
    return ([string]$Value).Trim()
}

function First-TextValue([string[]]$Names) {
    foreach ($Name in $Names) {
        $Value = Read-TextValue (Get-Item -Path "Env:$Name" -ErrorAction SilentlyContinue).Value
        if (-not [string]::IsNullOrWhiteSpace($Value)) {
            return $Value
        }
    }
    return ""
}

$ClientId = First-TextValue @("CASTARRO_YOUTUBE_CLIENT_ID", "STREAM_YOUTUBE_CLIENT_ID")
$ClientSecret = First-TextValue @("CASTARRO_YOUTUBE_CLIENT_SECRET", "STREAM_YOUTUBE_CLIENT_SECRET")
$ClientType = First-TextValue @("CASTARRO_YOUTUBE_OAUTH_CLIENT_TYPE", "STREAM_YOUTUBE_OAUTH_CLIENT_TYPE")
$RedirectUri = First-TextValue @("CASTARRO_YOUTUBE_REDIRECT_URI", "STREAM_YOUTUBE_REDIRECT_URI")

$ConfigPath = Join-Path $Root $Config
if ([string]::IsNullOrWhiteSpace($ClientId) -and (Test-Path -LiteralPath $ConfigPath)) {
    $LocalConfig = Get-Content -Raw -LiteralPath $ConfigPath | ConvertFrom-Json
    if ($LocalConfig.youtube) {
        if ([string]::IsNullOrWhiteSpace($ClientId)) {
            $ClientId = Read-TextValue $LocalConfig.youtube.client_id
        }
        if ([string]::IsNullOrWhiteSpace($ClientSecret)) {
            $ClientSecret = Read-TextValue $LocalConfig.youtube.client_secret
        }
        if ([string]::IsNullOrWhiteSpace($ClientType)) {
            $ClientType = Read-TextValue $LocalConfig.youtube.oauth_client_type
        }
        if ([string]::IsNullOrWhiteSpace($RedirectUri)) {
            $RedirectUri = Read-TextValue $LocalConfig.youtube.redirect_uri
        }
    }
}

$ExistingClientSecret = ""
if (Test-Path -LiteralPath $SeedPath) {
    $ExistingSeed = Get-Content -Raw -LiteralPath $SeedPath | ConvertFrom-Json
    $ExistingClientId = Read-TextValue $ExistingSeed.youtube.client_id
    if (-not [string]::IsNullOrWhiteSpace($ClientId) -and $ExistingClientId -eq $ClientId) {
        $ExistingClientSecret = Read-TextValue $ExistingSeed.youtube.client_secret
    }
}

if ([string]::IsNullOrWhiteSpace($ClientSecret) -and -not [string]::IsNullOrWhiteSpace($ExistingClientSecret)) {
    $ClientSecret = $ExistingClientSecret
}

if ([string]::IsNullOrWhiteSpace($ClientId)) {
    if (Test-Path -LiteralPath $SeedPath) {
        $ExistingSeed = Get-Content -Raw -LiteralPath $SeedPath | ConvertFrom-Json
        $ExistingClientId = Read-TextValue $ExistingSeed.youtube.client_id
        if (-not [string]::IsNullOrWhiteSpace($ExistingClientId)) {
            Write-Host "Keeping existing YouTube OAuth seed: $SeedPath"
            exit 0
        }
    }

    $Message = "YouTube OAuth client ID was not found in environment variables or $Config. Packaged users will see owner OAuth credentials as missing."
    if ($Require) {
        throw $Message
    }
    Write-Warning $Message
    exit 0
}

if ([string]::IsNullOrWhiteSpace($ClientType)) {
    $ClientType = "desktop"
}
if ([string]::IsNullOrWhiteSpace($RedirectUri)) {
    $RedirectUri = "http://127.0.0.1:8765/api/youtube/oauth/callback"
}

New-Item -ItemType Directory -Force -Path $SeedDir | Out-Null
$Payload = [ordered]@{
    youtube = [ordered]@{
        client_id = $ClientId
        client_secret = $ClientSecret
        oauth_client_type = $ClientType
        use_pkce = $true
        redirect_uri = $RedirectUri
        scopes = @(
            "https://www.googleapis.com/auth/youtube",
            "https://www.googleapis.com/auth/youtube.force-ssl"
        )
    }
}

$Payload | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $SeedPath -Encoding UTF8
Write-Host "YouTube OAuth seed written: $SeedPath"
