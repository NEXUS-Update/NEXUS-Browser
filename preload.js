const { contextBridge, ipcRenderer } = require('electron');

// Expose app path synchronously so renderer can set webview preload
const appPath = ipcRenderer.sendSync('get-app-path-sync');

contextBridge.exposeInMainWorld('nexus', {
  // ── App path (for webview preload attribute) ─────────────────────────────
  appPath,

  // ── Password ────────────────────────────────────────────────────────────────
  hasPassword:     ()           => ipcRenderer.invoke('has-password'),
  verifyPassword:  (pwd)        => ipcRenderer.invoke('verify-password', pwd),
  setPassword:     (pwd)        => ipcRenderer.invoke('set-password', pwd),
  changePassword:  (old, nw)    => ipcRenderer.invoke('change-password', old, nw),

  // ── Window ──────────────────────────────────────────────────────────────────
  minimize:        ()           => ipcRenderer.invoke('win-minimize'),
  maximize:        ()           => ipcRenderer.invoke('win-maximize'),
  close:           ()           => ipcRenderer.invoke('win-close'),
  isMaximized:     ()           => ipcRenderer.invoke('win-is-max'),
  toggleFullscreen:()           => ipcRenderer.invoke('toggle-fullscreen'),

  // ── Clipboard ───────────────────────────────────────────────────────────────
  readClipboard:   ()           => ipcRenderer.invoke('clipboard-read'),
  writeClipboard:  (text)       => ipcRenderer.invoke('clipboard-write', text),

  // ── Shell / External ────────────────────────────────────────────────────────
  openExternal:    (url)        => ipcRenderer.invoke('open-external', url),
  showInFolder:    (path)       => ipcRenderer.invoke('show-item-in-folder', path),

  // ── App Info ────────────────────────────────────────────────────────────────
  getVersion:      ()           => ipcRenderer.invoke('get-app-version'),

  // ── Ad Block ────────────────────────────────────────────────────────────────
  toggleAdBlock:   (enabled)    => ipcRenderer.invoke('adblock-toggle', enabled),
  getAdBlockState: ()           => ipcRenderer.invoke('adblock-state'),

  // ── Downloads ───────────────────────────────────────────────────────────────
  getDownloads:    ()           => ipcRenderer.invoke('get-downloads'),
  clearDownloads:  ()           => ipcRenderer.invoke('clear-downloads'),
  onDownloadStarted: (cb) => ipcRenderer.on('download-started', (_, d) => cb(d)),
  onDownloadUpdated: (cb) => ipcRenderer.on('download-updated', (_, d) => cb(d)),
  onDownloadDone:    (cb) => ipcRenderer.on('download-done',    (_, d) => cb(d)),

  // ── File Upload Picker ──────────────────────────────────────────────────────
  readFileForUpload: (filePath) => ipcRenderer.invoke('read-file-for-upload', filePath),

  // ── Update Check (uses main-process net, more reliable than renderer fetch) ─
  checkForUpdates: (url)        => ipcRenderer.invoke('check-for-updates', url),

  // ── Cookie Import ───────────────────────────────────────────────────────────
  getBrowserInfo:       ()      => ipcRenderer.invoke('get-browser-info'),
  importBrowserCookies: (opts)  => ipcRenderer.invoke('import-browser-cookies', opts),
});
