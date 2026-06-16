@echo off
rem Restart the ContractorPlusBackend service: stop-and-wait, then start.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-wait.ps1"
sc.exe start ContractorPlusBackend
exit /b %errorlevel%
