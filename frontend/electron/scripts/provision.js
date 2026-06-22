/**
 * provision.js — write the runtime service config + (re)install the Windows
 * Service, elevated, in a single UAC prompt.
 *
 * Secrets handling (matches the chosen "nuqta-style plaintext" model, kept out
 * of the installer): the DB credentials + a freshly generated JWT secret are
 * written as plaintext to %ProgramData%\ContractorPlus\config\service.json, then
 * the config directory is ACL-locked to SYSTEM + Administrators. The descriptor
 * (ContractorPlusBackend.xml) carries NO secrets — only CONTRACTOR_PLUS_HOME.
 *
 * The whole elevated step is shipped as service\provision-elevated.ps1 and is
 * invoked through a base64 -EncodedCommand so paths-with-spaces survive the
 * Start-Process -Verb RunAs boundary without any quoting fragility.
 */
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import * as rt from './runtime.js';
import * as cfg from './serviceConfigAdapter.js';

const SYSROOT = process.env.SystemRoot || 'C:\\Windows';
const PS_EXE = path.join(SYSROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

export function generateJwtSecret() {
  return crypto.randomBytes(32).toString('hex'); // 64 hex chars >= 32 required
}

function psQuote(s) {
  return String(s).replace(/'/g, "''");
}

/** Last ~40 non-empty lines of the elevated provisioning log. Never throws. */
function readProvisionLogTail(maxLines = 40) {
  try {
    const text = fs.readFileSync(path.join(rt.logsDir(), 'provision.log'), 'utf8');
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    return lines.slice(-maxLines).join('\n');
  } catch {
    return '';
  }
}

/** First error/state-looking line, for a concise user-facing reason. */
function firstMeaningfulLine(text) {
  if (!text) return '';
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const errLine = lines.find((l) => /ERROR|FAIL|not reach RUNNING|STATE\s*:|exit=/i.test(l));
  return (errLine || lines[lines.length - 1] || '').slice(0, 200);
}

/** Secondary, non-elevated diagnostics log beside the Electron logs. Never throws. */
function clientLogPath() {
  try {
    return path.join(app.getPath('userData'), 'logs', 'provision-client.log');
  } catch {
    return path.join(os.tmpdir(), 'contractorplus-provision-client.log');
  }
}
function writeClientLog(lines) {
  try {
    const p = clientLogPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, lines.join('\n') + '\n', 'utf8');
  } catch {
    /* never throws */
  }
}

function runElevatedProvision(payloadPath) {
  return new Promise((resolve) => {
    const inner =
      `& '${psQuote(rt.provisionElevatedScript())}' -Payload '${psQuote(payloadPath)}'; exit $LASTEXITCODE`;
    const encoded = Buffer.from(inner, 'utf16le').toString('base64');
    const outer =
      `$p = Start-Process -FilePath '${psQuote(PS_EXE)}' ` +
      `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}') ` +
      `-Verb RunAs -Wait -PassThru; exit $p.ExitCode`;
    execFile(
      PS_EXE,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', outer],
      { windowsHide: true, timeout: 300_000, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        const code = err && typeof err.code === 'number' ? err.code : err ? 1 : 0;
        resolve({ code, stdout: String(stdout || ''), stderr: String(stderr || '') });
      },
    );
  });
}

/**
 * Provision (or re-provision) the service from collected DB creds.
 * @param {{db:{host:number|string,port:number,database:string,user:string,password:string}, frontendDist:string, port:number, logger?:any}} opts
 */
export async function provisionService({ db, frontendDist, port, logger }) {
  // The runtime config — identical shape in dev and prod (service-config.ts +
  // provision-elevated.ps1). This is the SINGLE source of DATABASE_URL.
  const config = {
    version: 1,
    db: {
      host: db.host,
      port: Number(db.port),
      database: db.database,
      user: db.user,
      password: db.password,
    },
    jwtSecret: generateJwtSecret(),
    port,
    frontendDist,
  };

  // The exact bytes that will be persisted as service.json (canonical on-disk
  // shape: top-level `port`, `db.database`). Validate them against the SHARED
  // schema BEFORE writing, so we never persist an invalid config — and so the
  // elevated PowerShell step can write these bytes verbatim without re-declaring
  // the schema.
  const configJson = JSON.stringify(config, null, 2);
  try {
    cfg.parseServiceConfig(configJson);
  } catch (err) {
    return {
      ok: false,
      message: 'إعدادات الخدمة التي تم إنشاؤها غير صالحة.',
      detail: String((err && err.message) || err),
    };
  }

  if (!rt.isPackaged()) {
    // Dev: no Windows service + no elevation. Persist the SAME service.json the
    // elevated step writes in prod, so the dev backend reads its DATABASE_URL
    // from this one source of truth — never from backend/.env.
    try {
      fs.mkdirSync(rt.configDir(), { recursive: true });
      fs.writeFileSync(rt.configFile(), configJson, { encoding: 'utf8' });
      if (logger) logger.info(`[provision] dev runtime config written → ${rt.configFile()} (db=${db.database})`);
      return { ok: true, dev: true };
    } catch (err) {
      return { ok: false, message: 'تعذّر حفظ إعدادات قاعدة البيانات.', detail: String((err && err.message) || err) };
    }
  }

  // Packaged: the elevated step persists these exact (validated) bytes, ACL-locks
  // the config dir, and installs the service. We pass the JSON STRING — not a
  // re-buildable object — so PowerShell only writes bytes (no schema re-declaration).
  const payload = { configJson, backendDir: rt.backendDir() };

  const tmp = path.join(os.tmpdir(), `cp-provision-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });

  // For diagnostics if the elevated step never logs (mirrors runElevatedProvision).
  const psCommand = `${PS_EXE} -Verb RunAs → '${rt.provisionElevatedScript()}' -Payload '${tmp}'`;

  try {
    const { code, stdout, stderr } = await runElevatedProvision(tmp);
    const provisionLog = path.join(rt.logsDir(), 'provision.log');
    const logExists = fs.existsSync(provisionLog);

    // Secondary (non-elevated) diagnostics, ALWAYS written beside the Electron
    // logs — so even if the ProgramData log was never created we have something.
    writeClientLog([
      `=== provision finalize ${new Date().toISOString()} ===`,
      `payload temp    = ${tmp}`,
      `powershell      = ${psCommand}`,
      `elevated exit   = ${code}`,
      `provision.log   = ${provisionLog} (exists=${logExists})`,
      `elevated stdout = ${String(stdout).trim()}`,
      `elevated stderr = ${String(stderr).trim()}`,
    ]);
    if (logger) logger.info(`[provision] elevated exit=${code} provisionLogExists=${logExists}`);

    if (code === 1223) return { ok: false, code, message: 'تم رفض طلب رفع الصلاحيات (UAC).' };

    if (code !== 0) {
      if (logExists) {
        // The elevated step logged install diagnostics to provision.log (its
        // console output cannot cross the UAC boundary). Surface them.
        const logTail = readProvisionLogTail();
        const detail = [logTail, `${stdout}\n${stderr}`.trim()].filter(Boolean).join('\n').trim();
        if (logger) logger.error(`[provision] service install failed (exit=${code}). Diagnostics:\n${detail}`);
        writeClientLog(['---- provision.log tail ----', logTail, '----']);
        const hint = firstMeaningfulLine(logTail);
        return {
          ok: false,
          code,
          message:
            'تعذّر تثبيت الخدمة.' + (hint ? ` السبب: ${hint}` : '') + ` (راجع السجل: ${provisionLog})`,
          detail,
        };
      }
      // No provision.log → the elevated script failed BEFORE logging started, or
      // did not run at all (e.g. the script/PowerShell could not start).
      const detail = `${stdout}\n${stderr}`.trim();
      if (logger) {
        logger.error(
          `[provision] elevated step produced NO log at ${provisionLog} (exit=${code}). ` +
            `payload=${tmp} ps=${psCommand}\nstdout/stderr:\n${detail}`,
        );
      }
      return {
        ok: false,
        code,
        message:
          'لم يتم إنشاء سجل التثبيت. هذا يعني أن السكربت المرتفع فشل قبل بدء التسجيل أو لم يعمل.' +
          ` (المتوقع: ${provisionLog} — راجع أيضًا ${clientLogPath()})`,
        detail,
      };
    }
    return { ok: true, code };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* best-effort shred */
    }
  }
}
