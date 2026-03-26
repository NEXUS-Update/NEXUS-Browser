/* ═══════════════════════════════════════════════════════════════════════════
   NEXUS Browser — Webview Preload
   Runs inside each webview page; intercepts file-input clicks so the
   renderer can show the custom clipboard/downloads file-picker overlay.
════════════════════════════════════════════════════════════════════════════ */
'use strict';

const { ipcRenderer } = require('electron');

let lastFileInput = null;

// ─── Intercept <input type="file"> clicks ──────────────────────────────────
document.addEventListener('click', (e) => {
  const inp = e.target.closest('input[type="file"], input[type="FILE"]');
  if (!inp) return;

  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  lastFileInput = inp;
  ipcRenderer.sendToHost('file-pick-request', {
    accept:   inp.accept   || '',
    multiple: inp.multiple || false,
  });
}, true);

// ─── Receive selected file data from renderer ──────────────────────────────
ipcRenderer.on('inject-file', (_, { name, type, base64 }) => {
  if (!lastFileInput) return;
  try {
    const bytes  = atob(base64);
    const arr    = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const file   = new File([arr], name, { type });
    const dt     = new DataTransfer();
    dt.items.add(file);
    lastFileInput.files = dt.files;
    lastFileInput.dispatchEvent(new Event('change', { bubbles: true }));
    lastFileInput.dispatchEvent(new Event('input',  { bubbles: true }));
  } catch (err) {
    console.warn('[NEXUS] inject-file error:', err);
  }
  lastFileInput = null;
});
