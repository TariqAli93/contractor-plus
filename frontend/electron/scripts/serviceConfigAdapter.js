/**
 * serviceConfigAdapter.js — the ONE bridge from the Electron main process to the
 * shared service-config contract (`@contractor-plus/shared/service-config`).
 *
 * Why an adapter rather than importing the shared module everywhere:
 *   - It is the single, controlled place that reaches the Node-only shared
 *     loader, so there is exactly ONE schema + ONE service.json parser in the
 *     whole app (the desktop no longer keeps its own copy).
 *   - If packaging ever needs a different resolution strategy for the shared
 *     built artifact, only this file changes.
 *
 * Runtime note: `@contractor-plus/shared` is a PRODUCTION dependency of the
 * frontend package, so electron-builder includes it in the asar's node_modules
 * (same mechanism by which the main already loads `electron-updater` at runtime).
 * The `service-config` subpath is Node-only (it imports `node:fs`); it is exposed
 * via the package `exports` map and is intentionally NOT part of the browser
 * barrel. Static ESM import keeps every consumer synchronous.
 */
import {
  loadServiceConfig,
  parseServiceConfig,
  serviceConfigPresence,
  buildDatabaseUrl,
  databaseNameFromUrl,
  resolveProgramDataHome,
  resolveServiceHome,
  getConfigDir,
  getDataDir,
  getLogsDir,
  getServiceConfigPath,
  ConfigError,
} from '@contractor-plus/shared/service-config';
import { PROTOCOL_VERSION } from '@contractor-plus/shared';

export {
  loadServiceConfig,
  parseServiceConfig,
  serviceConfigPresence,
  buildDatabaseUrl,
  databaseNameFromUrl,
  resolveProgramDataHome,
  resolveServiceHome,
  getConfigDir,
  getDataDir,
  getLogsDir,
  getServiceConfigPath,
  ConfigError,
  PROTOCOL_VERSION,
};

/**
 * Non-throwing resolve for "is the backend safe to start / what's the DB URL"
 * checks. Returns the resolved config, or null on any ConfigError (missing,
 * unreadable, invalid). Real (non-ConfigError) errors still propagate.
 * @param {{ home?: string, configPath?: string, env?: NodeJS.ProcessEnv }} [options]
 */
export function tryLoadServiceConfig(options) {
  try {
    return loadServiceConfig(options);
  } catch (err) {
    if (err instanceof ConfigError) return null;
    throw err;
  }
}
