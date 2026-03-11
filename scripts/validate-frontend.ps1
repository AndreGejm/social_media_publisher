<#
.SYNOPSIS
  Runs frontend validation (typecheck, lint, tests, build) with an optional boundary check.
.USAGE
  ./scripts/validate-frontend.ps1 [-Install] [-SkipBoundaryCheck] [-SkipBuild]
#>
param(
  [switch]$Install,
  [switch]$SkipBoundaryCheck,
  [switch]$SkipBuild
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

  if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    Invoke-Checked pnpm @Arguments
    return
  }

  if (-not (Get-Command corepack -ErrorAction SilentlyContinue)) {
    throw "pnpm or corepack must be available to run frontend validation"
  }

  if (-not $env:COREPACK_HOME) {
    $env:COREPACK_HOME = Join-Path (Get-Location) ".corepack"
  }
  if (-not (Test-Path $env:COREPACK_HOME)) {
    New-Item -ItemType Directory -Path $env:COREPACK_HOME -Force | Out-Null
  }

  Invoke-Checked corepack pnpm @Arguments
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

Write-Host "[validate-frontend] repo root: $repoRoot"

if ($Install) {
  Invoke-PnpmChecked @("install")
}

if (-not $SkipBoundaryCheck) {
  $boundaryScript = Join-Path $PSScriptRoot "check-boundaries.ps1"
  if (Test-Path $boundaryScript) {
    Invoke-Checked powershell -NoProfile -ExecutionPolicy Bypass -File $boundaryScript
  }
}

Invoke-PnpmChecked @("typecheck")
Invoke-PnpmChecked @("lint")
Invoke-PnpmChecked @("--filter", "@release-publisher/desktop", "test", "--", "--run")

if (-not $SkipBuild) {
  Invoke-PnpmChecked @("build")
}

Write-Host "[validate-frontend] completed"
