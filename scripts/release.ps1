param(
    [string]$Version = "",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

if ($Version) {
    npm version $Version --no-git-tag-version
}

if (-not $SkipBuild) {
    npm run release:check
}

$Package = Get-Content -Raw -LiteralPath (Join-Path $Root "package.json") | ConvertFrom-Json
$Dist = Join-Path $Root "dist"
$Installer = Join-Path $Dist "Castarro Setup $($Package.version).exe"
$BlockMap = "$Installer.blockmap"

if (-not (Test-Path -LiteralPath $Installer)) {
    throw "Installer not found: $Installer"
}

$Artifacts = @($Installer)
if (Test-Path -LiteralPath $BlockMap) {
    $Artifacts += $BlockMap
}

$Manifest = [ordered]@{
    product = $Package.build.productName
    version = $Package.version
    created_at = (Get-Date).ToUniversalTime().ToString("s") + "Z"
    signed = [bool]($env:CSC_LINK -or $env:WIN_CSC_LINK)
    artifacts = @()
}

foreach ($Artifact in $Artifacts) {
    $Item = Get-Item -LiteralPath $Artifact
    $Hash = Get-FileHash -LiteralPath $Artifact -Algorithm SHA256
    $Manifest.artifacts += [ordered]@{
        name = $Item.Name
        bytes = $Item.Length
        sha256 = $Hash.Hash.ToLowerInvariant()
    }
}

$ManifestPath = Join-Path $Dist "release-manifest-$($Package.version).json"
$Manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8

Write-Host "Release manifest written: $ManifestPath"
Get-Content -Raw -LiteralPath $ManifestPath
