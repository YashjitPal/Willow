; Willow's installer hooks (`bundle > windows > nsis > installerHooks` in tauri.conf.json).
;
; The uninstaller's "Delete the application data" removes %APPDATA% and %LOCALAPPDATA%\<identifier>
; whole. Three things in them have no other copy and aren't settings Willow can rebuild: the agents'
; folders (their worktrees, scratch space and the projects they started), the bots' Linux computer (a
; disk WSL keeps registered at its path), and which Willow folder the user picked. They are set aside
; before the app data goes and put back at the same paths after, so the worktrees' links and the
; computer's registration still hold for the next install. The rest of the app data is deleted as asked.
; When one can't be set aside (still in use), the app data is kept whole rather than deleted around it.
; Willow puts back anything left set aside when it next starts (`put_back_set_aside` in main.rs).

Var WillowSetAside

!macro WillowSetAside from to name
  ${If} ${FileExists} "${from}\${name}"
    ClearErrors
    Rename "${from}\${name}" "${to}\${name}"
    ${If} ${Errors}
      StrCpy $DeleteAppDataCheckboxState 0
      DetailPrint "Kept Willow's data: ${from}\${name} is in use."
    ${EndIf}
  ${EndIf}
!macroend

!macro WillowPutBack from to name
  ${If} ${FileExists} "${from}\${name}"
    Rename "${from}\${name}" "${to}\${name}"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  StrCpy $WillowSetAside 0
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    !insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
    ; A running computer holds its disk open. Only Willow's own distro is named, never the user's.
    ; (A build of these hooks for a test defines WILLOW_HOOKS_LEAVE_WSL, so a real computer runs on.)
    !ifndef WILLOW_HOOKS_LEAVE_WSL
      ${If} ${FileExists} "$WINDIR\Sysnative\wsl.exe"
        nsExec::Exec '"$WINDIR\Sysnative\wsl.exe" --terminate Willow-Computer'
        Pop $0
      ${ElseIf} ${FileExists} "$SYSDIR\wsl.exe"
        nsExec::Exec '"$SYSDIR\wsl.exe" --terminate Willow-Computer'
        Pop $0
      ${EndIf}
    !endif
    StrCpy $WillowSetAside 1
    CreateDirectory "$LOCALAPPDATA\${BUNDLEID}.kept"
    CreateDirectory "$APPDATA\${BUNDLEID}.kept"
    !insertmacro WillowSetAside "$LOCALAPPDATA\${BUNDLEID}" "$LOCALAPPDATA\${BUNDLEID}.kept" "agents"
    !insertmacro WillowSetAside "$LOCALAPPDATA\${BUNDLEID}" "$LOCALAPPDATA\${BUNDLEID}.kept" "computers"
    !insertmacro WillowSetAside "$APPDATA\${BUNDLEID}" "$APPDATA\${BUNDLEID}.kept" "local-folder.json"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $WillowSetAside = 1
    CreateDirectory "$LOCALAPPDATA\${BUNDLEID}"
    CreateDirectory "$APPDATA\${BUNDLEID}"
    !insertmacro WillowPutBack "$LOCALAPPDATA\${BUNDLEID}.kept" "$LOCALAPPDATA\${BUNDLEID}" "agents"
    !insertmacro WillowPutBack "$LOCALAPPDATA\${BUNDLEID}.kept" "$LOCALAPPDATA\${BUNDLEID}" "computers"
    !insertmacro WillowPutBack "$APPDATA\${BUNDLEID}.kept" "$APPDATA\${BUNDLEID}" "local-folder.json"
    RMDir "$LOCALAPPDATA\${BUNDLEID}.kept"
    RMDir "$APPDATA\${BUNDLEID}.kept"
  ${EndIf}
!macroend
