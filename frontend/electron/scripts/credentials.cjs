/**
 * credentials.cjs — export the first-run owner credentials to a file the
 * operator can keep. TXT is written directly; PDF is rendered via Electron's
 * own printToPDF on an offscreen window (no extra PDF dependency).
 */
const fs = require('node:fs');
const { BrowserWindow, dialog } = require('electron');

function credentialText(cred) {
  return [
    cred.appName,
    '====================================',
    `اسم المستخدم : ${cred.username}`,
    `رمز الدخول   : ${cred.pin}`,
    `تاريخ الإنشاء: ${cred.createdAt}`,
    '',
    'احتفظ بهذه البيانات في مكان آمن. لا تشاركها مع أحد.',
  ].join('\r\n');
}

async function exportTxt(cred, { win } = {}) {
  const { canceled, filePath } = await dialog.showSaveDialog(win ?? null, {
    title: 'حفظ بيانات الدخول',
    defaultPath: 'contractor-plus-credentials.txt',
    filters: [{ name: 'Text', extensions: ['txt'] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(filePath, credentialText(cred), 'utf8');
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: String(err && err.message) };
  }
}

function credentialHtml(cred) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<style>
  body{font-family:'Segoe UI',Tahoma,sans-serif;margin:48px;color:#1a1a1a}
  h1{font-size:22px;margin-bottom:24px}
  table{border-collapse:collapse;font-size:16px}
  td{padding:8px 16px;border:1px solid #ccc}
  .k{background:#f4f4f4;font-weight:600}
  .note{margin-top:32px;color:#a00;font-size:13px}
</style></head><body>
  <h1>${esc(cred.appName)} — بيانات الدخول</h1>
  <table>
    <tr><td class="k">اسم المستخدم</td><td>${esc(cred.username)}</td></tr>
    <tr><td class="k">رمز الدخول</td><td>${esc(cred.pin)}</td></tr>
    <tr><td class="k">تاريخ الإنشاء</td><td>${esc(cred.createdAt)}</td></tr>
  </table>
  <p class="note">احتفظ بهذه البيانات في مكان آمن. لا تشاركها مع أحد.</p>
</body></html>`;
}

async function exportPdf(cred, { win } = {}) {
  const { canceled, filePath } = await dialog.showSaveDialog(win ?? null, {
    title: 'حفظ بيانات الدخول (PDF)',
    defaultPath: 'contractor-plus-credentials.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };

  const offscreen = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    await offscreen.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(credentialHtml(cred)));
    const pdf = await offscreen.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
    fs.writeFileSync(filePath, pdf);
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: String(err && err.message) };
  } finally {
    offscreen.destroy();
  }
}

module.exports = { exportTxt, exportPdf };
