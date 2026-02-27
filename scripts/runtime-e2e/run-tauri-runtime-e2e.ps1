param(
  [string]$AppExePath,
  [int]$CdpPort = 9229,
  [switch]$SkipBuild,
  [switch]$NoBundleBuild,
  [string]$DataDir,
  [switch]$KeepDataDir
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [Parameter(ValueFromRemainingArguments = $true)]
    [object[]]$Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed ($LASTEXITCODE): $FilePath $($Arguments -join ' ')"
  }
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $repoRoot
$extraBins = @(
  "$env:USERPROFILE\.cargo\bin",
  "$env:APPDATA\npm",
  "${env:ProgramFiles(x86)}\NSIS",
  "$env:ProgramFiles\NSIS",
  "${env:ProgramFiles(x86)}\WiX Toolset v3.14\bin",
  "$env:ProgramFiles\WiX Toolset v3.14\bin"
) | Where-Object { $_ -and (Test-Path $_) }
$env:PATH = (($extraBins + @($env:PATH)) -join ";")

if (-not $SkipBuild) {
  if ($NoBundleBuild) {
    Invoke-Checked pnpm.cmd tauri build --bundles none
  } else {
    Invoke-Checked pnpm.cmd tauri build --bundles nsis
  }
}

if (-not $AppExePath) {
  $AppExePath = Join-Path $repoRoot "target\release\release-publisher-desktop.exe"
}
$AppExePath = (Resolve-Path $AppExePath).Path

if (-not (Test-Path $AppExePath)) {
  throw "App executable not found: $AppExePath"
}

if (-not $DataDir) {
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $DataDir = Join-Path $repoRoot ".runtime-e2e-temp\$stamp"
}
New-Item -ItemType Directory -Force $DataDir | Out-Null

$fixtureSpec = (Resolve-Path "fixtures/specs/valid_release.yaml").Path
$fixtureInvalidSpec = (Resolve-Path "fixtures/specs/invalid_release_missing_title.yaml").Path
$fixtureMedia = (Resolve-Path "fixtures/media/mock_media.bin").Path

$env:RELEASE_PUBLISHER_DATA_DIR = $DataDir
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$CdpPort"
$env:RUST_LOG = "info"
$env:TAURI_E2E_CDP_URL = "http://127.0.0.1:$CdpPort"
$env:TAURI_E2E_DATA_DIR = $DataDir
$env:TAURI_E2E_FIXTURE_SPEC_PATH = $fixtureSpec
$env:TAURI_E2E_FIXTURE_INVALID_SPEC_PATH = $fixtureInvalidSpec
$env:TAURI_E2E_FIXTURE_MEDIA_PATH = $fixtureMedia
$env:TAURI_E2E_EXPECT_CAP = "1"
$env:RUN_TAURI_E2E = "1"

$proc = Start-Process -FilePath $AppExePath -PassThru -WindowStyle Hidden
try {
  $ready = $false
  for ($i = 0; $i -lt 80; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      $null = Invoke-RestMethod -Uri "http://127.0.0.1:$CdpPort/json/version" -TimeoutSec 1
      $ready = $true
      break
    } catch {
      if ($proc.HasExited) {
        throw "Tauri app exited early (code $($proc.ExitCode))"
      }
    }
  }

  if (-not $ready) {
    throw "Timed out waiting for WebView2 CDP endpoint on port $CdpPort"
  }

  Invoke-Checked pnpm.cmd test:e2e:runtime

  $dbPath = Join-Path $DataDir "release_publisher.sqlite"
  if (-not (Test-Path $dbPath)) {
    throw "Runtime E2E expected DB file not found: $dbPath"
  }

  $reportFiles = Get-ChildItem -Path (Join-Path $DataDir "artifacts") -Filter release_report.json -Recurse -ErrorAction SilentlyContinue
  if (-not $reportFiles) {
    Write-Warning "Runtime E2E found no release_report.json under $DataDir\artifacts (allowed for catalog-only smoke coverage)."
  }

  Write-Host "[runtime-e2e] pass (cdp=$CdpPort, dataDir=$DataDir)"
} finally {
  if ($proc -and -not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force
    Start-Sleep -Milliseconds 500
  }

  if (-not $KeepDataDir) {
    try {
      Remove-Item -Path $DataDir -Recurse -Force -ErrorAction Stop
    } catch {
      Write-Warning "Failed to delete runtime E2E temp dir: $DataDir"
    }
  }
}
