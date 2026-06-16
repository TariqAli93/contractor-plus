@echo off
rem ============================================================================
rem  install-service.cmd  —  (re)install + start the ContractorPlusBackend
rem  Windows Service via the bundled WinSW host. Idempotent and elevation-aware.
rem
rem  Lives at <resources>\backend\service\install-service.cmd. The WinSW wrapper
rem  and its descriptor sit one level up, next to the bundle root.
rem ============================================================================
setlocal EnableExtensions
set "SVC_NAME=ContractorPlusBackend"
set "SVC_DIR=%~dp0.."
set "SVC_EXE=%SVC_DIR%\ContractorPlusBackend.exe"

rem ── require elevation ────────────────────────────────────────────────────
net session >nul 2>&1
if errorlevel 1 (
  echo [install-service] ERROR: administrator privileges are required.
  exit /b 1
)

if not exist "%SVC_EXE%" (
  echo [install-service] ERROR: WinSW host not found at "%SVC_EXE%".
  exit /b 1
)

rem ── idempotent: drop any prior registration before reinstalling ──────────
sc.exe query "%SVC_NAME%" >nul 2>&1
if not errorlevel 1 (
  echo [install-service] existing service found - stopping and removing it first...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-wait.ps1" >nul 2>&1
  "%SVC_EXE%" uninstall >nul 2>&1
  sc.exe delete "%SVC_NAME%" >nul 2>&1
)

echo [install-service] installing WinSW service "%SVC_NAME%"...
"%SVC_EXE%" install
if errorlevel 1 (
  echo [install-service] ERROR: WinSW install failed.
  exit /b 1
)

rem ── delayed automatic start ──────────────────────────────────────────────
sc.exe config "%SVC_NAME%" start= delayed-auto >nul 2>&1

rem ── allow BUILTIN\Users (BU) + INTERACTIVE (IU) to start/stop/query so the
rem    non-elevated desktop client can manage the service; Admins (BA) + SYSTEM
rem    (SY) keep full control; audit failures (WD). ─────────────────────────
sc.exe sdset "%SVC_NAME%" "D:(A;;CCLCSWRPWPDTLOCRRC;;;BU)(A;;CCLCSWRPWPDTLOCRRC;;;IU)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;SY)S:(AU;FA;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;WD)" >nul 2>&1

rem ── let non-admin users update the backend bundle in place (modify on the
rem    backend dir only; the rest of the install tree stays admin-only). ─────
icacls.exe "%SVC_DIR%" /grant "*S-1-5-32-545:(OI)(CI)(M)" /T /C >nul 2>&1

echo [install-service] starting service...
sc.exe start "%SVC_NAME%" >nul 2>&1

echo [install-service] done.
exit /b 0
