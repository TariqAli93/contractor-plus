# free-port.ps1 — kill any process still LISTENING on the backend loopback port.
#
# Stopping/deleting the service is not always enough: a node.exe spawned by the
# service host (or a leftover dev backend) can keep the port, and a survivor
# keeps answering /version with the OLD version after the files on disk were
# already upgraded — which is exactly what produces a frontend/backend version
# mismatch. This is the hard backstop. Always exits 0 (idempotent, null-safe).
param([int]$Port = 31734)

$ErrorActionPreference = 'SilentlyContinue'
try {
  $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  $pids  = @($conns | Select-Object -ExpandProperty OwningProcess -Unique) |
             Where-Object { $_ -and $_ -ne 0 }
  foreach ($procId in $pids) {
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    Write-Host "[free-port] killed PID $procId holding 127.0.0.1:$Port"
  }
} catch {
  # Get-NetTCPConnection can throw when nothing is listening — that is fine.
}
exit 0
