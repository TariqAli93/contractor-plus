#!/usr/bin/env node
/**
 * mark-bad-release.js
 *
 * Flag a released version as bad so auto-update will stop offering it and
 * ops can trace why it was pulled. Usage:
 *
 *   node scripts/mark-bad-release.js <version> "<reason>"
 *
 * What it does:
 *   1. Appends an entry to dist-backend-manifest/bad-versions.json:
 *        { "1.0.13": { "reason": "...", "markedAt": "..." } }
 *   2. Edits the GitHub Release notes to include a [BAD RELEASE] banner
 *      (uses the `gh` CLI — must be authenticated on the host that runs this)
 *   3. Does NOT delete the release — rollback is handled by electron-updater
 *      refusing to downgrade AND by the allowDowngrade=false flag, but the
 *      bad-versions.json is authoritative if you self-host a feed.
 *
 * Why not delete the tag/release? Because in-flight clients that already
 * downloaded the bad installer still need the signature chain to verify,
 * and deleting breaks auditability. Marking is reversible; deletion is not.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\//, ''), '..');
const MANIFEST_DIR = path.join(REPO_ROOT, 'dist-backend-manifest');
const BAD_FILE = path.join(MANIFEST_DIR, 'bad-versions.json');

function usage() {
  console.error('usage: node scripts/mark-bad-release.js <version> "<reason>"');
  process.exit(1);
}

function main() {
  const [, , version, ...reasonParts] = process.argv;
  if (!version || reasonParts.length === 0) usage();
  if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version)) {
    console.error(`invalid version: ${version}`);
    process.exit(1);
  }
  const reason = reasonParts.join(' ');

  if (!fs.existsSync(MANIFEST_DIR)) fs.mkdirSync(MANIFEST_DIR, { recursive: true });

  let list = {};
  if (fs.existsSync(BAD_FILE)) {
    try {
      list = JSON.parse(fs.readFileSync(BAD_FILE, 'utf8'));
    } catch {
      list = {};
    }
  }

  list[version] = { reason, markedAt: new Date().toISOString() };
  fs.writeFileSync(BAD_FILE, JSON.stringify(list, null, 2) + '\n');
  console.log(`[mark-bad] wrote ${BAD_FILE}`);

  // Best-effort GitHub Release banner edit.
  try {
    const tag = `v${version}`;
    const banner =
      `> **⚠ BAD RELEASE — DO NOT INSTALL ⚠**\n` +
      `> Marked bad on ${new Date().toISOString()}\n> Reason: ${reason}\n\n`;
    const currentBody = execFileSync('gh', ['release', 'view', tag, '--json', 'body', '-q', '.body'], {
      encoding: 'utf8',
    });
    const newBody = banner + currentBody;
    execFileSync('gh', ['release', 'edit', tag, '--notes', newBody], { stdio: 'inherit' });
    console.log(`[mark-bad] updated GitHub release notes for ${tag}`);
  } catch (err) {
    console.warn(`[mark-bad] skipped GitHub update (gh CLI error): ${err.message}`);
  }
}

main();
