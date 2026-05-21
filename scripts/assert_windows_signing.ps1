param(
    [switch]$AllowUnsigned
)

$ErrorActionPreference = "Stop"

function Get-FirstEnvValue {
    param([string[]]$Names)

    foreach ($Name in $Names) {
        $Value = [Environment]::GetEnvironmentVariable($Name)
        if (-not [string]::IsNullOrWhiteSpace($Value)) {
            return [pscustomobject]@{
                Name = $Name
                Value = $Value
            }
        }
    }

    return $null
}

$Link = Get-FirstEnvValue -Names @("WIN_CSC_LINK", "CSC_LINK")
$Password = Get-FirstEnvValue -Names @("WIN_CSC_KEY_PASSWORD", "CSC_KEY_PASSWORD")

$Missing = @()
if (-not $Link) {
    $Missing += "WIN_CSC_LINK (or CSC_LINK)"
}
if (-not $Password) {
    $Missing += "WIN_CSC_KEY_PASSWORD (or CSC_KEY_PASSWORD)"
}

if ($Missing.Count -gt 0) {
    $Message = "Windows code-signing is not configured. Missing: " + ($Missing -join ", ")
    if ($AllowUnsigned) {
        Write-Warning "$Message. Continuing because -AllowUnsigned was set."
        exit 0
    }
    throw "$Message. Configure repository secrets before publishing releases."
}

Write-Host "Windows signing certificate source: $($Link.Name)"
Write-Host "Windows signing password source: $($Password.Name)"
Write-Host "Windows signing prerequisites are configured."
