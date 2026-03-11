param(
  [switch]$SkipInstall,
  [switch]$SkipRuntimeE2E
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
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$corepackShimDir = if ($nodeCommand) {
  Join-Path (Split-Path $nodeCommand.Source -Parent) "node_modules\corepack\shims"
} else {
  $null
}
$extraBins = @(
  "$env:USERPROFILE\.cargo\bin",
  "$env:APPDATA\npm",
  $corepackShimDir,
  "${env:ProgramFiles(x86)}\NSIS",
  "$env:ProgramFiles\NSIS",
  "${env:ProgramFiles(x86)}\WiX Toolset v3.14\bin",
  "$env:ProgramFiles\WiX Toolset v3.14\bin"
) | Where-Object { $_ -and (Test-Path $_) }
$env:PATH = (($extraBins + @($env:PATH)) -join ";")
if (-not (Get-Command pnpm.cmd -ErrorAction SilentlyContinue)) {
  throw "pnpm.cmd was not found on PATH after adding the Corepack shims directory."
}

if (-not $SkipInstall) {
  Invoke-Checked -FilePath pnpm.cmd -Arguments @("install")
  Invoke-Checked -FilePath pnpm.cmd -Arguments @("exec", "playwright", "install", "chromium")
}

Invoke-Checked -FilePath cargo -Arguments @("fmt", "--all", "--", "--check")
Invoke-Checked -FilePath cargo -Arguments @("clippy", "--all-targets", "--all-features", "--", "-D", "warnings")
Invoke-Checked -FilePath cargo -Arguments @("test", "--all", "--all-features")

Invoke-Checked -FilePath pnpm.cmd -Arguments @("lint")
Invoke-Checked -FilePath pnpm.cmd -Arguments @("typecheck")
Invoke-Checked -FilePath pnpm.cmd -Arguments @("--filter", "@release-publisher/desktop", "test", "--", "--run")
Invoke-Checked -FilePath pnpm.cmd -Arguments @("test:e2e")

& (Join-Path $PSScriptRoot "build-package-windows.ps1") -SkipInstall
if ($LASTEXITCODE -ne 0) {
  throw "build-package-windows.ps1 failed ($LASTEXITCODE)"
}

if (-not $SkipRuntimeE2E) {
  $today = Get-Date -Format "yyyyMMdd"
  $exe = Join-Path $repoRoot ("artifacts\\windows\\$today\\Skald.exe")
  if (-not (Test-Path $exe)) {
    $exe = Join-Path $repoRoot "target\release\Skald.exe"
  }
  & (Join-Path $PSScriptRoot "runtime-e2e\run-tauri-runtime-e2e.ps1") -AppExePath $exe -SkipBuild
  if ($LASTEXITCODE -ne 0) {
    throw "run-tauri-runtime-e2e.ps1 failed ($LASTEXITCODE)"
  }
}

Write-Host "[validate-release] completed"

