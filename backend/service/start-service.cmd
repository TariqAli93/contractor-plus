@echo off
rem Start the ContractorPlusBackend service. BUILTIN\Users were granted start
rem rights at install time, so this works without elevation.
sc.exe start ContractorPlusBackend
exit /b %errorlevel%
