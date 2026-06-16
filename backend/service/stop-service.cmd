@echo off
rem Stop the ContractorPlusBackend service and wait for it to fully stop.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-wait.ps1"
exit /b %errorlevel%
