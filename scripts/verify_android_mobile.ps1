param(
    [string]$ProjectDir = "mobile/android/CastarroMobile"
)

$ErrorActionPreference = "Stop"

function Step($Name) {
    Write-Host ""
    Write-Host "== $Name ==" -ForegroundColor Cyan
}

function Run($Command, $Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $Command $($Arguments -join ' ')"
    }
}

function Use-AndroidStudioJdk {
    if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME "bin/java.exe"))) {
        Write-Host "Using JAVA_HOME: $env:JAVA_HOME"
        return
    }

    $candidates = @(
        "C:/Program Files/Android/Android Studio/jbr",
        "$env:LOCALAPPDATA/Programs/Android Studio/jbr"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path (Join-Path $candidate "bin/java.exe")) {
            $env:JAVA_HOME = (Resolve-Path $candidate).Path
            $env:Path = "$env:JAVA_HOME\bin;$env:Path"
            Write-Host "Using Android Studio JDK: $env:JAVA_HOME"
            return
        }
    }

    throw "JAVA_HOME is not set and Android Studio's bundled JDK was not found."
}

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$androidProject = Resolve-Path (Join-Path $root $ProjectDir)

Step "Shared core contracts"
Push-Location $root
try {
    Run "python" @("tests/mobile_shared_core_contract_test.py")
    Run "npm.cmd" @("run", "screenshot:mobile")
}
finally {
    Pop-Location
}

Step "Java"
Use-AndroidStudioJdk

Step "Locate Gradle"
$gradle = Join-Path $androidProject "gradlew.bat"
if (-not (Test-Path $gradle)) {
    $cached = Get-ChildItem -Path (Join-Path $env:USERPROFILE ".gradle/wrapper/dists") -Recurse -Filter gradle.bat -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending |
        Select-Object -First 1
    if ($cached) {
        $gradle = $cached.FullName
    }
}
if (-not (Test-Path $gradle)) {
    throw "Gradle was not found. Open Android Studio once, sync the project, then rerun this script."
}
Write-Host "Using Gradle: $gradle"

Step "Android unit tests"
Push-Location $androidProject
try {
    Run $gradle @(":app:testDebugUnitTest", "--no-daemon")
}
finally {
    Pop-Location
}

Step "Android debug APK"
Push-Location $androidProject
try {
    Run $gradle @(":app:assembleDebug", "--no-daemon")
}
finally {
    Pop-Location
}

$apk = Join-Path $androidProject "app/build/outputs/apk/debug/app-debug.apk"
if (-not (Test-Path $apk)) {
    throw "Debug APK was not produced at $apk"
}

Step "Complete"
Write-Host "Android verification passed."
Write-Host "APK: $apk"
Write-Host "Screenshots: $(Join-Path $root 'tests/screenshots/mobile-android-architecture')"
