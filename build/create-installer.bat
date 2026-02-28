@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%make-exe.ps1"

if not exist "%PS_SCRIPT%" (
  echo BUILD FAILED. Tail of log:
  echo make-exe.ps1 not found in build directory.
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" -Mode release
exit /b %ERRORLEVEL%

