/**
 * logger.cjs — tiny file + console logger for the desktop main process.
 *
 * Writes to <userData>/logs/desktop-YYYY-MM-DD.log. The backend service has its
 * own rolling logs under %ProgramData%\ContractorPlus\logs (managed by WinSW);
 * this captures only the Electron client side (lifecycle, setup, recovery).
 */
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

let stream = null;

function logDir() {
  return path.join(app.getPath('userData'), 'logs');
}

function ensureStream() {
  if (stream) return stream;
  try {
    const dir = logDir();
    fs.mkdirSync(dir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    stream = fs.createWriteStream(path.join(dir, `desktop-${day}.log`), { flags: 'a' });
  } catch {
    stream = null;
  }
  return stream;
}

function write(level, args) {
  const ts = new Date().toISOString();
  const line = `${ts} [${level}] ${args
    .map((a) => (typeof a === 'string' ? a : safeJson(a)))
    .join(' ')}`;
  // Mirror to the Electron console for `--enable-logging` / dev.
  if (level === 'ERROR') console.error(line);
  else if (level === 'WARN') console.warn(line);
  else console.log(line);
  const s = ensureStream();
  if (s) {
    try {
      s.write(line + '\n');
    } catch {
      /* best-effort */
    }
  }
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

module.exports = {
  info: (...args) => write('INFO', args),
  warn: (...args) => write('WARN', args),
  error: (...args) => write('ERROR', args),
  logDir,
};
