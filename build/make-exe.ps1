param(
    [Parameter(Mandatory = $false)]
    [string]$Mode = "release"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-UsageError {
    Write-Output "USAGE ERROR: .\build\make-exe.ps1 -Mode <release|debug>"
    exit 1
}

if (-not ($Mode -in @("release", "debug"))) {
    Write-UsageError
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$logsDir = Join-Path $PSScriptRoot "logs"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

$dateStamp = Get-Date -Format "yyyyMMdd"
$timeStamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
$logFile = Join-Path $logsDir ("build_{0}.log" -f $dateStamp)

function Assert-Tool([string]$toolName) {
    if (-not (Get-Command $toolName -ErrorAction SilentlyContinue)) {
        "[$timeStamp] FAIL missing tool: $toolName" | Out-File -FilePath $logFile -Append -Encoding utf8
        Write-Output "BUILD FAILED. Tail of log:"
        Get-Content -Path $logFile -Tail 15 | ForEach-Object { Write-Output $_ }
        exit 1
    }
}

function Assert-Path([string]$pathToCheck) {
    if (-not (Test-Path $pathToCheck)) {
        "[$timeStamp] FAIL missing path: $pathToCheck" | Out-File -FilePath $logFile -Append -Encoding utf8
        Write-Output "BUILD FAILED. Tail of log:"
        Get-Content -Path $logFile -Tail 15 | ForEach-Object { Write-Output $_ }
        exit 1
    }
}

# Defensive validation: toolchain + required project files.
Assert-Tool "pnpm"
Assert-Tool "cargo"
Assert-Tool "rustc"
Assert-Path (Join-Path $projectRoot "Cargo.toml")
Assert-Path (Join-Path $projectRoot "apps/desktop/src-tauri/tauri.conf.json")
Assert-Path (Join-Path $projectRoot "apps/desktop/src-tauri/Cargo.toml")

$start = Get-Date
"[$timeStamp] BUILD START mode=$Mode cwd=$projectRoot" | Out-File -FilePath $logFile -Append -Encoding utf8

Push-Location $projectRoot
try {
    $priorCargoOffline = $env:CARGO_NET_OFFLINE
    if ($priorCargoOffline) {
        Remove-Item Env:CARGO_NET_OFFLINE -ErrorAction SilentlyContinue
        "[$(Get-Date -Format "yyyy-MM-ddTHH:mm:ssK")] INFO cleared CARGO_NET_OFFLINE for build" | Out-File -FilePath $logFile -Append -Encoding utf8
    }

    $buildCommand = if ($Mode -eq "release") {
        "pnpm --filter @release-publisher/desktop tauri build"
    } else {
        "pnpm --filter @release-publisher/desktop tauri build --debug"
    }

    # Silence compiler output to console; append all output to log.
    & cmd /c "$buildCommand >> `"$logFile`" 2>&1"
    $exitCode = $LASTEXITCODE

    if ($exitCode -ne 0) {
        "[$(Get-Date -Format "yyyy-MM-ddTHH:mm:ssK")] BUILD FAIL mode=$Mode exit=$exitCode" | Out-File -FilePath $logFile -Append -Encoding utf8
        Write-Output "BUILD FAILED. Tail of log:"
        Get-Content -Path $logFile -Tail 15 | ForEach-Object { Write-Output $_ }
        exit 1
    }

    $targetDirs = if ($Mode -eq "release") {
        @(
            (Join-Path $projectRoot "target/release/bundle/nsis"),
            (Join-Path $projectRoot "apps/desktop/src-tauri/target/release/bundle/nsis"),
            (Join-Path $projectRoot "target/release"),
            (Join-Path $projectRoot "apps/desktop/src-tauri/target/release")
        )
    } else {
        @(
            (Join-Path $projectRoot "target/debug"),
            (Join-Path $projectRoot "apps/desktop/src-tauri/target/debug")
        )
    }

    $exeCandidates = @()
    foreach ($dir in $targetDirs) {
        if (Test-Path $dir) {
            $exeCandidates += Get-ChildItem -Path $dir -Filter "*.exe" -Recurse -File -ErrorAction SilentlyContinue
        }
    }

    $installer = $exeCandidates |
        Where-Object {
            $_.FullName -match "\\bundle\\nsis\\" -and
            (
                $_.Name -match "(?i)(setup|installer)" -or
                $_.DirectoryName -match "(?i)nsis"
            )
        } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    $artifact = if ($installer) {
        $installer
    } else {
        $exeCandidates | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    }

    if (-not $artifact) {
        "[$(Get-Date -Format "yyyy-MM-ddTHH:mm:ssK")] BUILD FAIL mode=$Mode reason=no_exe_found" | Out-File -FilePath $logFile -Append -Encoding utf8
        Write-Output "BUILD FAILED. Tail of log:"
        Get-Content -Path $logFile -Tail 15 | ForEach-Object { Write-Output $_ }
        exit 1
    }

    $duration = [math]::Round(((Get-Date) - $start).TotalSeconds, 2)
    "[$(Get-Date -Format "yyyy-MM-ddTHH:mm:ssK")] BUILD SUCCESS mode=$Mode exe=$($artifact.FullName) duration_s=$duration" | Out-File -FilePath $logFile -Append -Encoding utf8
    Write-Output ("BUILD SUCCESS: {0} | Time: {1}s" -f $artifact.FullName, $duration)
    exit 0
}
finally {
    if ($null -ne $priorCargoOffline) {
        $env:CARGO_NET_OFFLINE = $priorCargoOffline
    }
    Pop-Location
}
