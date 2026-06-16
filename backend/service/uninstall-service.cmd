@echo off
rem ============================================================================
rem  uninstall-service.cmd  —  stop + fully remove the ContractorPlusBackend
rem  Windows Service. Used on a real (Control-Panel) uninstall, NOT during an
rem  application update (the NSIS uninstaller preserves the registration when
rem  ${isUpdated} is true — see scripts/installer-include.nsh).
rem ============================================================================
setlocal EnableExtensions
set "SVC_NAME=ContractorPlusBackend"
set "SVC_DIR=%~dp0.."
set "SVC_EXE=%SVC_DIR%\ContractorPlusBackend.exe"

net session >nul 2>&1
if errorlevel 1 (
  echo [uninstall-service] ERROR: administrator privileges are required.
  exit /b 1
)

sc.exe query "%SVC_NAME%" >nul 2>&1
if errorlevel 1 (
  echo [uninstall-service] service not installed - nothing to do.
  exit /b 0
)

echo [uninstall-service] stopping service...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-wait.ps1" >nul 2>&1

if exist "%SVC_EXE%" "%SVC_EXE%" uninstall >nul 2>&1
sc.exe delete "%SVC_NAME%" >nul 2>&1

echo [uninstall-service] done.
exit /b 0
