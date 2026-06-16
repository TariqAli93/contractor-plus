# repair-service.ps1 — self-elevating entry point for service (re)installation.
#
# The desktop client runs non-elevated. When it detects the service is missing or
# broken it invokes this script; if we are not already elevated we relaunch
# install-service.cmd through a single UAC prompt (`-Verb RunAs`) and wait. The
# exit code is propagated so the caller can tell success (0) from a declined UAC
# prompt (1223) or an install failure.
$ErrorActionPreference = 'Stop'
$installCmd = Join-Path $PSScriptRoot 'install-service.cmd'

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($id)
  return $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
}

if (-not (Test-Path -LiteralPath $installCmd)) {
  Write-Host "[repair-service] install-service.cmd not found next to this script"
  exit 2
}

if (Test-Admin) {
  & cmd.exe /c "`"$installCmd`""
  exit $LASTEXITCODE
}

try {
  $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', "`"$installCmd`"") -Verb RunAs -Wait -PassThru
  exit $proc.ExitCode
} catch {
  # 1223 = ERROR_CANCELLED (user declined the UAC prompt).
  Write-Host "[repair-service] elevation failed or was declined: $($_.Exception.Message)"
  exit 1223
}
