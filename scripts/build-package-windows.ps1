param(
  [switch]$SkipInstall,
  [string]$BundleTargets = "nsis",
  [string]$ArtifactsRoot = "artifacts"
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

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
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

if (-not $SkipInstall) {
  Invoke-Checked pnpm.cmd install
}

$today = Get-Date -Format "yyyyMMdd"
$dest = Join-Path $repoRoot (Join-Path $ArtifactsRoot (Join-Path "windows" $today))
New-Item -ItemType Directory -Force $dest | Out-Null

Invoke-Checked pnpm.cmd --filter @release-publisher/desktop build
Invoke-Checked pnpm.cmd tauri build --bundles $BundleTargets

$tauriTarget = Join-Path $repoRoot "target\release"
$bundleDir = Join-Path $tauriTarget "bundle"
$exePath = Join-Path $tauriTarget "release-publisher-desktop.exe"

if (Test-Path $exePath) {
  Copy-Item $exePath -Destination (Join-Path $dest "release-publisher-desktop.exe") -Force
}
if (Test-Path $bundleDir) {
  $bundleDest = Join-Path $dest "bundle"
  if (Test-Path $bundleDest) {
    Remove-Item -Path $bundleDest -Recurse -Force
  }
  Copy-Item $bundleDir -Destination $bundleDest -Recurse -Force
}

$manifest = @{
  os = "windows"
  date = $today
  built_at_utc = (Get-Date).ToUniversalTime().ToString("o")
  bundle_targets = $BundleTargets
  artifact_dir = $dest
  exe_present = (Test-Path $exePath)
  bundle_present = (Test-Path $bundleDir)
} | ConvertTo-Json -Depth 4
Set-Content -Encoding utf8 (Join-Path $dest "build_manifest.json") $manifest

Write-Host "[build-package] artifacts: $dest"
