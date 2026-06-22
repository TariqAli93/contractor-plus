; ============================================================================
; installer-include.nsh
;
; electron-builder NSIS macro hooks for the ContractorPlusBackend Windows
; Service. Mirrors the nuqta-plus model:
;
; - customInstall:   after files are copied — register the backend service via
;                    the bundled WinSW host. If the service has ALREADY been
;                    provisioned (service.json exists) it (re)installs + starts
;                    it via install-service.cmd (which logs + waits for RUNNING).
;                    On a FIRST install (no service.json yet) it registers the
;                    service as MANUAL and DEFERS the start to the setup wizard,
;                    so the backend never crash-loops against a missing config.
;                    A failed START never aborts the install.
; - customUnInstall: stop the service; only fully REMOVE it on a real uninstall
;                    (via uninstall-service.cmd). During an electron-updater
;                    UPDATE (${isUpdated}) we only stop it — deleting during the
;                    update window is what made the service "disappear after
;                    update". %ProgramData%\ContractorPlus is always preserved.
;
; Service binary : $INSTDIR\resources\backend\ContractorPlusBackend.exe (WinSW)
; Descriptor     : $INSTDIR\resources\backend\ContractorPlusBackend.xml
; Loopback port  : 31734 (mirrors PROD_PORT in electron/scripts/runtime.js)
; Service logs   : %ProgramData%\ContractorPlus\logs\installer-service.log
;                  %ProgramData%\ContractorPlus\logs\uninstall-service.log
; afterPack.cjs verifies all of the above ship before NSIS runs.
; ============================================================================

!define CP_SERVICE_NAME    "ContractorPlusBackend"
!define CP_SERVICE_BACKEND "$INSTDIR\resources\backend"
!define CP_SERVICE_BIN     "${CP_SERVICE_BACKEND}\${CP_SERVICE_NAME}.exe"
!define CP_SERVICE_SCRIPTS "${CP_SERVICE_BACKEND}\service"

; ----------------------------------------------------------------------------
; CpLogInstaller - append one timestamped line to installer-service.log so the
; NSIS-side decisions (e.g. "deferred to wizard") land in the same dedicated log
; install-service.cmd writes to. Ensures the log dir exists first. Best-effort.
; ----------------------------------------------------------------------------
!macro CpLogInstaller msg
  nsExec::ExecToLog 'cmd /c if not exist "%ProgramData%\ContractorPlus\logs" mkdir "%ProgramData%\ContractorPlus\logs"'
  Pop $0
  nsExec::ExecToLog 'cmd /c echo [installer-nsh] ${msg}>>"%ProgramData%\ContractorPlus\logs\installer-service.log"'
  Pop $0
!macroend

; ----------------------------------------------------------------------------
; CpFreeBackendPort - kill any process still LISTENING on 127.0.0.1:31734.
; The kill logic lives in the shipped service\free-port.ps1 so NSIS never has to
; expand a PowerShell $-token, and the "nothing to kill" path stays exit 0.
; ----------------------------------------------------------------------------
!macro CpFreeBackendPort
  DetailPrint "[ContractorPlus] freeing backend port 31734 (killing any stale listener)..."
  IfFileExists "${CP_SERVICE_SCRIPTS}\free-port.ps1" 0 +3
    nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "${CP_SERVICE_SCRIPTS}\free-port.ps1"'
    Pop $0
!macroend

; ----------------------------------------------------------------------------
; CpStopBackendService - stop the service with a BOUNDED wait, then free the
; port. stop-wait.ps1 polls until STOPPED or -TimeoutSec elapses (sc stop is
; async); free-port.ps1 is the hard backstop for any survivor on 127.0.0.1:31734.
; The timeout keeps the installer/uninstaller UI from ever hanging.
; ----------------------------------------------------------------------------
!macro CpStopBackendService timeoutSec
  DetailPrint "[ContractorPlus] stopping backend service (bounded wait ${timeoutSec}s)..."
  IfFileExists "${CP_SERVICE_SCRIPTS}\stop-wait.ps1" 0 +3
    nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "${CP_SERVICE_SCRIPTS}\stop-wait.ps1" -TimeoutSec ${timeoutSec}'
    Pop $0
  !insertmacro CpFreeBackendPort
!macroend

; ----------------------------------------------------------------------------
; customInstall - register the backend service. Runs elevated (perMachine
; installer carries RequestExecutionLevel admin).
; ----------------------------------------------------------------------------
!macro customInstall
  DetailPrint "[ContractorPlus] configuring backend Windows Service..."

  ; Release any running instance + the port so the new files are the only
  ; responder. Bounded to 5s — the installer UI must never hang.
  !insertmacro CpStopBackendService 5

  IfFileExists "${CP_SERVICE_BIN}" +3 0
    DetailPrint "[ContractorPlus] ERROR: ${CP_SERVICE_BIN} not found - aborting service install"
    Goto cpSkipServiceInstall

  ; Provisioned? %ProgramData%\ContractorPlus\config\service.json only exists
  ; AFTER the setup wizard finalizes. On a FIRST install it does NOT exist yet.
  ExpandEnvStrings $R0 "%ProgramData%\ContractorPlus\config\service.json"
  IfFileExists "$R0" cpProvisioned cpNotProvisioned

  cpProvisioned:
    ; BEST-EFFORT only: register/refresh + async start, then return immediately.
    ; The installer must NEVER wait for RUNNING / migrations / health — that is
    ; what hung the UI. The Electron app owns readiness on launch (ensure service
    ; → wait health/version → repair). install-service.cmd --best-effort caps its
    ; own work at a few seconds and always exits 0, logging to installer-service.log.
    ; Doubled outer quotes: cmd /c strips a single outer quote-pair, which would
    ; break a path containing spaces (e.g. C:\Program Files\ContractorPlus).
    DetailPrint "[ContractorPlus] service config present - best-effort register + async start"
    nsExec::ExecToLog 'cmd /c ""${CP_SERVICE_SCRIPTS}\install-service.cmd"" --best-effort'
    Pop $0
    Goto cpInstallDone

  cpNotProvisioned:
    ; FIRST install — service.json does not exist yet. Register the service so it
    ; is present, but as MANUAL (demand) so it neither starts now NOR auto-starts
    ; on next boot before the wizard provisions service.json. Starting against a
    ; missing config would just crash-loop the backend with "config not found".
    !insertmacro CpLogInstaller "first install - service.json absent; registering MANUAL, deferring start to setup wizard"
    DetailPrint "[ContractorPlus] not provisioned yet - registering as MANUAL; setup wizard will start it"

    nsExec::ExecToLog 'sc.exe query "${CP_SERVICE_NAME}"'
    Pop $0
    IntCmp $0 0 cpDeferExists cpDeferInstall cpDeferInstall

    cpDeferInstall:
      DetailPrint "[ContractorPlus] service not registered - installing via WinSW (deferred start)"
      nsExec::ExecToLog '"${CP_SERVICE_BIN}" install'
      Pop $0
      IntCmp $0 0 +3 0 0
        DetailPrint "[ContractorPlus] ERROR: WinSW install failed (exit $0)"
        Goto cpSkipServiceInstall

      ; Grant BUILTIN\Users (BU) + INTERACTIVE (IU) start/stop/query so the
      ; non-elevated desktop client can manage the service; Admins/SYSTEM full.
      nsExec::ExecToLog 'sc.exe sdset "${CP_SERVICE_NAME}" "D:(A;;CCLCSWRPWPDTLOCRRC;;;BU)(A;;CCLCSWRPWPDTLOCRRC;;;IU)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;SY)S:(AU;FA;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;WD)"'
      Pop $0

      ; Let non-admin users update the backend bundle in place (backend dir only).
      nsExec::ExecToLog 'icacls.exe "${CP_SERVICE_BACKEND}" /grant "*S-1-5-32-545:(OI)(CI)(M)" /T /C'
      Pop $0
      Goto cpDeferConfig

    cpDeferExists:
      DetailPrint "[ContractorPlus] service already registered - leaving config, deferring start"

    cpDeferConfig:
      ; MANUAL so it does NOT auto-start before the wizard writes service.json.
      nsExec::ExecToLog 'sc.exe config "${CP_SERVICE_NAME}" start= demand'
      Pop $0

  cpInstallDone:
    DetailPrint "[ContractorPlus] backend service configured"

    ; Best-effort post-install version check (never aborts).
    IfFileExists "${CP_SERVICE_SCRIPTS}\verify-version.ps1" 0 cpDoneVerify
      nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "${CP_SERVICE_SCRIPTS}\verify-version.ps1"'
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
; %ProgramData%\ContractorPlus (config/data/logs) is NEVER deleted here.
; ----------------------------------------------------------------------------
!macro customUnInstall
  ${if} ${isUpdated}
    DetailPrint "[ContractorPlus] update in progress - stopping service but PRESERVING its registration"
    !insertmacro CpStopBackendService 10
  ${else}
    DetailPrint "[ContractorPlus] uninstall - removing backend Windows Service..."

    ; Prefer the shipped script: stops (waits STOPPED), removes, logs to
    ; uninstall-service.log, and is graceful when the service is already gone.
    ; Fall back to inline sc if the script is somehow missing.
    IfFileExists "${CP_SERVICE_SCRIPTS}\uninstall-service.cmd" 0 cpUninstInline
      ; Doubled outer quotes — see install path above (spaces in $INSTDIR).
      nsExec::ExecToLog 'cmd /c ""${CP_SERVICE_SCRIPTS}\uninstall-service.cmd""'
      Pop $0
      !insertmacro CpFreeBackendPort
      Goto cpUninstDone

    cpUninstInline:
      !insertmacro CpStopBackendService 10
      IfFileExists "${CP_SERVICE_BIN}" 0 +3
        nsExec::ExecToLog '"${CP_SERVICE_BIN}" uninstall'
        Pop $0
      nsExec::ExecToLog 'sc.exe delete "${CP_SERVICE_NAME}"'
      Pop $0

    cpUninstDone:
    DetailPrint "[ContractorPlus] backend service removed (ProgramData preserved)"
  ${endif}
!macroend
