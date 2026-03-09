param(
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$removed = New-Object System.Collections.Generic.List[string]

function Remove-Entry([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  if ($DryRun) {
    Write-Host "[dry-run] remove $Path"
    return
  }

  try {
    Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
  } catch {
    if ((Test-Path -LiteralPath $Path) -and (Get-Item -LiteralPath $Path).PSIsContainer) {
      cmd /c rmdir /s /q "$Path" | Out-Null
    }
    if (Test-Path -LiteralPath $Path) {
      throw
    }
  }
  $removed.Add($Path) | Out-Null
  Write-Host "removed $Path"
}

$directPaths = @(
  'node_modules',
  'apps/desktop/node_modules',
  'target',
  'apps/desktop/dist',
  'playwright-report',
  'playwright-report-runtime',
  'test-results',
  'test-results-runtime2',
  '.runtime-e2e-temp',
  '.agent-tmp',
  'tmp_perm_dir',
  'build/artifacts_test',
  'scripts/windows/logs',
  'artifacts/windows'
)

$directPaths | ForEach-Object { Remove-Entry $_ }

Get-ChildItem -Force -Name | Where-Object { $_ -like '_tmp_*' } | ForEach-Object { Remove-Entry $_ }
Get-ChildItem -Force -Directory -Name | Where-Object {
  $_ -like 'target-*' -or $_ -like 'target_agent*' -or $_ -like 'target-agent*' -or $_ -like 'target-clippy*' -or $_ -like '_push_workspace*'
} | ForEach-Object { Remove-Entry $_ }

Get-ChildItem -Force -Directory -Path 'apps/desktop' -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like 'target-*' } |
  ForEach-Object { Remove-Entry $_.FullName }

Get-ChildItem -Force -Directory -Path 'apps/desktop/src-tauri' -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like '.tmp-*' } |
  ForEach-Object { Remove-Entry $_.FullName }

# Keep archives content, but strip generated artifacts if any were copied in.
if (Test-Path 'archives') {
  Get-ChildItem -Recurse -Directory 'archives' -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Name -in @('node_modules', 'dist', 'target', 'build', '.cache', '.turbo', '.vite', 'test-results', 'playwright-report') -or
      $_.Name -like 'target-*' -or
      $_.Name -like '.tmp-*'
    } |
    Sort-Object FullName -Descending |
    ForEach-Object { Remove-Entry $_.FullName }
}

if ($DryRun) {
  Write-Host '[dry-run] cleanup scan complete'
} else {
  Write-Host "cleanup complete; removed $($removed.Count) paths"
}




