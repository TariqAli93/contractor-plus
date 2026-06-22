/**
 * Service-mode boot migration.
 *
 * When the backend runs as the ContractorPlusBackend Windows Service (service
 * mode — see config/env.ts `IS_SERVICE_MODE`), apply any pending Prisma
 * migrations before serving traffic, so an application update that ships new
 * migrations self-heals the schema on the next service start, without re-running
 * the setup wizard.
 *
 * This is the counterpart to the desktop wizard, which runs the FIRST migration
 * (it still holds the admin DB creds the operator typed). After that, the
 * credentials live ACL-locked under %ProgramData% and only the service account
 * can read them — so the service is the only thing that can migrate on update.
 *
 * FAIL-FAST (Phase 2): a migration failure exits the process non-zero — the
 * service must NEVER serve traffic on an unmigrated/half-migrated schema. The
 * desktop client then sees the service as not healthy and offers repair. No-op
 * in dev and the Electron child path (not service mode), so dev is unchanged.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, IS_SERVICE_MODE } from '../config/env.js';

export function runMigrationsIfService(): void {
  if (!IS_SERVICE_MODE) return;

  // Anchor to the bundle root from THIS module's location rather than
  // process.cwd():  <bundle>/dist/setup/migrate-on-boot.js  →  <bundle> = ../..
  // node.exe, node_modules/ and prisma/ all live under the bundle root. (WinSW
  // also sets workingdirectory=<bundle>, but anchoring here is robust regardless
  // of how the process was launched.)
  const here = path.dirname(fileURLToPath(import.meta.url));
  const bundleRoot = path.resolve(here, '..', '..');
  const prismaCli = path.join(bundleRoot, 'node_modules', 'prisma', 'build', 'index.js');
  const schema = path.join(bundleRoot, 'prisma', 'schema.prisma');

  try {
    // The Prisma CLI is a SEPARATE process that resolves the schema's
    // `url = env("DATABASE_URL")` from its own environment. In service mode
    // DATABASE_URL is intentionally NOT on process.env, so inject it into THIS
    // child only, from the validated typed config (no global env mutation).
    execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', schema], {
      cwd: bundleRoot,
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: env.DATABASE_URL },
    });
    console.log('[migrate-on-boot] prisma migrate deploy completed');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      '[migrate-on-boot] FATAL: prisma migrate deploy failed — refusing to start on an ' +
        `unmigrated schema. Reason: ${reason}`,
    );
    process.exit(1);
  }
}
