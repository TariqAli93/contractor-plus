/**
 * Machine-scoped DPAPI decryption (Windows only).
 *
 * The backend runs as a Windows Service under the virtual account
 * `NT SERVICE\ContractorPlusBackend` — a different security principal than the
 * user who ran the first-run setup. The DB password and JWT secret are therefore
 * encrypted by the desktop's elevated `apply-config` helper with
 * `ProtectedData.Protect(..., LocalMachine)` (machine scope) so ANY principal on
 * this machine can decrypt them, while the on-disk file is additionally ACL-locked
 * to SYSTEM + Administrators + the service SID.
 *
 * We shell out to PowerShell's `System.Security.Cryptography.ProtectedData`
 * instead of pulling in a native addon — keeping the service host (a plain
 * bundled `node.exe`) dependency-free and ABI-agnostic. This is only ever called
 * in service mode on Windows; the dev/child path injects secrets via env vars and
 * never touches this module.
 */
import { execFileSync } from 'node:child_process';

const PS_UNPROTECT = [
  'Add-Type -AssemblyName System.Security;',
  '$b=[Convert]::FromBase64String($env:DPAPI_INPUT);',
  "$p=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,'LocalMachine');",
  '[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($p));',
].join(' ');

/**
 * Decrypts a base64-encoded, machine-scoped DPAPI blob and returns the original
 * UTF-8 string. The ciphertext is passed via the `DPAPI_INPUT` env var (never on
 * the command line) so it cannot leak into the process table.
 */
export function dpapiDecryptMachine(base64Blob: string): string {
  if (process.platform !== 'win32') {
    throw new Error('dpapiDecryptMachine is only supported on Windows');
  }
  const out = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_UNPROTECT],
    {
      env: { ...process.env, DPAPI_INPUT: base64Blob.trim() },
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    },
  );
  return out;
}
