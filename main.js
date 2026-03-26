const { app, BrowserWindow, ipcMain, session, clipboard, shell } = require('electron');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

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
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
