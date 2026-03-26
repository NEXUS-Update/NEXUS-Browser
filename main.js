const { app, BrowserWindow, ipcMain, session, clipboard, shell, net } = require('electron');
const path   = require('path');
const crypto = require('crypto');
const fs     = require('fs');
const os     = require('os');
const { execSync, execFileSync } = require('child_process');

// ─── Ad Block List ────────────────────────────────────────────────────────────
const AD_DOMAINS = [
  'doubleclick.net','googlesyndication.com','googleadservices.com',
  'adservice.google.com','ads.yahoo.com','advertising.com','adnxs.com',
  'taboola.com','outbrain.com','popads.net','adsrvr.org','rubiconproject.com',
  'openx.net','pubmatic.com','criteo.com','media.net','adroll.com',
  'quantserve.com','scorecardresearch.com','moatads.com','pagead2.googlesyndication.com',
  'ads.twitter.com','facebook.com/tr','connect.facebook.net','amazon-adsystem.com',
  'bing.com/act/','bat.bing.com','pixel.advertising.com','cdn.ampproject.org/v0/amp-ad',
  'static.ads-twitter.com','ads.linkedin.com','platform.linkedin.com/in.js',
  'snap.licdn.com','analytics.tiktok.com','sc-static.net/scevent.min.js'
];

let adBlockEnabled = true;
let mainWindow;
let downloads = [];
const configPath = path.join(app.getPath('userData'), 'nexus-config.json');

// ─── Config ───────────────────────────────────────────────────────────────────
function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function saveConfig(data) {
  try { fs.writeFileSync(configPath, JSON.stringify(data, null, 2)); } catch (e) {}
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'nexus-salt-v1').digest('hex');
}

// ─── App Ready ────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  const config = loadConfig();

  // Setup ad blocking on the default session
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['*://*/*'] },
    (details, callback) => {
      if (!adBlockEnabled) return callback({ cancel: false });
      const url = details.url.toLowerCase();
      const blocked = AD_DOMAINS.some(d => url.includes(d));
      callback({ cancel: blocked });
    }
  );

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      sandbox: false,
    },
    frame: false,
    backgroundColor: '#06060f',
    show: false,
    // ── Custom app icon ──────────────────────────────────────────────────────
    // Drop icon.ico (Windows), icon.icns (Mac), icon.png (Linux) in assets/
    icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico'
                                       : process.platform === 'darwin' ? 'icon.icns'
                                       : 'icon.png'),
  });

  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // ─── Download Tracking ──────────────────────────────────────────────────────
  session.defaultSession.on('will-download', (event, item) => {
    const dlId = Date.now();
    const dl = {
      id:            dlId,
      filename:      item.getFilename(),
      url:           item.getURL(),
      totalBytes:    item.getTotalBytes(),
      receivedBytes: 0,
      state:         'downloading',
      savePath:      '',
      startTime:     Date.now(),
    };
    downloads.unshift(dl);
    if (downloads.length > 50) downloads = downloads.slice(0, 50);
    mainWindow.webContents.send('download-started', { ...dl });

    item.on('updated', (_ev, state) => {
      const received = item.getReceivedBytes();
      dl.receivedBytes = received;
      dl.state = state;
      mainWindow.webContents.send('download-updated', {
        id: dlId, receivedBytes: received,
        totalBytes: item.getTotalBytes(), state
      });
    });

    item.once('done', (_ev, state) => {
      dl.state    = state;
      dl.savePath = item.getSavePath();
      mainWindow.webContents.send('download-done', {
        id: dlId, state, savePath: dl.savePath, filename: dl.filename
      });
    });
  });

  // ─── IPC: Password ──────────────────────────────────────────────────────────
  ipcMain.handle('has-password',    ()           => !!loadConfig().passwordHash);

  ipcMain.handle('verify-password', (_, pwd) => {
    const cfg = loadConfig();
    if (!cfg.passwordHash) return { valid: true, isNew: true };
    return { valid: hashPassword(pwd) === cfg.passwordHash };
  });

  ipcMain.handle('set-password',    (_, pwd) => {
    const cfg = loadConfig();
    cfg.passwordHash = hashPassword(pwd);
    saveConfig(cfg);
    return true;
  });

  ipcMain.handle('change-password', (_, oldPwd, newPwd) => {
    const cfg = loadConfig();
    if (cfg.passwordHash && hashPassword(oldPwd) !== cfg.passwordHash) {
      return { success: false, error: 'Incorrect current password' };
    }
    cfg.passwordHash = hashPassword(newPwd);
    saveConfig(cfg);
    return { success: true };
  });

  // ─── IPC: Window Controls ───────────────────────────────────────────────────
  ipcMain.handle('win-minimize',    () => mainWindow.minimize());
  ipcMain.handle('win-maximize',    () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
  ipcMain.handle('win-close',       () => mainWindow.close());
  ipcMain.handle('win-is-max',      () => mainWindow.isMaximized());
  ipcMain.handle('toggle-fullscreen', () => {
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    return mainWindow.isFullScreen();
  });

  // ─── IPC: Clipboard ─────────────────────────────────────────────────────────
  ipcMain.handle('clipboard-read',  () => ({
    text:  clipboard.readText() || '',
    image: clipboard.readImage().isEmpty() ? null : clipboard.readImage().toDataURL(),
  }));
  ipcMain.handle('clipboard-write', (_, text) => { clipboard.writeText(text); return true; });

  // ─── IPC: Shell / External ──────────────────────────────────────────────────
  ipcMain.handle('open-external',       (_, url)      => shell.openExternal(url));
  ipcMain.handle('show-item-in-folder', (_, filePath) => shell.showItemInFolder(filePath));

  // ─── IPC: App Info ──────────────────────────────────────────────────────────
  ipcMain.handle('get-app-version', () => app.getVersion());

  // ─── IPC: Ad Block ──────────────────────────────────────────────────────────
  ipcMain.handle('adblock-toggle', (_, enabled) => {
    adBlockEnabled = enabled;
    return adBlockEnabled;
  });
  ipcMain.handle('adblock-state', () => adBlockEnabled);

  // ─── IPC: Downloads ─────────────────────────────────────────────────────────
  ipcMain.handle('get-downloads',   () => downloads);
  ipcMain.handle('clear-downloads', () => { downloads = []; return true; });
  // ─── IPC: App Path (sync, used by renderer to set webview preload) ─────────
  ipcMain.on('get-app-path-sync', (event) => { event.returnValue = __dirname; });

  // ─── IPC: Read file as base64 (for custom file-picker injection) ─────────
  ipcMain.handle('read-file-for-upload', (_, filePath) => {
    try {
      const buf  = fs.readFileSync(filePath);
      const ext  = path.extname(filePath).toLowerCase().replace('.', '');
      const mimeMap = {
        png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif',
        webp:'image/webp', svg:'image/svg+xml', pdf:'application/pdf',
        txt:'text/plain', csv:'text/csv', json:'application/json',
        zip:'application/zip', mp4:'video/mp4', mp3:'audio/mpeg',
      };
      const type = mimeMap[ext] || 'application/octet-stream';
      return { name: path.basename(filePath), type, base64: buf.toString('base64') };
    } catch (e) {
      return { error: e.message };
    }
  });

  // ─── IPC: Check for updates (uses Electron net, avoids renderer fetch issues)
  ipcMain.handle('check-for-updates', async (_, url) => {
    return new Promise((resolve) => {
      const request = net.request({ url, method: 'GET' });
      let body = '';
      request.on('response', (res) => {
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try   { resolve({ ok: true, data: JSON.parse(body) }); }
          catch  { resolve({ ok: false, error: 'Invalid JSON in version file' }); }
        });
      });
      request.on('error', (err) => resolve({ ok: false, error: err.message }));
      request.end();
    });
  });

  // ─── IPC: Get browser info (paths + availability) ───────────────────────
  ipcMain.handle('get-browser-info', () => {
    const result = { chrome: null, operaGX: null, edge: null };
    if (process.platform === 'win32') {
      const local   = process.env.LOCALAPPDATA  || '';
      const appdata = process.env.APPDATA        || '';
      const testBrowser = (userData) => {
        if (!fs.existsSync(userData)) return null;
        const cookieNew = path.join(userData, 'Default', 'Network', 'Cookies');
        const cookieOld = path.join(userData, 'Default', 'Cookies');
        const cookiePath = fs.existsSync(cookieNew) ? cookieNew : fs.existsSync(cookieOld) ? cookieOld : null;
        return cookiePath ? { userData, cookiePath } : null;
      };
      result.chrome  = testBrowser(path.join(local,   'Google', 'Chrome', 'User Data'));
      result.operaGX = testBrowser(path.join(appdata, 'Opera Software', 'Opera GX Stable'));
      result.edge    = testBrowser(path.join(local,   'Microsoft', 'Edge', 'User Data'));
    } else if (process.platform === 'darwin') {
      const home = os.homedir();
      const testBrowser = (userData) => {
        if (!fs.existsSync(userData)) return null;
        const cookiePath = path.join(userData, 'Default', 'Cookies');
        return fs.existsSync(cookiePath) ? { userData, cookiePath } : null;
      };
      result.chrome = testBrowser(path.join(home, 'Library', 'Application Support', 'Google', 'Chrome'));
      result.edge   = testBrowser(path.join(home, 'Library', 'Application Support', 'Microsoft Edge'));
    }
    return result;
  });

  // ─── IPC: Import browser cookies ─────────────────────────────────────────
  ipcMain.handle('import-browser-cookies', async (_, { userData, cookiePath }) => {
    try {
      // Copy DB to temp (browser may have it locked)
      const tmpDb = path.join(app.getPath('temp'), `nexus-cookie-import-${Date.now()}.db`);
      fs.copyFileSync(cookiePath, tmpDb);

      // Get AES decryption key (Windows only, Chrome v80+)
      let aesKey = null;
      if (process.platform === 'win32') {
        try {
          const localStatePath = path.join(userData, 'Local State');
          if (fs.existsSync(localStatePath)) {
            const ls          = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
            const encKeyB64   = ls?.os_crypt?.encrypted_key;
            if (encKeyB64) {
              const encKeyBuf = Buffer.from(encKeyB64, 'base64').slice(5); // strip 'DPAPI'
              const b64input  = encKeyBuf.toString('base64');
              const ps = `[Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String('${b64input}'),$null,'CurrentUser'))`;
              const out = execSync(`powershell -NoProfile -NonInteractive -Command "${ps}"`, { timeout: 10000 }).toString().trim();
              aesKey = Buffer.from(out, 'base64');
            }
          }
        } catch (keyErr) {
          console.warn('[NEXUS] Could not decrypt AES key:', keyErr.message);
        }
      }

      // Read SQLite without external deps — minimal B-tree page walker
      const cookies = readCookiesSQLite(tmpDb, aesKey);
      fs.unlinkSync(tmpDb);

      if (!cookies || !cookies.length) return { count: 0, error: 'No cookies found or could not read database' };

      // Inject into Nexus session
      const ses = session.fromPartition('persist:nexusbrowser');
      let imported = 0;
      for (const c of cookies) {
        try {
          const domain = c.host_key || '';
          const url    = (c.is_secure ? 'https' : 'http') + '://' + domain.replace(/^\./, '');
          await ses.cookies.set({
            url,
            name:           c.name,
            value:          c.decryptedValue || c.value || '',
            domain,
            path:           c.path || '/',
            secure:         !!c.is_secure,
            httpOnly:       !!c.is_httponly,
            expirationDate: c.expires_utc > 0
              ? Math.floor(c.expires_utc / 1000000 - 11644473600)
              : undefined,
          });
          imported++;
        } catch { /* skip malformed cookies */ }
      }
      return { count: imported };
    } catch (err) {
      return { error: err.message };
    }
  });
});

// ─── Minimal SQLite cookie reader (no external deps) ──────────────────────
// Reads just enough of the SQLite B-tree to extract rows from the "cookies" table.
// Works with Chrome-family cookie databases (schema known).
function readCookiesSQLite(dbPath, aesKey) {
  try {
    const buf  = fs.readFileSync(dbPath);
    const rows = parseSQLiteCookies(buf);
    if (aesKey) {
      rows.forEach(r => {
        if (r.encrypted_value && r.encrypted_value.length > 3) {
          r.decryptedValue = decryptChromeValue(r.encrypted_value, aesKey);
        } else {
          r.decryptedValue = r.value || '';
        }
      });
    } else {
      rows.forEach(r => { r.decryptedValue = r.value || ''; });
    }
    return rows;
  } catch { return []; }
}

function decryptChromeValue(encBuf, key) {
  try {
    const buf    = Buffer.isBuffer(encBuf) ? encBuf : Buffer.from(encBuf);
    const prefix = buf.slice(0, 3).toString('ascii');
    if (prefix === 'v10' || prefix === 'v11') {
      const nonce      = buf.slice(3, 15);
      const ciphertext = buf.slice(15, buf.length - 16);
      const authTag    = buf.slice(buf.length - 16);
      const decipher   = crypto.createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAuthTag(authTag);
      return decipher.update(ciphertext).toString() + decipher.final().toString();
    }
    // Old DPAPI-encrypted value (rare) — return empty, we already got the AES key
    return '';
  } catch { return ''; }
}

// ── Very small SQLite file parser ──────────────────────────────────────────
// Only handles the leaf pages of the cookies table; skips interior pages.
// Enough for 99% of real-world Chrome cookie files.
function parseSQLiteCookies(buf) {
  const pageSize = buf.readUInt16BE(16) || 4096;
  const pageCount = buf.readUInt32BE(28);
  const results = [];

  // Chrome cookies table columns (fixed schema):
  // 0:creation_utc 1:host_key 2:top_frame_site_key 3:name 4:value
  // 5:encrypted_value 6:path 7:expires_utc 8:is_secure 9:is_httponly
  // 10:last_access_utc 11:has_expires 12:is_persistent 13:priority
  // 14:samesite 15:source_scheme 16:source_port 17:last_update_utc
  // Older Chrome schema (no top_frame_site_key):
  // 0:creation_utc 1:host_key 2:name 3:value 4:encrypted_value
  // 5:path 6:expires_utc 7:is_secure 8:is_httponly ...

  for (let pg = 0; pg < Math.min(pageCount, 2000); pg++) {
    const offset = pg * pageSize;
    if (offset + pageSize > buf.length) break;
    const headerOff = pg === 0 ? 100 : 0;
    const pageType  = buf[offset + headerOff];
    if (pageType !== 0x0d) continue; // only leaf table B-tree pages

    const cellCount = buf.readUInt16BE(offset + headerOff + 3);
    const cellStart = headerOff + 8;
    for (let c = 0; c < Math.min(cellCount, 500); c++) {
      const cellPtrOff = offset + headerOff + 8 + c * 2;
      if (cellPtrOff + 2 > offset + pageSize) break;
      const cellOff = offset + buf.readUInt16BE(cellPtrOff);
      if (cellOff < offset || cellOff + 4 >= offset + pageSize) continue;
      try {
        const row = parseSQLiteRecord(buf, cellOff, pageSize);
        if (row && row.length >= 8) {
          // Try new schema first (has top_frame_site_key at index 2)
          const isNewSchema = row.length >= 16;
          const r = isNewSchema ? {
            host_key:        toString(row[1]),
            name:            toString(row[3]),
            value:           toString(row[4]),
            encrypted_value: toBuffer(row[5]),
            path:            toString(row[6]),
            expires_utc:     toInt(row[7]),
            is_secure:       toInt(row[8]),
            is_httponly:     toInt(row[9]),
          } : {
            host_key:        toString(row[1]),
            name:            toString(row[2]),
            value:           toString(row[3]),
            encrypted_value: toBuffer(row[4]),
            path:            toString(row[5]),
            expires_utc:     toInt(row[6]),
            is_secure:       toInt(row[7]),
            is_httponly:     toInt(row[8]),
          };
          if (r.name || r.host_key) results.push(r);
        }
      } catch { /* skip bad record */ }
    }
  }
  return results;
}

function toString(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (Buffer.isBuffer(v)) return v.toString('utf8');
  return String(v);
}
function toBuffer(v) {
  if (!v) return null;
  if (Buffer.isBuffer(v)) return v;
  if (typeof v === 'string') return Buffer.from(v, 'binary');
  return null;
}
function toInt(v) { return parseInt(v) || 0; }

function parseSQLiteRecord(buf, cellOff, pageSize) {
  let pos = cellOff;
  const [payloadLen, pl] = readVarint(buf, pos); pos += pl;
  const [rowId,      rl] = readVarint(buf, pos); pos += rl;
  const payloadStart = pos;
  const [headerLen,  hl] = readVarint(buf, pos); pos += hl;
  const headerEnd = payloadStart + headerLen;

  const types = [];
  while (pos < headerEnd) {
    const [t, tl] = readVarint(buf, pos); pos += tl;
    types.push(t);
  }

  const values = [];
  for (const t of types) {
    if (t === 0) { values.push(null); continue; }
    if (t === 1) { values.push(buf.readInt8(pos));   pos += 1; continue; }
    if (t === 2) { values.push(buf.readInt16BE(pos)); pos += 2; continue; }
    if (t === 3) { values.push(buf.readIntBE(pos, 3)); pos += 3; continue; }
    if (t === 4) { values.push(buf.readInt32BE(pos)); pos += 4; continue; }
    if (t === 5) { values.push(buf.readIntBE(pos, 6)); pos += 6; continue; }
    if (t === 6) { values.push(Number(buf.readBigInt64BE(pos))); pos += 8; continue; }
    if (t === 7) { values.push(buf.readDoubleBE(pos)); pos += 8; continue; }
    if (t === 8) { values.push(0); continue; }
    if (t === 9) { values.push(1); continue; }
    if (t >= 12 && t % 2 === 0) {
      const len = (t - 12) / 2;
      values.push(buf.slice(pos, pos + len));
      pos += len;
      continue;
    }
    if (t >= 13 && t % 2 === 1) {
      const len = (t - 13) / 2;
      values.push(buf.slice(pos, pos + len).toString('utf8'));
      pos += len;
      continue;
    }
    values.push(null);
  }
  return values;
}

function readVarint(buf, pos) {
  let result = 0, shift = 0, len = 0;
  while (pos + len < buf.length) {
    const byte = buf[pos + len]; len++;
    result |= (byte & 0x7f) << shift;
    shift += 7;
    if (!(byte & 0x80)) break;
    if (len >= 9) break;
  }
  return [result, len];
}

// Keep app.on at the very end (was already there)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
