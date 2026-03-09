#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

$script:RipgrepAvailable = $null

function Get-ExcludeGlobs {
  param([string[]]$ExtraArgs)

  $excludeGlobs = @()
  for ($index = 0; $index -lt $ExtraArgs.Count; $index += 1) {
    if ($ExtraArgs[$index] -ne "--glob") {
      continue
    }

    if ($index + 1 -ge $ExtraArgs.Count) {
      break
    }

    $glob = $ExtraArgs[$index + 1]
    if ($glob.StartsWith("!")) {
      $excludeGlobs += $glob.Substring(1)
    }

    $index += 1
  }

  return $excludeGlobs
}

function Test-IsExcludedPath {
  param(
    [string]$RelativePath,
    [string[]]$ExcludeGlobs
  )

  foreach ($glob in $ExcludeGlobs) {
    $wildcard = [System.Management.Automation.WildcardPattern]::new(
      $glob,
      [System.Management.Automation.WildcardOptions]::IgnoreCase
    )
    if ($wildcard.IsMatch($RelativePath)) {
      return $true
    }
  }

  return $false
}

function Get-RelativePathCompat {
  param(
    [string]$BasePath,
    [string]$FullPath
  )

  try {
    return [System.IO.Path]::GetRelativePath($BasePath, $FullPath)
  } catch {
    $normalizedBase = $BasePath.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    $baseUri = New-Object System.Uri($normalizedBase)
    $fullUri = New-Object System.Uri($FullPath)
    return [System.Uri]::UnescapeDataString($baseUri.MakeRelativeUri($fullUri).ToString())
  }
}

function Invoke-FallbackCheck {
  param(
    [string]$Pattern,
    [string[]]$Paths,
    [string[]]$ExtraArgs
  )

  $excludeGlobs = Get-ExcludeGlobs -ExtraArgs $ExtraArgs
  $workspaceRoot = (Get-Location).Path
  $matches = New-Object System.Collections.Generic.List[string]

  foreach ($path in $Paths) {
    if (-not (Test-Path -Path $path)) {
      continue
    }

    $files = Get-ChildItem -Path $path -Recurse -File |
      Where-Object { $_.Extension -in @('.ts', '.tsx') }

    foreach ($file in $files) {
      $relativePath = Get-RelativePathCompat -BasePath $workspaceRoot -FullPath $file.FullName
      $relativePath = $relativePath -replace '\\', '/'

      if (Test-IsExcludedPath -RelativePath $relativePath -ExcludeGlobs $excludeGlobs) {
        continue
      }

      $fileMatches = Select-String -Path $file.FullName -Pattern $Pattern -CaseSensitive
      foreach ($match in $fileMatches) {
        $line = ""
        if ($null -ne $match.Line) {
          $line = ([string]$match.Line).Trim()
        }
        $matches.Add("${relativePath}:$($match.LineNumber):$line")
      }
    }
  }

  if ($matches.Count -gt 0) {
    return @{ Found = $true; Output = $matches }
  }

  return @{ Found = $false; Output = @() }
}

function Invoke-PatternCheck {
  param(
    [string]$Pattern,
    [string[]]$Paths,
    [string[]]$ExtraArgs
  )

  if ($null -eq $script:RipgrepAvailable) {
    try {
      $null = & rg --version 2>$null
      $script:RipgrepAvailable = ($LASTEXITCODE -eq 0)
    } catch {
      $script:RipgrepAvailable = $false
    }
  }

  if ($script:RipgrepAvailable) {
    $args = @("--line-number", "--glob", "*.ts", "--glob", "*.tsx") + $ExtraArgs + @($Pattern) + $Paths
    try {
      $output = & rg @args 2>&1
      $exitCode = $LASTEXITCODE

      if ($exitCode -eq 0) {
        return @{ Found = $true; Output = $output }
      }

      if ($exitCode -eq 1) {
        return @{ Found = $false; Output = @() }
      }

      Write-Warning "rg failed with exit code $exitCode. Falling back to Select-String."
      $script:RipgrepAvailable = $false
    } catch {
      Write-Warning "rg could not run in this environment. Falling back to Select-String."
      $script:RipgrepAvailable = $false
    }
  }

  return Invoke-FallbackCheck -Pattern $Pattern -Paths $Paths -ExtraArgs $ExtraArgs
}

function Invoke-RgCheck {
  param(
    [string]$Name,
    [string]$Pattern,
    [string[]]$Paths,
    [string[]]$ExtraArgs = @()
  )

  $result = Invoke-PatternCheck -Pattern $Pattern -Paths $Paths -ExtraArgs $ExtraArgs

  if ($result.Found) {
    Write-Host "[FAIL] $Name" -ForegroundColor Red
    Write-Host ($result.Output -join [Environment]::NewLine)
    return 1
  }

  Write-Host "[PASS] $Name" -ForegroundColor Green
  return 0
}

$violations = 0

$violations += Invoke-RgCheck -Name "No raw @tauri-apps/api imports outside adapters" -Pattern "@tauri-apps/api" -Paths @("apps/desktop/src") -ExtraArgs @(
  "--glob", "!apps/desktop/src/services/tauri/**",
  "--glob", "!apps/desktop/src/infrastructure/tauri/**",
  "--glob", "!**/*.test.ts",
  "--glob", "!**/*.test.tsx"
)

$violations += Invoke-RgCheck -Name "player-transport must not import audio-output internals" -Pattern "features/audio-output/(hooks|model|services|components)/" -Paths @("apps/desktop/src/features/player-transport")

$violations += Invoke-RgCheck -Name "audio-output must not import player-transport internals" -Pattern "features/player-transport/(hooks|model|services|components)/" -Paths @("apps/desktop/src/features/audio-output")

$violations += Invoke-RgCheck -Name "app shell must not deep-import feature internals" -Pattern "features/.+/(hooks|model|services|components)/" -Paths @("apps/desktop/src/app/shell") -ExtraArgs @(
  "--glob", "!**/*.test.ts",
  "--glob", "!**/*.test.tsx"
)

if ($violations -gt 0) {
  Write-Host "Boundary checks failed with $violations violation set(s)." -ForegroundColor Red
  exit 1
}

Write-Host "Boundary checks passed." -ForegroundColor Green
