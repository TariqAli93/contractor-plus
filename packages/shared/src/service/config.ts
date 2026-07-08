/**
 * Shared service configuration loader — the SINGLE source of truth for runtime
 * configuration in production / Windows-Service mode.
 *
 * Contractor Plus runs its backend as the `ContractorPlusBackend` Windows
 * Service. The service is handed ONLY two environment variables by the WinSW
 * descriptor: `NODE_ENV=production` and `CONTRACTOR_PLUS_HOME` (= the per-machine
 * data root, e.g. `%ProgramData%\ContractorPlus`). Everything else — the database
 * credentials, the JWT secret, the HTTP port, the SPA path — lives in a single
 * plaintext, ACL-locked file written by the first-run setup wizard:
 *
 *   <home>\config\service.json
 *
 * This module reads + VALIDATES that file and returns a typed
 * {@link ResolvedServiceConfig}. It is intentionally dependency-free (only Node
 * built-ins) and side-effect-free at import time, so it can be vendored into the
 * backend bundle without pulling extra runtime deps, and so it is NEVER part of
 * the browser-facing `@contractor-plus/shared` barrel (it is exposed only via the
 * `@contractor-plus/shared/service-config` subpath export).
 *
 * Hard rules (the "service.json is the only source of truth" contract):
 *   - Missing service.json            → ConfigError(SERVICE_CONFIG_NOT_FOUND)
 *   - Unparseable JSON                → ConfigError(SERVICE_CONFIG_INVALID_JSON)
 *   - Missing / wrong-typed key       → ConfigError(SERVICE_CONFIG_INVALID_SCHEMA) with the exact key path
 *   - Missing CONTRACTOR_PLUS_HOME    → ConfigError(SERVICE_HOME_NOT_SET)
 *   - NO dotenv, NO process.env values are ever read for service.json fields.
 *   - The ONLY derived values are corsOrigin (→ http://127.0.0.1:<port>) and
 *     dataDir (→ <home>/data). There are no hidden defaults that can mask an
 *     invalid configuration.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export type ServiceConfigErrorCode =
  | 'SERVICE_CONFIG_NOT_FOUND'
  | 'SERVICE_CONFIG_INVALID_JSON'
  | 'SERVICE_CONFIG_INVALID_SCHEMA'
  | 'SERVICE_HOME_NOT_SET'
  | 'DATABASE_NAME_MISMATCH';

/** Typed, coded configuration failure. Always thrown before Prisma/Fastify init. */
export class ConfigError extends Error {
  readonly code: ServiceConfigErrorCode;
  /** The exact `service.json` key path that failed, e.g. `db.password`. */
  readonly keyPath?: string;
  /** The resolved config file path, when relevant. */
  readonly configPath?: string;

  constructor(
    code: ServiceConfigErrorCode,
    message: string,
    opts: { keyPath?: string; configPath?: string } = {},
  ) {
    super(message);
    this.name = 'ConfigError';
    this.code = code;
    this.keyPath = opts.keyPath;
    this.configPath = opts.configPath;
    // Restore prototype chain (TS target ES2022 extends built-in Error).
    Object.setPrototypeOf(this, ConfigError.prototype);
  }
}

/** One-line, actionable rendering for logs / stderr. */
export function formatConfigError(err: ConfigError): string {
  const parts = [`${err.code}: ${err.message}`];
  if (err.keyPath) parts.push(`(key: ${err.keyPath})`);
  if (err.configPath) parts.push(`(file: ${err.configPath})`);
  return parts.join(' ');
}

/** Database connection block as it lives inside service.json. */
export interface ServiceDbConfig {
  host: string;
  /** PostgreSQL server port (e.g. 5432) — NOT the backend HTTP port. */
  port: number;
  /** Database name. Canonical key is `database`; `name` is accepted as an alias. */
  database: string;
  user: string;
  password: string;
}

/**
 * Normalised `service.json` shape. The on-disk file (written by the setup
 * wizard) uses `port` + `db.database`; the canonical fields here are
 * `backendPort` + `db.database`, and the legacy/alias keys `port` / `db.name`
 * are accepted on read so existing installs keep working without a rewrite.
 */
export interface ServiceConfig {
  appName?: string;
  version?: string;
  protocolVersion?: string;
  /** Backend HTTP (loopback) port the service listens on, e.g. 31734. */
  backendPort: number;
  frontendDist?: string;
  db: ServiceDbConfig;
  jwtSecret: string;
  /** Dedicated key for at-rest secret encryption (lib/crypto). Optional for
   *  backward compatibility — when absent the backend falls back to jwtSecret and
   *  warns at startup. */
  secretEncryptionKey?: string;
  corsOrigin?: string;
}

/** Fully resolved runtime configuration consumed by the backend. */
export interface ResolvedServiceConfig {
  /** CONTRACTOR_PLUS_HOME (per-machine data root). */
  home: string;
  /** Absolute path to the service.json that was loaded. */
  configPath: string;
  /** <home>/data — derived. */
  dataDir: string;
  /** Backend HTTP port. */
  port: number;
  /** PostgreSQL connection string derived from `db`. */
  databaseUrl: string;
  /** Database name — used by the single-source-of-truth mismatch guard. */
  expectedDbName: string;
  jwtSecret: string;
  /** Dedicated at-rest secret-encryption key (optional; falls back to jwtSecret). */
  secretEncryptionKey?: string;
  /** service.json corsOrigin, or the derived http://127.0.0.1:<port>. */
  corsOrigin: string;
  /** Absolute path to the SPA dist the service serves, if configured. */
  frontendDist?: string;
}

/** Options for {@link loadServiceConfig} — overrides exist for tests only. */
export interface LoadServiceConfigOptions {
  /** Override the resolved home (defaults to {@link resolveServiceHome}). */
  home?: string;
  /** Override the config file path (defaults to {@link getServiceConfigPath}). */
  configPath?: string;
  /** Environment to resolve the home from (defaults to `process.env`). */
  env?: NodeJS.ProcessEnv;
}

/** Canonical PostgreSQL connection-string builder — the ONE place a URL is shaped. */
export function buildDatabaseUrl(db: ServiceDbConfig): string {
  const user = encodeURIComponent(db.user);
  const pass = encodeURIComponent(db.password);
  return `postgresql://${user}:${pass}@${db.host}:${db.port}/${db.database}?schema=public`;
}

/** Database name from a Postgres URL (no credentials), for logging + the guard. */
export function databaseNameFromUrl(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//, '') || '(none)';
  } catch {
    return '(unparsable)';
  }
}

/**
 * Resolve the per-machine home from `CONTRACTOR_PLUS_HOME`. In production the
 * Windows Service descriptor sets it. There is NO fallback: a missing value is a
 * misconfigured service and must fail loudly rather than silently target a wrong
 * path (which previously surfaced downstream as a misleading "DATABASE_URL
 * Required" error).
 */
export function resolveServiceHome(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.CONTRACTOR_PLUS_HOME?.trim();
  if (explicit) return explicit;
  throw new ConfigError(
    'SERVICE_HOME_NOT_SET',
    'CONTRACTOR_PLUS_HOME is not set. The Windows Service must provide it ' +
      '(e.g. %ProgramData%\\ContractorPlus). Refusing to guess the install location.',
  );
}

/** Per-machine app dir name under %ProgramData% / CONTRACTOR_PLUS_HOME. */
const APP_HOME_DIR_NAME = 'ContractorPlus';

/**
 * DESKTOP / provisioner home: `%ProgramData%\ContractorPlus`. This is where the
 * setup wizard writes service.json, and it equals what the Windows Service
 * descriptor passes as CONTRACTOR_PLUS_HOME. The BACKEND runtime must instead use
 * {@link resolveServiceHome} (CONTRACTOR_PLUS_HOME, no fallback) — only the
 * desktop, which is never handed CONTRACTOR_PLUS_HOME, resolves ProgramData here.
 */
export function resolveProgramDataHome(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.ProgramData && env.ProgramData.trim().length > 0 ? env.ProgramData.trim() : 'C:\\ProgramData';
  return path.join(base, APP_HOME_DIR_NAME);
}

/** `<home>/config`. */
export function getConfigDir(home: string): string {
  return path.join(home, 'config');
}
/** `<home>/data`. */
export function getDataDir(home: string): string {
  return path.join(home, 'data');
}
/** `<home>/logs`. */
export function getLogsDir(home: string): string {
  return path.join(home, 'logs');
}
/** `<home>/config/service.json`. */
export function getServiceConfigPath(home: string): string {
  return path.join(getConfigDir(home), 'service.json');
}

export type ServiceConfigPresence = 'present' | 'locked' | 'missing' | 'unreadable';

/**
 * Existence/accessibility of service.json WITHOUT reading its contents.
 *
 * Critically distinguishes a genuinely-missing file from one that EXISTS but is
 * ACL-locked: in packaged builds the config dir is locked to SYSTEM +
 * Administrators, so the non-elevated desktop client gets EPERM/EACCES on any
 * access (stat/read). `fs.existsSync` collapses that to `false` — which made
 * `isSetupComplete()` report "not complete" right after a SUCCESSFUL provision
 * (the wizard then showed success + "setup not complete" at once). Callers must
 * treat `'locked'` as "present" (setup ran; the SYSTEM service validates the
 * file itself on boot).
 *
 *   'present'    → stat succeeded (readable metadata)
 *   'locked'     → exists but ACL-locked (EPERM/EACCES) → treat as present
 *   'missing'    → ENOENT (genuinely absent)
 *   'unreadable' → some other I/O error
 */
export function serviceConfigPresence(configPath: string): ServiceConfigPresence {
  try {
    statSync(configPath);
    return 'present';
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return 'missing';
    if (code === 'EACCES' || code === 'EPERM') return 'locked';
    return 'unreadable';
  }
}

// ── internal validation helpers (zero-dependency, exact key paths) ───────────

function asRecord(value: unknown, keyPath: string, configPath?: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfigError(
      'SERVICE_CONFIG_INVALID_SCHEMA',
      `Expected an object at ${keyPath || '<root>'}.`,
      { keyPath: keyPath || undefined, configPath },
    );
  }
  return value as Record<string, unknown>;
}

function requireString(
  obj: Record<string, unknown>,
  key: string,
  keyPath: string,
  configPath: string | undefined,
  opts: { minLength?: number; allowEmpty?: boolean } = {},
): string {
  const raw = obj[key];
  if (raw === undefined || raw === null) {
    throw new ConfigError('SERVICE_CONFIG_INVALID_SCHEMA', `Missing required key "${keyPath}".`, {
      keyPath,
      configPath,
    });
  }
  if (typeof raw !== 'string') {
    throw new ConfigError('SERVICE_CONFIG_INVALID_SCHEMA', `Key "${keyPath}" must be a string.`, {
      keyPath,
      configPath,
    });
  }
  if (!opts.allowEmpty && raw.trim().length === 0) {
    throw new ConfigError('SERVICE_CONFIG_INVALID_SCHEMA', `Key "${keyPath}" must not be empty.`, {
      keyPath,
      configPath,
    });
  }
  if (opts.minLength !== undefined && raw.length < opts.minLength) {
    throw new ConfigError(
      'SERVICE_CONFIG_INVALID_SCHEMA',
      `Key "${keyPath}" must be at least ${opts.minLength} characters.`,
      { keyPath, configPath },
    );
  }
  return raw;
}

/** Accept a number or a numeric string; reject anything non-positive / non-integer. */
function requireInt(
  obj: Record<string, unknown>,
  keys: [string, ...string[]],
  keyPath: string,
  configPath: string | undefined,
): number {
  let raw: unknown;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) {
      raw = obj[k];
      break;
    }
  }
  if (raw === undefined || raw === null) {
    throw new ConfigError('SERVICE_CONFIG_INVALID_SCHEMA', `Missing required key "${keyPath}".`, {
      keyPath,
      configPath,
    });
  }
  const num = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isInteger(num) || num <= 0) {
    throw new ConfigError(
      'SERVICE_CONFIG_INVALID_SCHEMA',
      `Key "${keyPath}" must be a positive integer.`,
      { keyPath, configPath },
    );
  }
  return num;
}

function optionalString(
  obj: Record<string, unknown>,
  keys: [string, ...string[]],
  keyPath: string,
  configPath: string | undefined,
): string | undefined {
  let raw: unknown;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) {
      raw = obj[k];
      break;
    }
  }
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') {
    throw new ConfigError(
      'SERVICE_CONFIG_INVALID_SCHEMA',
      `Key "${keyPath}" must be a string when present.`,
      { keyPath, configPath },
    );
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Schema validator for service.json. Exposes a zod-like `parse()` that returns a
 * normalised {@link ServiceConfig} or throws {@link ConfigError} with the exact
 * failing key path. Hand-rolled (no zod) to keep `@contractor-plus/shared`
 * dependency-free and to give precise, coded errors.
 */
export const ServiceConfigSchema = {
  parse(raw: unknown, ctx: { configPath?: string } = {}): ServiceConfig {
    const configPath = ctx.configPath;
    const root = asRecord(raw, '', configPath);

    const dbRaw = asRecord(root.db, 'db', configPath);
    const db: ServiceDbConfig = {
      host: requireString(dbRaw, 'host', 'db.host', configPath),
      port: requireInt(dbRaw, ['port'], 'db.port', configPath),
      // `database` is canonical; `name` accepted as alias.
      database:
        optionalString(dbRaw, ['database', 'name'], 'db.database', configPath) ??
        (() => {
          throw new ConfigError('SERVICE_CONFIG_INVALID_SCHEMA', 'Missing required key "db.database".', {
            keyPath: 'db.database',
            configPath,
          });
        })(),
      user: requireString(dbRaw, 'user', 'db.user', configPath),
      // Password must be present (key exists) but may legitimately be empty.
      password: requireString(dbRaw, 'password', 'db.password', configPath, { allowEmpty: true }),
    };

    return {
      appName: optionalString(root, ['appName'], 'appName', configPath),
      // `version` / `protocolVersion` are informational and tolerant: the real
      // on-disk file writes `version: 1` (number); a future writer may use a
      // semver string. Both normalise to a string; absence is fine.
      version: coerceOptionalVersion(root.version, 'version', configPath),
      protocolVersion: coerceOptionalVersion(root.protocolVersion, 'protocolVersion', configPath),
      // `backendPort` is canonical; top-level `port` accepted as alias.
      backendPort: requireInt(root, ['backendPort', 'port'], 'backendPort', configPath),
      frontendDist: optionalString(root, ['frontendDist'], 'frontendDist', configPath),
      db,
      jwtSecret: requireString(root, 'jwtSecret', 'jwtSecret', configPath, { minLength: 32 }),
      secretEncryptionKey: optionalString(root, ['secretEncryptionKey'], 'secretEncryptionKey', configPath),
      corsOrigin: optionalString(root, ['corsOrigin'], 'corsOrigin', configPath),
    };
  },
};

/** Accept a string or numeric `version`/`protocolVersion`; normalise to string. */
function coerceOptionalVersion(
  value: unknown,
  keyPath: string,
  configPath: string | undefined,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  throw new ConfigError(
    'SERVICE_CONFIG_INVALID_SCHEMA',
    `Key "${keyPath}" must be a string or number when present.`,
    { keyPath, configPath },
  );
}

/**
 * Parse + validate raw service.json TEXT (no file IO). Strips a leading UTF-8
 * BOM, then `JSON.parse` (→ SERVICE_CONFIG_INVALID_JSON) and validates against
 * {@link ServiceConfigSchema} (→ SERVICE_CONFIG_INVALID_SCHEMA with the exact key
 * path). This is the SINGLE canonical parser: the backend and the Electron main
 * both go through it, so there is exactly one schema + one BOM/JSON handling.
 */
export function parseServiceConfig(rawText: string, ctx: { configPath?: string } = {}): ServiceConfig {
  const configPath = ctx.configPath;
  // Tolerate a leading UTF-8 BOM (U+FEFF) — PowerShell 5.1 historically wrote one.
  const text = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(
      'SERVICE_CONFIG_INVALID_JSON',
      `Service configuration is not valid JSON${configPath ? ` at ${configPath}` : ''}: ${(err as Error).message}`,
      { configPath },
    );
  }
  return ServiceConfigSchema.parse(parsed, { configPath });
}

/**
 * Load + validate `service.json` and return the resolved runtime config. Throws
 * {@link ConfigError} on any missing/invalid input. Reads ONLY the file — no
 * environment variables influence the returned values.
 */
export function loadServiceConfig(options: LoadServiceConfigOptions = {}): ResolvedServiceConfig {
  const home = options.home ?? resolveServiceHome(options.env);
  const configPath = options.configPath ?? getServiceConfigPath(home);

  if (!existsSync(configPath)) {
    throw new ConfigError(
      'SERVICE_CONFIG_NOT_FOUND',
      `Service configuration not found at ${configPath}. Run the setup wizard first.`,
      { configPath },
    );
  }

  let rawText: string;
  try {
    rawText = readFileSync(configPath, 'utf8');
  } catch (err) {
    throw new ConfigError(
      'SERVICE_CONFIG_NOT_FOUND',
      `Service configuration could not be read at ${configPath}: ${(err as Error).message}`,
      { configPath },
    );
  }

  const cfg = parseServiceConfig(rawText, { configPath });
  const port = cfg.backendPort;
  const corsOrigin =
    cfg.corsOrigin && cfg.corsOrigin.trim().length > 0
      ? cfg.corsOrigin.trim()
      : `http://127.0.0.1:${port}`;

  return {
    home,
    configPath,
    dataDir: getDataDir(home),
    port,
    databaseUrl: buildDatabaseUrl(cfg.db),
    expectedDbName: cfg.db.database,
    jwtSecret: cfg.jwtSecret,
    secretEncryptionKey: cfg.secretEncryptionKey,
    corsOrigin,
    frontendDist: cfg.frontendDist,
  };
}

/**
 * Single-source-of-truth guard: assert the database a URL points at matches the
 * name resolved from service.json. Throws {@link ConfigError} on disagreement.
 * Used in dev where the launcher injects DATABASE_URL explicitly.
 */
export function assertDatabaseName(databaseUrl: string, expectedDbName: string): void {
  const actual = databaseNameFromUrl(databaseUrl);
  if (expectedDbName && actual !== expectedDbName) {
    throw new ConfigError(
      'DATABASE_NAME_MISMATCH',
      `DATABASE_URL points at "${actual}" but service.json expects "${expectedDbName}". Refusing to start.`,
    );
  }
}
