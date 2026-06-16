import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getUserDataDir } from '../../lib/user-data-dir.js';
import { env } from '../../config/env.js';

const SUBDIR = 'cloudflared';

export interface TunnelFilePaths {
  dir: string;
  credentialsFile: string;
  configFile: string;
}

export function tunnelFilePaths(): TunnelFilePaths {
  const dir = path.join(getUserDataDir(), SUBDIR);
  return {
    dir,
    credentialsFile: path.join(dir, 'credentials.json'),
    configFile: path.join(dir, 'config.yml'),
  };
}

export function tunnelArtifactsExist(): boolean {
  const { credentialsFile, configFile } = tunnelFilePaths();
  return existsSync(credentialsFile) && existsSync(configFile);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// cloudflared on Windows tolerates forward slashes (Go's filepath.Clean
// normalizes them) and they are unambiguously safe inside YAML scalars.
function toYamlSafePath(p: string): string {
  return p.split(path.sep).join('/');
}

function buildConfigYaml(input: {
  tunnelId: string;
  hostname: string;
  credentialsFile: string;
}): string {
  return [
    `tunnel: ${input.tunnelId}`,
    `credentials-file: ${toYamlSafePath(input.credentialsFile)}`,
    '',
    'ingress:',
    `  - hostname: ${input.hostname}`,
    `    service: ${localServiceUrl()}`,
    '  - service: http_status:404',
    '',
  ].join('\n');
}

function localServiceUrl(): string {
  return env.LOCAL_SERVICE_URL ?? `http://localhost:${env.PORT}`;
}

export function writeTunnelArtifacts(input: {
  tunnelId: string;
  hostname: string;
  credentials: Record<string, unknown>;
}): TunnelFilePaths {
  const paths = tunnelFilePaths();
  ensureDir(paths.dir);
  writeFileSync(paths.credentialsFile, JSON.stringify(input.credentials, null, 2), {
    mode: 0o600,
  });
  writeFileSync(
    paths.configFile,
    buildConfigYaml({
      tunnelId: input.tunnelId,
      hostname: input.hostname,
      credentialsFile: paths.credentialsFile,
    }),
    { mode: 0o600 },
  );
  return paths;
}

export const __testing = { buildConfigYaml, toYamlSafePath };
