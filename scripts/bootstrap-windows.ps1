param(
  [string]$PnpmVersion = "9.15.4",
  [switch]$SkipRepoInstall,
  [switch]$InstallVsBuildTools
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

function Test-CommandExists([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Install-WingetPackageIfMissing {
  param(
    [Parameter(Mandatory = $true)][string]$Id,
    [string]$CheckCommand,
    [string]$CheckRegistryPath,
    [string[]]$ExtraArgs = @()
  )

  $present = $false
  if ($CheckCommand) {
    $present = Test-CommandExists $CheckCommand
  } elseif ($CheckRegistryPath) {
    $present = Test-Path $CheckRegistryPath
  }

  if ($present) {
    Write-Host "[bootstrap] $Id already present"
    return
  }

  if (-not (Test-CommandExists "winget")) {
    throw "winget is required to install $Id"
  }

  Write-Host "[bootstrap] installing $Id via winget..."
  $args = @(
    "install", "-e",
    "--id", $Id,
    "--accept-package-agreements",
    "--accept-source-agreements"
  ) + $ExtraArgs
  Invoke-Checked winget @args
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot
$env:PATH = "$env:APPDATA\npm;$env:PATH"

if (-not (Test-Path "$env:USERPROFILE\.cargo\bin\rustup.exe")) {
  Install-WingetPackageIfMissing -Id "Rustlang.Rustup" -CheckCommand "rustup"
}
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
Invoke-Checked rustup toolchain install stable
Invoke-Checked rustup default stable
Invoke-Checked rustup component add rustfmt clippy

if (-not (Test-CommandExists "node")) {
  Install-WingetPackageIfMissing -Id "OpenJS.NodeJS.LTS" -CheckCommand "node"
}
if (-not (Test-CommandExists "corepack")) {
  Invoke-Checked npm install -g corepack
}
try {
  Invoke-Checked corepack enable
  Invoke-Checked corepack prepare "pnpm@$PnpmVersion" --activate
} catch {
  Write-Warning "Corepack activation failed; falling back to npm global pnpm install. $($_.Exception.Message)"
}
$env:PATH = "$env:APPDATA\npm;$env:PATH"
if (-not (Test-Path (Join-Path $env:APPDATA "npm\pnpm.cmd"))) {
  Write-Warning "corepack did not make pnpm available; falling back to npm global pnpm install"
  Invoke-Checked npm install -g "pnpm@$PnpmVersion"
}
Invoke-Checked pnpm.cmd --version

Install-WingetPackageIfMissing -Id "Microsoft.EdgeWebView2Runtime" -CheckRegistryPath "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if ($InstallVsBuildTools) {
  Install-WingetPackageIfMissing -Id "Microsoft.VisualStudio.2022.BuildTools" -ExtraArgs @(
    "--override", "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
  )
} elseif (-not (Test-Path $vswhere)) {
  Write-Warning "vswhere.exe not found. Skipping VS Build Tools install (Rust builds already work here). Use -InstallVsBuildTools to force install."
}

Install-WingetPackageIfMissing -Id "NSIS.NSIS" -CheckCommand "makensis"
try {
  Install-WingetPackageIfMissing -Id "WiXToolset.WiXToolset" -CheckCommand "candle"
} catch {
  Write-Warning "WiX install failed (continuing; NSIS packaging remains supported). $($_.Exception.Message)"
}

if (-not $SkipRepoInstall) {
  Invoke-Checked pnpm.cmd install
  Invoke-Checked pnpm.cmd exec playwright install chromium
}

Write-Host "[bootstrap] completed successfully"
