param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [switch]$AllowUnsigned
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $Path)) {
    throw "File not found: $Path"
}

$Signature = Get-AuthenticodeSignature -LiteralPath $Path
$Signer = if ($Signature.SignerCertificate) { $Signature.SignerCertificate.Subject } else { "" }

Write-Host "Signature status: $($Signature.Status)"
if ($Signer) {
    Write-Host "Signer: $Signer"
}

if ($AllowUnsigned) {
    if ($Signature.Status -eq "Valid") {
        Write-Host "Signature is valid."
    } else {
        Write-Warning "Signature is not valid, but continuing because -AllowUnsigned was set."
    }
    exit 0
}

if ($Signature.Status -ne "Valid") {
    $StatusMessage = if ($Signature.StatusMessage) { $Signature.StatusMessage } else { "Unknown signing error" }
    throw "Expected a valid Authenticode signature for '$Path' but got '$($Signature.Status)': $StatusMessage"
}

Write-Host "Signature verification passed."
