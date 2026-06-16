/**
 * Service-mode boot migration.
 *
 * When the backend is launched by the ContractorPlusBackend Windows Service the
 * `CONTRACTOR_PLUS_HOME` env var is set (see config/service-config.ts). In that
 * mode — and ONLY that mode — apply any pending Prisma migrations before serving
 * traffic, so an application update that ships new migrations self-heals the
 * schema on the next service start, without re-running the setup wizard.
 *
 * This is the counterpart to the desktop wizard, which runs the FIRST migration
 * (it still holds the admin DB creds the operator typed). After that, the
 * credentials live ACL-locked under %ProgramData% and only the service account
 * can read them — so the service is the only thing that can migrate on update.
 *
 * Best-effort: a failure is logged and startup continues; the /version + /health
 * gates surface a genuinely broken schema to the desktop client. No-op in dev
 * and the Electron child path (CONTRACTOR_PLUS_HOME unset), so dev is unchanged.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export function runMigrationsIfService(): void {
  if (!process.env.CONTRACTOR_PLUS_HOME) return;

  // WinSW sets workingdirectory = the bundle root (%BASE%), so node_modules and
  // prisma/ sit next to cwd, and process.execPath is the bundled bin/node.exe.
  const cwd = process.cwd();
  const prismaCli = path.join(cwd, 'node_modules', 'prisma', 'build', 'index.js');
  const schema = path.join('prisma', 'schema.prisma');

  try {
    execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', schema], {
      cwd,
      stdio: 'inherit',
      env: process.env,
    });
    console.log('[migrate-on-boot] prisma migrate deploy completed');
  } catch (err) {
    console.error('[migrate-on-boot] prisma migrate deploy failed (continuing):', (err as Error).message);
  }
}
