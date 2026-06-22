# provision-elevated.ps1 — elevated first-run / repair provisioning.
#
# Invoked (once, through a single UAC prompt) by the desktop client. Reads a JSON
# payload written by the non-elevated client, persists the runtime service config
# under %ProgramData%\ContractorPlus\config\service.json, ACL-locks that directory
# to SYSTEM + Administrators (it holds the DB password + JWT secret), then installs
# + starts the Windows Service via install-service.cmd.
#
# The elevated process runs behind UAC, so its console output CANNOT flow back to
# the non-elevated client. Therefore EVERY run writes a log to
#   %ProgramData%\ContractorPlus\logs\provision.log
# created on the very first line, before any risky operation, and the whole body
# is wrapped in try/catch so a failure is ALWAYS visible.
param([Parameter(Mandatory = $true)][string]$Payload)

$ErrorActionPreference = 'Stop'

# ── Bulletproof logging: create the log dir + file BEFORE anything else ────────
$HomeDir = Join-Path $env:ProgramData 'ContractorPlus'
$LogsDir = Join-Path $HomeDir 'logs'
$ProvisionLog = Join-Path $LogsDir 'provision.log'
try {
  New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
  "=== ContractorPlus provisioning started $(Get-Date -Format o) ===" | Out-File -FilePath $ProvisionLog -Encoding UTF8 -Force
}
catch {
  # Last-resort fallback so diagnostics are never lost entirely.
  $ProvisionLog = Join-Path $env:TEMP 'contractorplus-provision.log'
  try {
    "=== ContractorPlus provisioning started (FALLBACK log) $(Get-Date -Format o) ===" | Out-File -FilePath $ProvisionLog -Encoding UTF8 -Force
    "Could not create $LogsDir : $($_ | Out-String)" | Add-Content -LiteralPath $ProvisionLog -Encoding UTF8
  }
  catch { }
}

function Log([string]$msg) {
  try { "[$(Get-Date -Format o)] $msg" | Add-Content -LiteralPath $ProvisionLog -Encoding UTF8 } catch { }
}

$exitCode = 0
try {
  Log "PSVersion=$($PSVersionTable.PSVersion) Is64BitProcess=$([Environment]::Is64BitProcess) User=$([Security.Principal.WindowsIdentity]::GetCurrent().Name)"
  Log "ProgramData=$env:ProgramData  HomeDir=$HomeDir"
  Log "Payload path = $Payload"
  if (-not (Test-Path -LiteralPath $Payload)) { throw "Payload file not found: $Payload" }

  # NOTE: this variable MUST NOT be named $payload — PowerShell variable names are
  # case-insensitive, so it would alias the [string]$Payload PARAMETER and coerce
  # the parsed object back to a string (silently emptying .configJson/.backendDir).
  $cfgPayload = Get-Content -Raw -LiteralPath $Payload | ConvertFrom-Json
  Log "payload parsed. backendDir = $($cfgPayload.backendDir)"

  $configDir = Join-Path $HomeDir 'config'
  foreach ($d in @($HomeDir, $configDir, (Join-Path $HomeDir 'data'), $LogsDir)) {
    if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
  }
  Log "directories ensured (config/data/logs). configDir = $configDir"

  # Persist the runtime config. The non-elevated client already built + VALIDATED
  # the canonical service.json bytes (against the shared schema); this script only
  # WRITES those bytes — it does NOT re-declare or reconstruct the config shape.
  $json = [string]$cfgPayload.configJson
  if ([string]::IsNullOrWhiteSpace($json)) { throw "payload.configJson is missing or empty" }
  $cfgPath = Join-Path $configDir 'service.json'
  # Write UTF-8 WITHOUT BOM (the backend's JSON.parse must not choke on a BOM).
  [System.IO.File]::WriteAllText($cfgPath, $json, (New-Object System.Text.UTF8Encoding($false)))
  Log "service.json written ($($json.Length) chars) -> $cfgPath"

  # Lock the secrets-bearing config directory to SYSTEM + Administrators only.
  & icacls.exe "$configDir" /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" | Out-Null
  Log "ACL locked $configDir (icacls exit=$LASTEXITCODE)"

  # Install + start the Windows Service.
  $installCmd = Join-Path $cfgPayload.backendDir 'service\install-service.cmd'
  Log "install-service.cmd = $installCmd"
  if (-not (Test-Path -LiteralPath $installCmd)) { throw "install-service.cmd not found at $installCmd" }

  Log "running install-service.cmd ..."
  Add-Content -LiteralPath $ProvisionLog -Value "---- install-service.cmd output ----" -Encoding UTF8
  # cmd-level redirection (>> / 2>&1) keeps native streams INSIDE cmd.exe, so
  # PowerShell never raises a NativeCommandError under $ErrorActionPreference=Stop.
  & cmd.exe /c "`"$installCmd`" >> `"$ProvisionLog`" 2>&1"
  $exitCode = $LASTEXITCODE
  Add-Content -LiteralPath $ProvisionLog -Value "---- end install-service.cmd output ----" -Encoding UTF8
  Log "install-service.cmd exit code = $exitCode"

  if ($exitCode -ne 0) { Log "PROVISION FAILED (install-service exit $exitCode)" }
  else { Log "PROVISION SUCCEEDED" }
}
catch {
  Log "FATAL EXCEPTION: $($_ | Out-String)"
  Log "ScriptStackTrace: $($_.ScriptStackTrace)"
  $exitCode = 1
}

Log "exiting with code $exitCode"
exit $exitCode
