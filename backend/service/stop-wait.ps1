# stop-wait.ps1 — stop the service and BLOCK until it reports Stopped.
#
# `sc.exe stop` returns before the process actually exits, and WinSW allows up to
# its <stoptimeout> for a graceful shutdown. Callers (installer, repair) need the
# backend fully stopped before an atomic file-move of resources\backend, so we
# poll until Stopped or the timeout elapses. Always exits 0 (idempotent).
param(
  [string]$ServiceName = 'ContractorPlusBackend',
  [int]$TimeoutSec = 20
)

$ErrorActionPreference = 'SilentlyContinue'
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) { exit 0 }

& sc.exe stop $ServiceName | Out-Null

$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ((Get-Date) -lt $deadline) {
  try { $svc.Refresh() } catch {}
  if ($svc.Status -eq 'Stopped') { break }
  Start-Sleep -Milliseconds 500
}
exit 0
