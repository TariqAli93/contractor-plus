@echo off
rem ============================================================================
rem  install-service.cmd  —  (re)install the ContractorPlusBackend Windows
rem  Service via the bundled WinSW host. Idempotent and elevation-aware.
rem
rem  MODES (first argument):
rem    --strict       (DEFAULT) Used by the setup wizard / repair. Clean
rem                   reinstall, start, then POLL until RUNNING (~40s) and FAIL
rem                   if it never reaches RUNNING. The user is inside the app and
rem                   sees progress, so a blocking, diagnostic install is correct.
rem    --best-effort  Used by the NSIS installer/upgrade. Register/refresh + start
rem                   the service, then RETURN IMMEDIATELY. NEVER polls RUNNING,
rem                   NEVER waits for migrations or /health. Bounded stop (5s) so
rem                   the installer UI never hangs; the Electron app owns
rem                   readiness (ensure → wait health/version → repair) on launch.
rem
rem  Lives at <resources>\backend\service\install-service.cmd. The WinSW wrapper
rem  and its descriptor sit one level up, next to the bundle root. Appends a
rem  timestamped transcript to
rem    %ProgramData%\ContractorPlus\logs\installer-service.log
rem ============================================================================
setlocal EnableExtensions EnableDelayedExpansion
set "SVC_NAME=ContractorPlusBackend"
set "SVC_DIR=%~dp0.."
set "SVC_EXE=%SVC_DIR%\ContractorPlusBackend.exe"

rem ── mode: default strict; NSIS passes --best-effort ──────────────────────
set "MODE=strict"
if /i "%~1"=="--best-effort" set "MODE=best-effort"
if /i "%~1"=="best-effort"   set "MODE=best-effort"
if /i "%~1"=="--strict"      set "MODE=strict"

rem ── dedicated installer log (timestamped). Never let logging failures abort. ─
set "LOG_DIR=%ProgramData%\ContractorPlus\logs"
set "LOG=%LOG_DIR%\installer-service.log"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1

call :log "=== install-service started (mode=!MODE!) ==="
call :log "SVC_EXE=%SVC_EXE%"

rem ── require elevation ────────────────────────────────────────────────────
net session >nul 2>&1
if errorlevel 1 (
  call :log "ERROR: administrator privileges are required."
  echo [install-service] ERROR: administrator privileges are required.
  set "RC=1"
  goto :finish
)

if not exist "%SVC_EXE%" (
  call :log "ERROR: WinSW host not found at %SVC_EXE%."
  echo [install-service] ERROR: WinSW host not found at "%SVC_EXE%".
  set "RC=1"
  goto :finish
)

rem ── bounded stop of any prior instance. best-effort = 5s so the installer UI
rem    never hangs; strict = 20s (wizard shows progress). ────────────────────
set "STOP_TIMEOUT=20"
if "!MODE!"=="best-effort" set "STOP_TIMEOUT=5"

sc.exe query "%SVC_NAME%" >nul 2>&1
if errorlevel 1 (
  set "SVC_EXISTED=0"
  call :log "service exists: NO"
) else (
  set "SVC_EXISTED=1"
  call :log "service exists: YES - stopping (timeout !STOP_TIMEOUT!s)"
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-wait.ps1" -TimeoutSec !STOP_TIMEOUT! >nul 2>&1
  call :log "stop result: exit=!errorlevel!"
)

if /i "!MODE!"=="best-effort" goto :register_besteffort
goto :register_strict

rem ============================================================================
rem  STRICT — clean reinstall, start, poll RUNNING, fail if not running.
rem ============================================================================
:register_strict
if "!SVC_EXISTED!"=="1" (
  "%SVC_EXE%" uninstall >nul 2>&1
  sc.exe delete "%SVC_NAME%" >nul 2>&1
  call :log "strict: removed old registration (delete exit=!errorlevel!)"
)

echo [install-service] installing WinSW service "%SVC_NAME%"...
"%SVC_EXE%" install
if errorlevel 1 (
  call :log "ERROR: WinSW install failed."
  echo [install-service] ERROR: WinSW install failed.
  set "RC=1"
  goto :finish
)
call :log "strict: WinSW install OK"

sc.exe config "%SVC_NAME%" start= delayed-auto >nul 2>&1
sc.exe sdset "%SVC_NAME%" "D:(A;;CCLCSWRPWPDTLOCRRC;;;BU)(A;;CCLCSWRPWPDTLOCRRC;;;IU)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;SY)S:(AU;FA;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;WD)" >nul 2>&1
icacls.exe "%SVC_DIR%" /grant "*S-1-5-32-545:(OI)(CI)(M)" /T /C >nul 2>&1

echo [install-service] starting service...
sc.exe start "%SVC_NAME%" >nul 2>&1

rem Poll for RUNNING so "started" means "actually running" (backend validates
rem service.json + runs migrate-on-boot before it reports RUNNING).
set "CP_TRIES=0"
:cp_waitstart
sc.exe query "%SVC_NAME%" | find "RUNNING" >nul 2>&1
if not errorlevel 1 goto cp_running
set /a CP_TRIES+=1
if !CP_TRIES! geq 40 goto cp_startfail
ping -n 2 127.0.0.1 >nul 2>&1
goto cp_waitstart

:cp_startfail
call :log "strict start result: TIMEOUT - not RUNNING within ~40s"
echo [install-service] ERROR: service "%SVC_NAME%" did not reach RUNNING within timeout.
sc.exe query "%SVC_NAME%"
set "RC=1"
goto :finish

:cp_running
call :log "strict start result: RUNNING"
echo [install-service] service is RUNNING.
echo [install-service] done.
set "RC=0"
goto :finish

rem ============================================================================
rem  BEST-EFFORT — register/refresh + async start, return immediately. No poll,
rem  no migrations wait, no /health wait. ALWAYS exits 0 (logs a warning).
rem ============================================================================
:register_besteffort
if "!SVC_EXISTED!"=="1" (
  rem Already registered (survives updates) — just re-assert the start type.
  rem Do NOT delete+reinstall: sc delete can leave a 'marked for deletion' entry
  rem that makes the reinstall fail/hang. Skipping the recursive icacls /T over
  rem node_modules also keeps this fast.
  sc.exe config "%SVC_NAME%" start= delayed-auto >nul 2>&1
  call :log "best-effort: refreshed existing registration (no reinstall)"
) else (
  "%SVC_EXE%" install >nul 2>&1
  call :log "best-effort: WinSW install exit=!errorlevel!"
  sc.exe config "%SVC_NAME%" start= delayed-auto >nul 2>&1
  sc.exe sdset "%SVC_NAME%" "D:(A;;CCLCSWRPWPDTLOCRRC;;;BU)(A;;CCLCSWRPWPDTLOCRRC;;;IU)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;SY)S:(AU;FA;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;WD)" >nul 2>&1
  icacls.exe "%SVC_DIR%" /grant "*S-1-5-32-545:(OI)(CI)(M)" /T /C >nul 2>&1
  call :log "best-effort: registered new service"
)

rem Fire-and-forget start. `sc start` only REQUESTS the start (returns at
rem START_PENDING); it does NOT block until RUNNING. The Electron app verifies
rem health/version on launch and repairs if needed.
sc.exe start "%SVC_NAME%" >nul 2>&1
call :log "best-effort: start requested (async, exit=!errorlevel!) - app owns readiness"
echo [install-service] best-effort: service start requested (not awaiting RUNNING).
set "RC=0"
goto :finish

rem ── helpers ───────────────────────────────────────────────────────────────
:log
echo [%DATE% %TIME%] %~1>>"%LOG%"
goto :eof

:finish
call :log "final exit code: !RC! (mode=!MODE!)"
endlocal & exit /b %RC%
