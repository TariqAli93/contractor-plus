@echo off
rem ============================================================================
rem  uninstall-service.cmd  —  stop + fully remove the ContractorPlusBackend
rem  Windows Service. Used on a real (Control-Panel) uninstall, NOT during an
rem  application update (the NSIS uninstaller preserves the registration when
rem  ${isUpdated} is true — see scripts/installer-include.nsh).
rem
rem  Idempotent + graceful: a missing service is a no-op success. Appends a
rem  timestamped transcript to
rem    %ProgramData%\ContractorPlus\logs\uninstall-service.log
rem  capturing: service-exists?, stop result, delete result, final exit code.
rem  Never deletes %ProgramData%\ContractorPlus (config/data/logs are preserved).
rem ============================================================================
setlocal EnableExtensions EnableDelayedExpansion
set "SVC_NAME=ContractorPlusBackend"
set "SVC_DIR=%~dp0.."
set "SVC_EXE=%SVC_DIR%\ContractorPlusBackend.exe"

set "LOG_DIR=%ProgramData%\ContractorPlus\logs"
set "LOG=%LOG_DIR%\uninstall-service.log"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1

call :log "=== uninstall-service started ==="

rem ── require elevation ────────────────────────────────────────────────────
net session >nul 2>&1
if errorlevel 1 (
  call :log "ERROR: administrator privileges are required."
  echo [uninstall-service] ERROR: administrator privileges are required.
  set "RC=1"
  goto :finish
)

rem ── missing service → graceful no-op success ─────────────────────────────
sc.exe query "%SVC_NAME%" >nul 2>&1
if errorlevel 1 (
  call :log "service exists: NO - nothing to do"
  echo [uninstall-service] service not installed - nothing to do.
  set "RC=0"
  goto :finish
)
call :log "service exists: YES"

rem ── stop with a BOUNDED wait (max 10s). If it times out we still proceed to
rem    delete: sc delete marks a still-running service for deletion, which the
rem    SCM finalizes when the process exits — so the uninstaller never hangs. ──
echo [uninstall-service] stopping service (bounded wait, max 10s)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-wait.ps1" -TimeoutSec 10 >nul 2>&1
call :log "stop result: stop-wait.ps1 exit=!errorlevel! (bounded 10s)"

rem ── remove via WinSW (clean) then sc delete (backstop) ───────────────────
if exist "%SVC_EXE%" (
  "%SVC_EXE%" uninstall >nul 2>&1
  call :log "WinSW uninstall exit=!errorlevel!"
)
sc.exe delete "%SVC_NAME%" >nul 2>&1
call :log "delete result: sc delete exit=!errorlevel!"

rem ── verify; a 'marked for deletion' entry clears once handles close, so we do
rem    NOT fail the uninstall on it (failing would abort the NSIS uninstaller). ─
sc.exe query "%SVC_NAME%" >nul 2>&1
if errorlevel 1 (
  call :log "post-check: service removed"
) else (
  call :log "post-check: service still registered (marked for deletion; clears on handle close/reboot)"
)

echo [uninstall-service] done.
set "RC=0"
goto :finish

rem ── helpers ───────────────────────────────────────────────────────────────
:log
echo [%DATE% %TIME%] %~1>>"%LOG%"
goto :eof

:finish
call :log "final exit code: !RC!"
endlocal & exit /b %RC%
