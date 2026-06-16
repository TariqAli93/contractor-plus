@echo off
rem Print the current state of the ContractorPlusBackend service.
sc.exe query ContractorPlusBackend
exit /b %errorlevel%
