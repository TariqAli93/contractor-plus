/**
 * provision.cjs — write the runtime service config + (re)install the Windows
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
const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const rt = require('./runtime.cjs');

const SYSROOT = process.env.SystemRoot || 'C:\\Windows';
const PS_EXE = path.join(SYSROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

function generateJwtSecret() {
  return crypto.randomBytes(32).toString('hex'); // 64 hex chars >= 32 required
}

function psQuote(s) {
  return String(s).replace(/'/g, "''");
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
async function provisionService({ db, frontendDist, port, logger }) {
  if (!rt.isPackaged()) {
    // Dev: there is no Windows service — the setup marker is enough.
    return { ok: true, dev: true };
  }

  const payload = {
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
    backendDir: rt.backendDir(),
  };

  const tmp = path.join(os.tmpdir(), `cp-provision-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });

  try {
    const { code, stdout, stderr } = await runElevatedProvision(tmp);
    if (logger) logger.info(`[provision] elevated exit=${code}`);
    if (code === 1223) return { ok: false, code, message: 'تم رفض طلب رفع الصلاحيات (UAC).' };
    if (code !== 0) {
      return { ok: false, code, message: 'تعذّر تثبيت الخدمة.', detail: `${stdout}\n${stderr}`.trim() };
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

module.exports = { provisionService, generateJwtSecret };
