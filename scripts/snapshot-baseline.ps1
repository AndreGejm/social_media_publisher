param(
  [string]$Prefix = "rev_phase6_baseline"
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

$timestamp = Get-Date -Format "yyyyMMdd_HHmm"
$tag = "${Prefix}_$timestamp"
$archiveDir = Join-Path $repoRoot "revisions"
$archivePath = Join-Path $archiveDir "$tag.zip"

if (-not (Test-Path ".git")) {
  Invoke-Checked git init
  Invoke-Checked git config user.name "Local Baseline"
  Invoke-Checked git config user.email "local-baseline@example.invalid"
}

if ((git status --porcelain).Length -gt 0) {
  Write-Host "[snapshot] working tree has changes; creating snapshot commit/tag from current state"
}

Invoke-Checked git add -A
try {
  Invoke-Checked git commit -m "Baseline snapshot $tag"
} catch {
  Write-Host "[snapshot] no new commit created (possibly no changes)"
}
if (git tag -l $tag) {
  throw "Tag $tag already exists"
}
Invoke-Checked git tag $tag

New-Item -ItemType Directory -Force $archiveDir | Out-Null
if (Test-Path $archivePath) {
  Remove-Item $archivePath -Force
}

Invoke-Checked tar.exe -a -cf $archivePath --exclude=.git --exclude=target --exclude=node_modules --exclude=dist --exclude=build --exclude=revisions .

Write-Host "[snapshot] tag: $tag"
Write-Host "[snapshot] archive: $archivePath"
