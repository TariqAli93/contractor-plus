# provision-elevated.ps1 — elevated first-run / repair provisioning.
#
# Invoked (once, through a single UAC prompt) by the desktop client. Reads a
# JSON payload written by the non-elevated client, persists the runtime service
# configuration under %ProgramData%\ContractorPlus\config\service.json, locks
# that directory to SYSTEM + Administrators (it holds the DB password + JWT
# secret), then installs + starts the Windows Service via install-service.cmd.
#
# The payload path is the ONLY argument and is passed as a PowerShell string, so
# Windows paths with spaces are handled correctly.
param([Parameter(Mandatory = $true)][string]$Payload)

$ErrorActionPreference = 'Stop'

$cfg = Get-Content -Raw -LiteralPath $Payload | ConvertFrom-Json

$appHome   = Join-Path $env:ProgramData 'ContractorPlus'
$configDir = Join-Path $appHome 'config'
foreach ($d in @($appHome, $configDir, (Join-Path $appHome 'data'), (Join-Path $appHome 'logs'))) {
  if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

# Persist the service runtime config (DB creds + JWT + port + SPA dist).
$service = [ordered]@{
  version      = 1
  db           = $cfg.db
  jwtSecret    = $cfg.jwtSecret
  port         = $cfg.port
  frontendDist = $cfg.frontendDist
}
$json = $service | ConvertTo-Json -Depth 8
Set-Content -LiteralPath (Join-Path $configDir 'service.json') -Value $json -Encoding UTF8 -Force

# Lock the secrets-bearing config directory to SYSTEM + Administrators only.
& icacls.exe "$configDir" /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" | Out-Null

# Install + start the Windows Service. LocalSystem (WinSW default) can read the
# config directory above.
$installCmd = Join-Path $cfg.backendDir 'service\install-service.cmd'
if (-not (Test-Path -LiteralPath $installCmd)) {
  Write-Host "[provision-elevated] install-service.cmd not found at $installCmd"
  exit 2
}
& cmd.exe /c "`"$installCmd`""
exit $LASTEXITCODE
