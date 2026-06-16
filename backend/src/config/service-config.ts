/**
 * Windows-Service configuration loader.
 *
 * When the backend is launched by the WinSW service `ContractorPlusBackend`, the
 * only environment it is handed is `CONTRACTOR_PLUS_HOME` (= `%ProgramData%\
 * ContractorPlus`). The full runtime configuration — including the DB password
 * and JWT secret — lives in a single plaintext file written (and ACL-locked to
 * SYSTEM + Administrators + the service account) by the desktop's elevated
 * provisioning step during first-run setup:
 *
 *   <HOME>\config\service.json   { db:{host,port,database,user,password}, jwtSecret, port, frontendDist?, corsOrigin? }
 *   <HOME>\data                  CONTRACTOR_PLUS_DATA_DIR (uploads/public/private)
 *   <HOME>\logs                  central logs (rolled by WinSW)
 *
 * The secret material is NEVER baked into the installer or the service
 * descriptor (the "no secrets in install files" rule) — it is entered by the
 * operator during setup and persisted under %ProgramData% on the target machine
 * only. This module reconstructs DATABASE_URL/JWT/PORT/etc. from disk and injects
 * them into `process.env` BEFORE the zod env schema in `env.ts` runs.
 *
 * Dev and the Electron child-process path never set `CONTRACTOR_PLUS_HOME`, so
 * this is a no-op there and the existing env-var contract is unchanged.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

interface ServiceConfigFile {
  version: number;
  db: { host: string; port: number; database: string; user: string; password: string };
  jwtSecret: string;
  port: number;
  /** Absolute path to the built SPA the service should serve (single origin). */
  frontendDist?: string;
  corsOrigin?: string;
}

function setIfUnset(key: string, value: string): void {
  if (process.env[key] === undefined || process.env[key] === '') {
    process.env[key] = value;
  }
}

export function loadServiceConfigIntoEnv(): void {
  const home = process.env.CONTRACTOR_PLUS_HOME?.trim();
  if (!home) return; // not service mode — env already provided (dev / Electron child)

  const cfg = JSON.parse(
    readFileSync(path.join(home, 'config', 'service.json'), 'utf8'),
  ) as ServiceConfigFile;

  const user = encodeURIComponent(cfg.db.user);
  const pass = encodeURIComponent(cfg.db.password);
  const { host, port: dbPort, database } = cfg.db;
  const databaseUrl = `postgresql://${user}:${pass}@${host}:${dbPort}/${database}?schema=public`;

  setIfUnset('NODE_ENV', 'production');
  setIfUnset('DATABASE_URL', databaseUrl);
  setIfUnset('JWT_ACCESS_SECRET', cfg.jwtSecret);
  setIfUnset('PORT', String(cfg.port));
  setIfUnset('CONTRACTOR_PLUS_DATA_DIR', path.join(home, 'data'));
  setIfUnset('CORS_ORIGIN', cfg.corsOrigin ?? `http://127.0.0.1:${cfg.port}`);
  setIfUnset('LOCAL_SERVICE_URL', `http://127.0.0.1:${cfg.port}`);
  if (cfg.frontendDist) setIfUnset('FRONTEND_DIST', cfg.frontendDist);
}
