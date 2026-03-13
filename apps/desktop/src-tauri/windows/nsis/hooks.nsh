!define RP_CLEANUP_REG_KEY "Software\\ReleasePublisher\\Desktop"

!macro NSIS_HOOK_POSTINSTALL
  ; Persist a best-effort workspace root when installing from a developer build tree.
  ; This lets post-uninstall cleanup reclaim generated build artifacts in that workspace.
  IfFileExists "$EXEDIR\..\..\..\..\scripts\clean-workspace.ps1" 0 +2
    WriteRegStr HKCU "${RP_CLEANUP_REG_KEY}" "WorkspaceRoot" "$EXEDIR\..\..\..\.."

  IfFileExists "$EXEDIR\..\..\..\..\..\..\..\scripts\clean-workspace.ps1" 0 +2
    WriteRegStr HKCU "${RP_CLEANUP_REG_KEY}" "WorkspaceRoot" "$EXEDIR\..\..\..\..\..\..\.."
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Remove per-user app data and cache folders created by Skald.
  RMDir /r "$APPDATA\\com.releasepublisher.desktop"
  RMDir /r "$LOCALAPPDATA\\com.releasepublisher.desktop"
  RMDir /r "$APPDATA\\Release Publisher"
  RMDir /r "$LOCALAPPDATA\\Release Publisher"
  RMDir /r "$LOCALAPPDATA\\release-publisher-desktop"
  RMDir /r "$APPDATA\\Skald"
  RMDir /r "$LOCALAPPDATA\\Skald"
  RMDir /r "$LOCALAPPDATA\\skald-desktop"

  ; Best-effort workspace cleanup for developer machines.
  ; 1) Use persisted install-time workspace root when available.
  ReadRegStr $0 HKCU "${RP_CLEANUP_REG_KEY}" "WorkspaceRoot"
  StrCmp $0 "" +4
  IfFileExists "$0\scripts\clean-workspace.ps1" 0 +2
    nsExec::ExecToLog '"$SYSDIR\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$0\scripts\clean-workspace.ps1"'

  ; 2) Fallback to explicit environment override.
  ReadEnvStr $1 "RELEASE_PUBLISHER_WORKSPACE"
  StrCmp $1 "" +4
  IfFileExists "$1\scripts\clean-workspace.ps1" 0 +2
    nsExec::ExecToLog '"$SYSDIR\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$1\scripts\clean-workspace.ps1"'

  DeleteRegValue HKCU "${RP_CLEANUP_REG_KEY}" "WorkspaceRoot"
!macroend
