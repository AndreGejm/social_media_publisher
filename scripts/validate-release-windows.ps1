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
  $exe = Join-Path $repoRoot ("artifacts\\windows\\$today\\release-publisher-desktop.exe")
  if (-not (Test-Path $exe)) {
    $exe = Join-Path $repoRoot "target\release\release-publisher-desktop.exe"
  }
  & (Join-Path $PSScriptRoot "runtime-e2e\run-tauri-runtime-e2e.ps1") -AppExePath $exe -SkipBuild
  if ($LASTEXITCODE -ne 0) {
    throw "run-tauri-runtime-e2e.ps1 failed ($LASTEXITCODE)"
  }
}

Write-Host "[validate-release] completed"
