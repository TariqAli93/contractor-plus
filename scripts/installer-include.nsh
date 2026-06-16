; ============================================================================
; installer-include.nsh
;
; electron-builder NSIS macro hooks for the ContractorPlusBackend Windows
; Service. Mirrors the nuqta-plus model:
;
; - customInstall:   after files are copied — register + start the backend
;                    service via the bundled WinSW host. Idempotent; runs on
;                    both first install and update. NEVER deletes an existing
;                    registration. A failed START never aborts the install
;                    (the desktop self-heal / setup wizard recovers).
; - customUnInstall: stop the service; only fully REMOVE it on a real uninstall.
;                    During an electron-updater UPDATE (${isUpdated}) we only
;                    stop it — deleting during the update window is what made
;                    the service "disappear after update".
;
; Service binary : $INSTDIR\resources\backend\ContractorPlusBackend.exe (WinSW)
; Descriptor     : $INSTDIR\resources\backend\ContractorPlusBackend.xml
; Loopback port  : 31734 (mirrors PROD_PORT in electron/scripts/runtime.cjs)
; afterPack.cjs verifies all of the above ship before NSIS runs.
; ============================================================================

!define CP_SERVICE_NAME    "ContractorPlusBackend"
!define CP_SERVICE_BACKEND "$INSTDIR\resources\backend"
!define CP_SERVICE_BIN     "${CP_SERVICE_BACKEND}\${CP_SERVICE_NAME}.exe"

; ----------------------------------------------------------------------------
; CpFreeBackendPort - kill any process still LISTENING on 127.0.0.1:31734.
; The kill logic lives in the shipped service\free-port.ps1 so NSIS never has to
; expand a PowerShell $-token, and the "nothing to kill" path stays exit 0.
; ----------------------------------------------------------------------------
!macro CpFreeBackendPort
  DetailPrint "[ContractorPlus] freeing backend port 31734 (killing any stale listener)..."
  IfFileExists "${CP_SERVICE_BACKEND}\service\free-port.ps1" 0 +3
    nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "${CP_SERVICE_BACKEND}\service\free-port.ps1"'
    Pop $0
!macroend

; ----------------------------------------------------------------------------
; CpStopBackendService - stop the service, WAIT for STOPPED, then free the port.
; stop-wait.ps1 blocks until STOPPED (sc stop is async + WinSW stoptimeout);
; free-port.ps1 is the hard backstop for any survivor on 127.0.0.1:31734.
; ----------------------------------------------------------------------------
!macro CpStopBackendService
  DetailPrint "[ContractorPlus] stopping backend service (waiting for STOPPED)..."
  IfFileExists "${CP_SERVICE_BACKEND}\service\stop-wait.ps1" 0 +3
    nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "${CP_SERVICE_BACKEND}\service\stop-wait.ps1"'
    Pop $0
  !insertmacro CpFreeBackendPort
!macroend

; ----------------------------------------------------------------------------
; customInstall - idempotently install/refresh + start the backend service.
; Runs elevated (perMachine installer carries RequestExecutionLevel admin).
; ----------------------------------------------------------------------------
!macro customInstall
  DetailPrint "[ContractorPlus] configuring backend Windows Service..."

  ; Release any running instance + the port so the new files are the only responder.
  !insertmacro CpStopBackendService

  IfFileExists "${CP_SERVICE_BIN}" +3 0
    DetailPrint "[ContractorPlus] ERROR: ${CP_SERVICE_BIN} not found - aborting service install"
    Goto cpSkipServiceInstall

  ; Is the service already registered? (It survives updates.) sc query returns
  ; 0 when the service exists, 1060 otherwise.
  nsExec::ExecToLog 'sc.exe query "${CP_SERVICE_NAME}"'
  Pop $0
  IntCmp $0 0 cpSvcExists cpSvcMissing cpSvcMissing

  cpSvcExists:
    DetailPrint "[ContractorPlus] service already registered - refreshing config (no delete)"
    nsExec::ExecToLog 'sc.exe config "${CP_SERVICE_NAME}" binPath= "${CP_SERVICE_BIN}" start= delayed-auto'
    Pop $0
    Goto cpSvcStart

  cpSvcMissing:
    DetailPrint "[ContractorPlus] service not registered - installing via WinSW"
    nsExec::ExecToLog '"${CP_SERVICE_BIN}" install'
    Pop $0
    IntCmp $0 0 +3 0 0
      DetailPrint "[ContractorPlus] ERROR: WinSW install failed (exit $0)"
      Goto cpSkipServiceInstall

    nsExec::ExecToLog 'sc.exe config "${CP_SERVICE_NAME}" start= delayed-auto'
    Pop $0

    ; Grant BUILTIN\Users (BU) + INTERACTIVE (IU) start/stop/query so the
    ; non-elevated desktop client can manage the service; Admins/SYSTEM full.
    nsExec::ExecToLog 'sc.exe sdset "${CP_SERVICE_NAME}" "D:(A;;CCLCSWRPWPDTLOCRRC;;;BU)(A;;CCLCSWRPWPDTLOCRRC;;;IU)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;SY)S:(AU;FA;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;WD)"'
    Pop $0

    ; Let non-admin users update the backend bundle in place (backend dir only).
    nsExec::ExecToLog 'icacls.exe "${CP_SERVICE_BACKEND}" /grant "*S-1-5-32-545:(OI)(CI)(M)" /T /C'
    Pop $0

  cpSvcStart:
    ; Start now. On a FIRST install the service config (DB creds) does not exist
    ; yet — the setup wizard writes it and starts the service — so a failed start
    ; here is expected and must NOT abort the install.
    nsExec::ExecToLog 'sc.exe start "${CP_SERVICE_NAME}"'
    Pop $0
    IntCmp $0 0 +2 0 0
      DetailPrint "[ContractorPlus] service registered; start deferred to first-run setup / self-heal"

    DetailPrint "[ContractorPlus] backend service configured"

    ; Best-effort post-install version check (never aborts).
    IfFileExists "${CP_SERVICE_BACKEND}\service\verify-version.ps1" 0 cpDoneVerify
      nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "${CP_SERVICE_BACKEND}\service\verify-version.ps1"'
      Pop $0
    cpDoneVerify:

  cpSkipServiceInstall:
!macroend

; ----------------------------------------------------------------------------
; customUnInstall - stop the service; only REMOVE it on a real uninstall.
; During an electron-updater UPDATE the OLD uninstaller runs with --updated, so
; ${isUpdated} is TRUE: we must NOT delete the service (that is what made it
; disappear after updates). We only stop it so the atomic file-move of
; resources\backend succeeds; the new customInstall refreshes + restarts.
; ----------------------------------------------------------------------------
!macro customUnInstall
  ${if} ${isUpdated}
    DetailPrint "[ContractorPlus] update in progress - stopping service but PRESERVING its registration"
    !insertmacro CpStopBackendService
  ${else}
    DetailPrint "[ContractorPlus] uninstall - removing backend Windows Service..."
    !insertmacro CpStopBackendService

    IfFileExists "${CP_SERVICE_BIN}" 0 +3
      nsExec::ExecToLog '"${CP_SERVICE_BIN}" uninstall'
      Pop $0

    nsExec::ExecToLog 'sc.exe delete "${CP_SERVICE_NAME}"'
    Pop $0

    DetailPrint "[ContractorPlus] backend service removed"
  ${endif}
!macroend
