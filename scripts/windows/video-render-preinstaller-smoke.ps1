param(
  [switch]$SkipBoundaryCheck,
  [switch]$SkipFrontend,
  [switch]$SkipRust
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

function Invoke-PnpmChecked {
  param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [object[]]$Arguments
  )

  if (Get-Command pnpm.cmd -ErrorAction SilentlyContinue) {
    Invoke-Checked pnpm.cmd @Arguments
    return
  }

  if (-not $env:COREPACK_HOME) {
    $env:COREPACK_HOME = Join-Path (Get-Location) ".corepack"
  }
  if (-not (Test-Path $env:COREPACK_HOME)) {
    New-Item -ItemType Directory -Path $env:COREPACK_HOME -Force | Out-Null
  }

  Invoke-Checked corepack pnpm @Arguments
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $repoRoot

Write-Host "[video-preinstaller-smoke] repo root: $repoRoot"

$bundledCandidates = @(
  "apps/desktop/src-tauri/resources/ffmpeg/win32/ffmpeg.exe",
  "apps/desktop/src-tauri/resources/ffmpeg/windows/ffmpeg.exe"
)
$bundledFound = @($bundledCandidates | Where-Object { Test-Path $_ })

if ($bundledFound.Count -gt 0) {
  Write-Host "[video-preinstaller-smoke] bundled ffmpeg candidate(s):"
  foreach ($path in $bundledFound) {
    Write-Host "  - $path"
  }
} else {
  Write-Warning "No bundled ffmpeg executable found under apps/desktop/src-tauri/resources/ffmpeg. Runtime can still use PATH ffmpeg, but installer validation should bundle a pinned ffmpeg binary."
}

if (-not $SkipBoundaryCheck -and (Test-Path "scripts/check-boundaries.ps1")) {
  Invoke-Checked powershell -NoProfile -ExecutionPolicy Bypass -File "scripts/check-boundaries.ps1"
}

if (-not $SkipFrontend) {
  Invoke-PnpmChecked @("typecheck")
  Invoke-PnpmChecked @("lint")
  Invoke-PnpmChecked @("--filter", "@release-publisher/desktop", "test", "--", "--run")
  Invoke-PnpmChecked @("build")
}

if (-not $SkipRust) {
  Invoke-Checked cargo @("test", "-p", "release-publisher-desktop", "--lib")
  Invoke-Checked cargo @("test", "-p", "release-publisher-desktop", "backend_video_render_service::runtime::tests::ffmpeg_runner_integration_renders_mp4_when_ffmpeg_available", "--", "--nocapture")
}

Write-Host "[video-preinstaller-smoke] automated checks completed"
Write-Host "[video-preinstaller-smoke] continue with manual checklist: docs/video-workspace/PREINSTALLER_READINESS_CHECKLIST.md"


