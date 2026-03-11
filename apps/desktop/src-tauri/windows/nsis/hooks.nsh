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
!macroend
