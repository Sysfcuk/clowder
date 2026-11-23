<#
.SYNOPSIS
  Builds the Clowder Android app (APK) and optionally installs it on a phone or emulator.

.EXAMPLE
  .\build-android.ps1              # debug APK
  .\build-android.ps1 -Install     # build, then install on the connected device / running emulator
  .\build-android.ps1 -Release     # signed release APK (needs android\keystore.properties)

  Needs: a JDK 17 (e.g. winget install Microsoft.OpenJDK.17) and the Android SDK
  (found automatically in %LOCALAPPDATA%\Android\Sdk). Gradle downloads itself on first run.
#>
param([switch]$Install, [switch]$Release)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$android = Join-Path $root 'android'

# --- JDK ---
if (-not $env:JAVA_HOME -or -not (Test-Path "$env:JAVA_HOME\bin\java.exe")) {
  $jdk = Get-ChildItem 'C:\Program Files\Microsoft', 'C:\Program Files\Eclipse Adoptium', 'C:\Program Files\Java', 'C:\Program Files\Android\Android Studio' -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^(jdk-?17|jdk-?21|jbr)' -and (Test-Path (Join-Path $_.FullName 'bin\java.exe')) } |
    Sort-Object Name -Descending | Select-Object -First 1
  if (-not $jdk) { throw 'No JDK 17 found. Install one with:  winget install Microsoft.OpenJDK.17' }
  $env:JAVA_HOME = $jdk.FullName
}
Write-Host "JDK:  $env:JAVA_HOME"

# --- Android SDK ---
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path (Join-Path $sdk 'platforms'))) { throw "Android SDK not found at $sdk (set ANDROID_HOME)." }
Write-Host "SDK:  $sdk"
Set-Content (Join-Path $android 'local.properties') ('sdk.dir=' + ($sdk -replace '\\', '\\')) -Encoding ASCII

# --- Gradle wrapper jar (fetched once, verified against Gradle's published checksum) ---
$jar = Join-Path $android 'gradle\wrapper\gradle-wrapper.jar'
if (-not (Test-Path $jar)) {
  Write-Host 'Fetching the Gradle wrapper...'
  Invoke-WebRequest 'https://raw.githubusercontent.com/gradle/gradle/v8.7.0/gradle/wrapper/gradle-wrapper.jar' -OutFile $jar -UseBasicParsing
  $raw = (Invoke-WebRequest 'https://services.gradle.org/distributions/gradle-8.7-wrapper.jar.sha256' -UseBasicParsing).Content
  $want = $(if ($raw -is [byte[]]) { [Text.Encoding]::ASCII.GetString($raw) } else { [string]$raw }).Trim().ToLower()
  $got = (Get-FileHash $jar -Algorithm SHA256).Hash.ToLower()
  if ($got -ne $want) { Remove-Item $jar; throw "Gradle wrapper checksum mismatch ($got vs $want)." }
}

# --- build ---
$task = if ($Release) { 'assembleRelease' } else { 'assembleDebug' }
Push-Location $android
try { & .\gradlew.bat $task --console=plain; if ($LASTEXITCODE) { throw "Gradle failed ($LASTEXITCODE)." } }
finally { Pop-Location }

$kind = if ($Release) { 'release' } else { 'debug' }
$apk = Get-ChildItem (Join-Path $android "app\build\outputs\apk\$kind") -Filter *.apk | Select-Object -First 1
$out = Join-Path $root "Clowder-$kind.apk"
Copy-Item $apk.FullName $out -Force
Write-Host ("APK:  {0}  ({1:N1} MB)" -f $out, ((Get-Item $out).Length / 1MB))

if ($Install) {
  $adb = Join-Path $sdk 'platform-tools\adb.exe'
  & $adb install -r $out
  & $adb shell am start -n com.clowder.game/.MainActivity | Out-Null
  Write-Host 'Installed and launched on the device.'
}
