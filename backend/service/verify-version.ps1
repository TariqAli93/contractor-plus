# verify-version.ps1 — post-install guardrail.
#
# Confirms the RUNNING backend reports the same app version as the files we just
# installed (read from the bundle's package.json one level up). Catches a stale
# node.exe still holding the port after an upgrade (the classic "frontend expects
# vA, backend reports vB"). Exit codes:
#   0  match
#   1  mismatch (a stale process is likely still answering)
#   2  unreachable / cannot determine
param(
  [int]$Port = 31734,
  [int]$TimeoutSec = 3
)

$ErrorActionPreference = 'SilentlyContinue'
$pkgPath = Join-Path $PSScriptRoot '..\package.json'

try {
  $expected = (Get-Content -Raw -Path $pkgPath | ConvertFrom-Json).version
} catch {
  Write-Host '[verify-version] cannot read packaged package.json'
  exit 2
}

try {
  $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/version" -TimeoutSec $TimeoutSec
} catch {
  Write-Host "[verify-version] backend unreachable on 127.0.0.1:$Port"
  exit 2
}

if ($resp.app -eq $expected) {
  Write-Host "[verify-version] OK - service reports $expected"
  exit 0
}

Write-Host "[verify-version] MISMATCH - installed=$expected running=$($resp.app)"
exit 1
