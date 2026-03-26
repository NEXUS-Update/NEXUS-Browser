/* ═══════════════════════════════════════════════════════════════════════════
   NEXUS Browser — Renderer Process
   Tabs, navigation, bookmarks, history, clipboard, gaming hub, snake,
   find-in-page, zoom, password manager, download tracker, bookmark import,
   auto-update checker, full keyboard shortcuts.
════════════════════════════════════════════════════════════════════════════ */

'use strict';

// ─── State ───────────────────────────────────────────────────────────────────
let tabs        = [];
let activeTabId = null;
let webviews    = {};
let closedTabs  = [];   // for Ctrl+Shift+T reopen
let zoomLevels  = {};   // tabId → zoom factor (1.0 = 100%)

let bookmarks   = JSON.parse(localStorage.getItem('nx-bookmarks')  || '[]');
let history     = JSON.parse(localStorage.getItem('nx-history')    || '[]');
let settings    = JSON.parse(localStorage.getItem('nx-settings')   || '{}');
let passwords   = decodePasswords(localStorage.getItem('nx-passwords') || '');

const defaultSettings = {
  searchEngine: 'https://google.com/search?q=',
  homepage:     'nexus://newtab',
  accent:       '#7c3aed',
  updateUrl:    '',
  defaultZoom:  1.0,
};
settings = { ...defaultSettings, ...settings };

let adBlockOn     = true;
let currentPanel  = null;
let modalCallback = null;
let snakeGame     = null;
let findActive    = false;
let filePickTabId = null;   // which tab triggered the file-pick overlay

// ─── Downloads state ──────────────────────────────────────────────────────────
let downloadsData = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function toast(msg, dur = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), dur);
}

function isURL(str) {
  try {
    const u = new URL(str.startsWith('http') ? str : 'https://' + str);
    return u.hostname.includes('.');
  } catch { return false; }
}

function normalizeURL(str) {
  str = str.trim();
  if (!str) return getNewTabBlobURL();
  if (str === 'nexus://newtab' || str === 'about:blank') return getNewTabBlobURL();
  if (str.startsWith('http://') || str.startsWith('https://') || str.startsWith('file://')) return str;
  if (isURL(str)) return 'https://' + str;
  return settings.searchEngine + encodeURIComponent(str);
}

function saveBookmarks()  { localStorage.setItem('nx-bookmarks', JSON.stringify(bookmarks));   }
function saveHistory()    { localStorage.setItem('nx-history',   JSON.stringify(history));     }
function saveSettings()   { localStorage.setItem('nx-settings',  JSON.stringify(settings));    }
function savePasswords()  { localStorage.setItem('nx-passwords', encodePasswords(passwords));  }

function applyAccent(color) {
  document.documentElement.style.setProperty('--accent', color);
  const r = parseInt(color.slice(1,3),16),
        g = parseInt(color.slice(3,5),16),
        b = parseInt(color.slice(5,7),16);
  document.documentElement.style.setProperty('--glow', `rgba(${r},${g},${b},0.35)`);
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Password Encode/Decode (basic obfuscation for localStorage) ───────────────
function encodePasswords(data) {
  if (!data || !data.length) return '';
  try { return btoa(unescape(encodeURIComponent(JSON.stringify(data)))); } catch { return ''; }
}
function decodePasswords(str) {
  if (!str) return [];
  try { return JSON.parse(decodeURIComponent(escape(atob(str)))); } catch { return []; }
}

// ─── New Tab Page ─────────────────────────────────────────────────────────────
let _newTabBlobURL = null;
function getNewTabBlobURL() {
  if (_newTabBlobURL) return _newTabBlobURL;
  const html = `<!DOCTYPE html><html><head>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:linear-gradient(135deg,#06060f 0%,#0f0f2e 100%);color:#e2e8f0;
  font-family:'JetBrains Mono',monospace;height:100vh;display:flex;
  flex-direction:column;align-items:center;justify-content:center;overflow:hidden}
.grid-bg{position:fixed;inset:0;
  background-image:linear-gradient(rgba(124,58,237,.06) 1px,transparent 1px),
  linear-gradient(90deg,rgba(124,58,237,.06) 1px,transparent 1px);
  background-size:40px 40px;animation:drift 20s linear infinite;z-index:0}
@keyframes drift{to{background-position:40px 40px}}
.content{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center}
.logo{font-family:'Orbitron',sans-serif;font-size:2.5rem;font-weight:900;
  letter-spacing:10px;color:#7c3aed;
  filter:drop-shadow(0 0 20px rgba(124,58,237,.6));margin-bottom:4px}
.tag{font-size:.65rem;letter-spacing:5px;color:#06b6d4;margin-bottom:40px}
.search{background:rgba(255,255,255,.04);border:1px solid rgba(124,58,237,.3);
  border-radius:30px;padding:14px 28px;width:580px;color:#e2e8f0;
  font-family:'JetBrains Mono',monospace;font-size:1rem;outline:none;
  transition:all .2s}
.search:focus{border-color:#7c3aed;box-shadow:0 0 24px rgba(124,58,237,.3)}
.links{display:flex;gap:12px;margin-top:36px;flex-wrap:wrap;justify-content:center}
.lk{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);
  border-radius:10px;padding:14px 16px;cursor:pointer;text-align:center;
  text-decoration:none;color:#64748b;transition:all .2s;font-size:.72rem;min-width:80px}
.lk:hover{background:rgba(124,58,237,.15);border-color:rgba(124,58,237,.5);color:#e2e8f0;
  transform:translateY(-2px);box-shadow:0 4px 16px rgba(124,58,237,.2)}
.lk-icon{font-size:1.4rem;margin-bottom:4px}
.clock{position:fixed;top:20px;right:28px;font-size:1.4rem;color:#1e1e3f;
  font-family:'Orbitron',sans-serif}
</style>
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@900&family=JetBrains+Mono&display=swap" rel="stylesheet">
</head><body>
<div class="grid-bg"></div>
<div class="clock" id="clk"></div>
<div class="content">
<div class="logo">⬡ NEXUS</div>
<div class="tag">THE GAMER'S BROWSER</div>
<input class="search" id="s" placeholder="Search the web or enter a URL…" autofocus>
<div class="links">
  <a class="lk" href="https://store.steampowered.com"><div class="lk-icon">🎮</div>Steam</a>
  <a class="lk" href="https://www.twitch.tv"><div class="lk-icon">📺</div>Twitch</a>
  <a class="lk" href="https://www.youtube.com/gaming"><div class="lk-icon">▶</div>YouTube</a>
  <a class="lk" href="https://www.epicgames.com/store"><div class="lk-icon">⚡</div>Epic</a>
  <a class="lk" href="https://discord.com/app"><div class="lk-icon">💬</div>Discord</a>
  <a class="lk" href="https://www.reddit.com/r/gaming"><div class="lk-icon">🎯</div>r/gaming</a>
  <a class="lk" href="https://itch.io"><div class="lk-icon">🕹</div>itch.io</a>
  <a class="lk" href="https://www.gog.com"><div class="lk-icon">🔮</div>GOG</a>
  <a class="lk" href="https://www.ign.com"><div class="lk-icon">📰</div>IGN</a>
  <a class="lk" href="https://www.pcgamingwiki.com"><div class="lk-icon">📖</div>PCGWiki</a>
</div>
</div>
<script>
function tick(){const n=new Date();document.getElementById('clk').textContent=
  n.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}
tick();setInterval(tick,1000);
document.getElementById('s').addEventListener('keydown',e=>{
  if(e.key==='Enter'){const v=e.target.value.trim();if(!v)return;
    const u=v.startsWith('http')||v.match(/^[\\w-]+\\.[a-z]{2,}/)?
      (v.startsWith('http')?v:'https://'+v):
      'https://google.com/search?q='+encodeURIComponent(v);
    window.location.href=u;}
});
<\/script>
</body></html>`;
  const blob = new Blob([html], { type: 'text/html' });
  _newTabBlobURL = URL.createObjectURL(blob);
  return _newTabBlobURL;
}

// ─── Tab Management ───────────────────────────────────────────────────────────
function createTab(url) {
  const id  = Date.now();
  const src = normalizeURL(url || 'nexus://newtab');
  const tab = { id, url: src, title: 'New Tab', favicon: null, loading: false, pinned: false };
  tabs.push(tab);

  const wv = document.createElement('webview');
  wv.id = `wv-${id}`;
  wv.setAttribute('partition', 'persist:nexusbrowser');
  wv.setAttribute('allowpopups', '');
  // Webview preload for file-picker interception
  if (window.nexus.appPath) {
    wv.setAttribute('preload', `file://${window.nexus.appPath}/webview-preload.js`);
  }
  wv.src = src;
  $('#webview-container').appendChild(wv);
  webviews[id] = wv;

  // ── IPC messages from webview-preload.js ────────────────────────────────
  wv.addEventListener('ipc-message', (e) => {
    if (e.channel === 'file-pick-request') {
      openFilePicker(id, e.args[0] || {});
    }
  });

  // Events
  wv.addEventListener('did-start-loading', () => {
    getTab(id).loading = true;
    renderTabs();
    if (id === activeTabId) $('#loading-bar').classList.remove('hidden');
  });
  wv.addEventListener('did-stop-loading', () => {
    getTab(id).loading = false;
    renderTabs();
    if (id === activeTabId) {
      $('#loading-bar').classList.add('hidden');
      updateNavButtons();
    }
  });
  wv.addEventListener('did-navigate', (e) => {
    const t = getTab(id);
    t.url = e.url;
    if (id === activeTabId) updateUrlBar(e.url);
    addToHistory(t.title || 'Untitled', e.url);
    updateNavButtons();
  });
  wv.addEventListener('did-navigate-in-page', (e) => {
    if (!e.isMainFrame) return;
    getTab(id).url = e.url;
    if (id === activeTabId) updateUrlBar(e.url);
  });
  wv.addEventListener('page-title-updated', (e) => {
    getTab(id).title = e.title || 'Untitled';
    if (id === activeTabId) updateWindowTitle(e.title);
    renderTabs();
  });
  wv.addEventListener('page-favicon-updated', (e) => {
    if (e.favicons && e.favicons.length) getTab(id).favicon = e.favicons[0];
    renderTabs();
  });
  wv.addEventListener('new-window', (e) => { createTab(e.url); });

  // Find-in-page result handler
  wv.addEventListener('found-in-page', (e) => {
    const { activeMatchOrdinal, matches } = e.result;
    const countEl = $('#find-count');
    if (countEl) {
      countEl.textContent = matches > 0 ? `${activeMatchOrdinal}/${matches}` : 'No results';
      countEl.style.color = matches === 0 ? 'var(--danger)' : 'var(--text-dim)';
    }
  });

  setActiveTab(id);
  renderTabs();
  return id;
}

function getTab(id) { return tabs.find(t => t.id === id); }

function closeTab(id) {
  const idx  = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  const tab = getTab(id);
  if (tab && !tab.pinned) {
    closedTabs.push({ url: tab.url, title: tab.title });
    if (closedTabs.length > 20) closedTabs.shift();
  }
  const wv = webviews[id];
  if (wv) wv.remove();
  delete webviews[id];
  delete zoomLevels[id];
  tabs.splice(idx, 1);
  if (tabs.length === 0) { createTab(); return; }
  if (activeTabId === id) {
    const newIdx = Math.min(idx, tabs.length - 1);
    setActiveTab(tabs[newIdx].id);
  }
  renderTabs();
}

function reopenLastTab() {
  if (!closedTabs.length) return;
  const last = closedTabs.pop();
  createTab(last.url);
}

function setActiveTab(id) {
  activeTabId = id;
  Object.entries(webviews).forEach(([wid, wv]) => {
    wv.classList.toggle('active', parseInt(wid) === id);
  });
  const tab = getTab(id);
  if (tab) {
    updateUrlBar(tab.url);
    updateWindowTitle(tab.title);
  }
  updateNavButtons();
  updateZoomBadge();
  renderTabs();
  // Re-apply zoom for this tab
  const wv = getActiveWV();
  if (wv) {
    const z = zoomLevels[id] !== undefined ? zoomLevels[id] : (settings.defaultZoom || 1.0);
    try { wv.setZoomFactor(z); } catch(e) {}
  }
}

function switchTabByOffset(offset) {
  if (!tabs.length) return;
  const idx = tabs.findIndex(t => t.id === activeTabId);
  const next = (idx + offset + tabs.length) % tabs.length;
  setActiveTab(tabs[next].id);
}

function renderTabs() {
  const container = $('#tabs-container');
  container.innerHTML = '';
  tabs.forEach(tab => {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === activeTabId ? ' active' : '') + (tab.pinned ? ' pinned' : '');
    el.dataset.id = tab.id;
    el.title = tab.title || 'New Tab';

    let inner = '';
    if (tab.pinned) inner += `<span class="tab-pin-icon" title="Unpin tab">📌</span>`;

    if (tab.loading) {
      inner += `<div class="tab-loading"></div>`;
    } else if (tab.favicon) {
      inner += `<img class="tab-favicon" src="${escHtml(tab.favicon)}" onerror="this.style.display='none'">`;
    } else {
      inner += `<span class="tab-favicon" style="font-size:10px">⬡</span>`;
    }

    el.innerHTML = inner;

    if (!tab.pinned) {
      const title = document.createElement('span');
      title.className = 'tab-title';
      title.textContent = tab.title || 'New Tab';
      el.appendChild(title);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'tab-close';
      closeBtn.textContent = '✕';
      closeBtn.title = 'Close Tab (Ctrl+W)';
      closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeTab(tab.id); });
      el.appendChild(closeBtn);
    }

    el.addEventListener('click', () => setActiveTab(tab.id));

    // Right-click context: pin/unpin
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      tab.pinned = !tab.pinned;
      renderTabs();
      toast(tab.pinned ? '📌 Tab pinned' : '📌 Tab unpinned');
    });

    container.appendChild(el);
  });
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function getActiveWV() { return webviews[activeTabId]; }

function navigate(url) {
  const wv = getActiveWV();
  if (!wv) return;
  const normalized = normalizeURL(url);
  wv.src = normalized;
  getTab(activeTabId).url = normalized;
  updateUrlBar(normalized);
}

function updateUrlBar(url) {
  const bar = $('#urlbar');
  if (document.activeElement !== bar) {
    bar.value = (url && url.startsWith('blob:')) ? '' : (url || '');
  }
  const sec = $('#security-icon');
  if (url && url.startsWith('https://'))      { sec.textContent = '🔒'; sec.title = 'Secure'; }
  else if (url && url.startsWith('http://'))  { sec.textContent = '⚠';  sec.title = 'Not Secure'; }
  else                                         { sec.textContent = '⬡';  sec.title = ''; }
  updateBookmarkBtn();
}

function updateWindowTitle(title) {
  document.title = title ? `${title} — NEXUS` : 'NEXUS Browser';
}

function updateNavButtons() {
  const wv = getActiveWV();
  if (!wv) return;
  try {
    $('#btn-back').disabled    = !wv.canGoBack();
    $('#btn-forward').disabled = !wv.canGoForward();
    $('#btn-reload').textContent = getTab(activeTabId)?.loading ? '✕' : '↺';
  } catch(e) {}
}

// ─── Zoom ─────────────────────────────────────────────────────────────────────
function setZoom(factor) {
  factor = Math.max(0.25, Math.min(5.0, parseFloat(factor.toFixed(2))));
  zoomLevels[activeTabId] = factor;
  const wv = getActiveWV();
  if (wv) try { wv.setZoomFactor(factor); } catch(e) {}
  updateZoomBadge();
}

function adjustZoom(delta) {
  const current = zoomLevels[activeTabId] || 1.0;
  setZoom(current + delta);
}

function resetZoom() { setZoom(1.0); }

function updateZoomBadge() {
  const badge = $('#zoom-badge');
  if (!badge) return;
  const factor = zoomLevels[activeTabId] || 1.0;
  if (Math.abs(factor - 1.0) < 0.01) {
    badge.classList.add('hidden');
  } else {
    badge.textContent = Math.round(factor * 100) + '%';
    badge.classList.remove('hidden');
  }
}

// ─── Find In Page ─────────────────────────────────────────────────────────────
function openFindBar() {
  findActive = true;
  $('#find-bar').classList.remove('hidden');
  const input = $('#find-input');
  input.focus();
  input.select();
}

function closeFindBar() {
  findActive = false;
  $('#find-bar').classList.add('hidden');
  $('#find-count').textContent = '';
  try { getActiveWV()?.stopFindInPage('clearSelection'); } catch(e) {}
}

function doFind(forward = true) {
  const text = $('#find-input').value.trim();
  if (!text) return;
  const wv = getActiveWV();
  if (!wv) return;
  try { wv.findInPage(text, { forward, findNext: true, matchCase: false }); } catch(e) {}
}

$('#find-input')?.addEventListener('input', () => {
  const text = $('#find-input').value.trim();
  if (!text) { $('#find-count').textContent = ''; try { getActiveWV()?.stopFindInPage('clearSelection'); } catch(e) {} return; }
  const wv = getActiveWV();
  if (!wv) return;
  try { wv.findInPage(text, { forward: true, findNext: false, matchCase: false }); } catch(e) {}
});

$('#find-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter')  { e.preventDefault(); doFind(!e.shiftKey); }
  if (e.key === 'Escape') closeFindBar();
});

$('#find-prev')?.addEventListener('click', () => doFind(false));
$('#find-next')?.addEventListener('click', () => doFind(true));
$('#find-close')?.addEventListener('click', closeFindBar);
$('#btn-find')?.addEventListener('click', () => {
  if (findActive) closeFindBar();
  else openFindBar();
});

// ─── History ──────────────────────────────────────────────────────────────────
function addToHistory(title, url) {
  if (!url || url.startsWith('blob:') || url === 'about:blank') return;
  history.unshift({ title, url, time: Date.now() });
  if (history.length > 500) history = history.slice(0, 500);
  saveHistory();
}

function renderHistory(filter = '') {
  const list    = $('#history-list');
  const empty   = $('#history-empty');
  const entries = filter
    ? history.filter(h => h.title.toLowerCase().includes(filter.toLowerCase()) || h.url.toLowerCase().includes(filter.toLowerCase()))
    : history;

  list.innerHTML = '';
  if (!entries.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  entries.slice(0, 200).forEach((h, i) => {
    const el = document.createElement('div');
    el.className = 'panel-item';
    const d = new Date(h.time);
    const timeStr = d.toLocaleDateString() === new Date().toLocaleDateString()
      ? d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})
      : d.toLocaleDateString([], {month:'short',day:'numeric'});
    el.innerHTML = `
      <span class="panel-item-favicon">⏱</span>
      <div class="panel-item-info">
        <div class="panel-item-title">${escHtml(h.title)}</div>
        <div class="panel-item-url">${escHtml(h.url)}</div>
      </div>
      <span class="panel-item-time">${timeStr}</span>
      <button class="panel-item-del" title="Remove">✕</button>`;
    el.querySelector('.panel-item-info').addEventListener('click', () => { navigate(h.url); closeSidebar(); });
    el.querySelector('.panel-item-del').addEventListener('click', (e) => {
      e.stopPropagation();
      const realIdx = history.findIndex(x => x.url === h.url && x.time === h.time);
      if (realIdx !== -1) history.splice(realIdx, 1);
      saveHistory();
      renderHistory(filter);
    });
    list.appendChild(el);
  });
}

// ─── Bookmarks ────────────────────────────────────────────────────────────────
function renderBookmarks(filter = '') {
  const list  = $('#bookmarks-list');
  const empty = $('#bookmarks-empty');
  const items = filter
    ? bookmarks.filter(b => b.title.toLowerCase().includes(filter.toLowerCase()) || b.url.toLowerCase().includes(filter.toLowerCase()))
    : bookmarks;

  list.innerHTML = '';
  if (!items.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  items.forEach((b, i) => {
    const el = document.createElement('div');
    el.className = 'panel-item';
    el.innerHTML = `
      <img class="panel-item-favicon" src="${escHtml(b.favicon || '')}" onerror="this.style.display='none'">
      <div class="panel-item-info">
        <div class="panel-item-title">${escHtml(b.title)}</div>
        <div class="panel-item-url">${escHtml(b.url)}</div>
      </div>
      <button class="panel-item-del" title="Remove Bookmark">✕</button>`;
    el.querySelector('.panel-item-info').addEventListener('click', () => { navigate(b.url); closeSidebar(); });
    el.querySelector('.panel-item-del').addEventListener('click', (e) => {
      e.stopPropagation();
      bookmarks.splice(bookmarks.findIndex(x => x.url === b.url), 1);
      saveBookmarks();
      renderBookmarks(filter);
      updateBookmarkBtn();
    });
    list.appendChild(el);
  });
}

function isBookmarked(url) { return bookmarks.some(b => b.url === url); }

function updateBookmarkBtn() {
  const url = getTab(activeTabId)?.url;
  const btn = $('#btn-bookmark');
  if (!btn) return;
  if (isBookmarked(url)) {
    btn.textContent = '★'; btn.style.color = 'var(--warning)'; btn.title = 'Remove Bookmark';
  } else {
    btn.textContent = '☆'; btn.style.color = ''; btn.title = 'Add Bookmark (Ctrl+D)';
  }
}

// ─── Bookmark Import (Chrome/Firefox HTML) ────────────────────────────────────
function importBookmarksFromHTML(htmlString) {
  const parser = new DOMParser();
  const doc    = parser.parseFromString(htmlString, 'text/html');
  const links  = doc.querySelectorAll('a[href]');
  let imported = 0;
  links.forEach(link => {
    const url   = link.getAttribute('href');
    const title = link.textContent.trim() || url;
    if (!url || !(url.startsWith('http://') || url.startsWith('https://'))) return;
    if (bookmarks.find(b => b.url === url)) return;
    bookmarks.push({ title, url, favicon: '' });
    imported++;
  });
  saveBookmarks();
  return imported;
}

$('#bookmark-import-input')?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const count = importBookmarksFromHTML(ev.target.result);
    toast(`✓ Imported ${count} bookmarks`);
    renderBookmarks();
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ─── Clipboard Panel ──────────────────────────────────────────────────────────
async function loadClipboard() {
  const data    = await window.nexus.readClipboard();
  const textBox = $('#clipboard-text-box');
  const imgBox  = $('#clipboard-img-box');
  const emptyEl = $('#clipboard-empty');
  const gotoBtn = $('#clip-goto-btn');
  let hasContent = false;

  if (data.text && data.text.trim()) {
    textBox.classList.remove('hidden');
    const preview = $('#clipboard-text-preview');
    preview.textContent = data.text.length > 400 ? data.text.slice(0, 400) + '…' : data.text;
    gotoBtn.classList.toggle('hidden', !isURL(data.text.trim()));
    gotoBtn.onclick = () => { navigate(data.text.trim()); closeSidebar(); };
    $('#clip-search-btn').onclick = () => { navigate(settings.searchEngine + encodeURIComponent(data.text.trim())); closeSidebar(); };
    hasContent = true;
  } else { textBox.classList.add('hidden'); }

  if (data.image) {
    imgBox.classList.remove('hidden');
    $('#clipboard-img-preview').src = data.image;
    hasContent = true;
  } else { imgBox.classList.add('hidden'); }

  emptyEl.classList.toggle('hidden', hasContent);
}

// ─── Password Manager ─────────────────────────────────────────────────────────

// Simple CSV parser for Chrome/Firefox exported passwords
function parsePasswordCSV(csvText) {
  const lines   = csvText.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const headers = lines[0].toLowerCase().split(',').map(h => h.replace(/"/g,'').trim());
  const nameIdx = headers.findIndex(h => h === 'name' || h === 'origin');
  const urlIdx  = headers.findIndex(h => h.includes('url'));
  const userIdx = headers.findIndex(h => h.includes('user') || h.includes('login'));
  const pwdIdx  = headers.findIndex(h => h === 'password');
  if (pwdIdx === -1) return [];

  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (!cols[pwdIdx]) continue;
    results.push({
      id:       Date.now() + i,
      name:     cols[nameIdx] || cols[urlIdx] || 'Unknown',
      url:      cols[urlIdx]  || '',
      username: cols[userIdx] || '',
      password: cols[pwdIdx]  || '',
      added:    Date.now(),
    });
  }
  return results;
}

function parseCSVLine(line) {
  const result = [];
  let cur = '', inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (ch === ',' && !inQuote) { result.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  result.push(cur.trim());
  return result;
}

function renderPasswords(filter = '') {
  const list  = $('#passwords-list');
  const empty = $('#passwords-empty');
  const items = filter
    ? passwords.filter(p => (p.name + p.url + p.username).toLowerCase().includes(filter.toLowerCase()))
    : passwords;

  list.innerHTML = '';
  if (!items.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  items.forEach(p => {
    const el = document.createElement('div');
    el.className = 'panel-item pwd-item';
    el.innerHTML = `
      <div class="pwd-icon">🔑</div>
      <div class="panel-item-info">
        <div class="panel-item-title">${escHtml(p.name)}</div>
        <div class="panel-item-url">${escHtml(p.username || p.url)}</div>
      </div>
      <div class="pwd-actions">
        <button class="pwd-copy-user icon-btn" title="Copy Username">👤</button>
        <button class="pwd-copy-pwd  icon-btn" title="Copy Password">🔑</button>
        <button class="panel-item-del" title="Delete">✕</button>
      </div>`;

    el.querySelector('.pwd-copy-user').addEventListener('click', (e) => {
      e.stopPropagation();
      window.nexus.writeClipboard(p.username);
      toast('👤 Username copied!');
    });
    el.querySelector('.pwd-copy-pwd').addEventListener('click', (e) => {
      e.stopPropagation();
      window.nexus.writeClipboard(p.password);
      toast('🔑 Password copied!');
    });
    el.querySelector('.panel-item-del').addEventListener('click', (e) => {
      e.stopPropagation();
      passwords = passwords.filter(x => x.id !== p.id);
      savePasswords();
      renderPasswords(filter);
    });
    if (p.url) el.querySelector('.panel-item-info').addEventListener('click', () => { navigate(p.url); closeSidebar(); });
    list.appendChild(el);
  });
}

$('#passwords-file-input')?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const imported = parsePasswordCSV(ev.target.result);
    let added = 0;
    imported.forEach(p => {
      if (!passwords.find(x => x.url === p.url && x.username === p.username)) {
        passwords.push(p); added++;
      }
    });
    savePasswords();
    renderPasswords();
    toast(`🔑 Imported ${added} credentials`);
  };
  reader.readAsText(file);
  e.target.value = '';
});

$('#password-search')?.addEventListener('input', e => renderPasswords(e.target.value));

// ─── Downloads Panel ──────────────────────────────────────────────────────────
function renderDownloads() {
  const list  = $('#downloads-list');
  const empty = $('#downloads-empty');

  list.innerHTML = '';
  if (!downloadsData.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  downloadsData.forEach(dl => {
    const el  = document.createElement('div');
    el.className = 'panel-item dl-item';
    el.id = `dl-${dl.id}`;

    const pct  = dl.totalBytes > 0 ? Math.round((dl.receivedBytes / dl.totalBytes) * 100) : 0;
    const done = dl.state === 'completed';
    const err  = dl.state === 'cancelled' || dl.state === 'interrupted';
    const stateLabel = done ? '✓ Done' : err ? '✕ Failed' : `${pct}%`;
    const stateColor = done ? 'var(--success)' : err ? 'var(--danger)' : 'var(--accent2)';

    el.innerHTML = `
      <div class="dl-icon">📥</div>
      <div class="panel-item-info">
        <div class="panel-item-title">${escHtml(dl.filename)}</div>
        <div class="dl-meta">
          <span style="color:${stateColor}">${stateLabel}</span>
          ${dl.totalBytes ? ` · ${formatBytes(dl.totalBytes)}` : ''}
        </div>
        ${!done && !err ? `<div class="dl-bar-wrap"><div class="dl-bar" style="width:${pct}%"></div></div>` : ''}
      </div>
      <div class="dl-actions">
        ${done ? `<button class="icon-btn dl-open" title="Show in folder">📂</button>` : ''}
        <button class="icon-btn dl-del" title="Remove">✕</button>
      </div>`;

    el.querySelector('.dl-open')?.addEventListener('click', () => window.nexus.showInFolder(dl.savePath));
    el.querySelector('.dl-del').addEventListener('click', () => {
      downloadsData = downloadsData.filter(x => x.id !== dl.id);
      renderDownloads();
    });
    list.appendChild(el);
  });
}

function formatBytes(bytes) {
  if (bytes < 1024)    return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function updateDownloadItem(id, data) {
  const dl = downloadsData.find(x => x.id === id);
  if (!dl) return;
  Object.assign(dl, data);
  if (currentPanel === 'downloads') renderDownloads();
}

// Hook up download IPC events
window.nexus.onDownloadStarted((dl) => {
  downloadsData.unshift(dl);
  toast(`📥 Downloading: ${dl.filename}`);
  // show downloads panel badge
  const btn = $('#btn-downloads');
  if (btn) btn.classList.add('has-badge');
  if (currentPanel === 'downloads') renderDownloads();
});
window.nexus.onDownloadUpdated(({ id, receivedBytes, totalBytes, state }) => {
  updateDownloadItem(id, { receivedBytes, totalBytes, state });
});
window.nexus.onDownloadDone(({ id, state, savePath, filename }) => {
  updateDownloadItem(id, { state, savePath });
  if (state === 'completed') toast(`✓ Downloaded: ${filename}`);
  if (currentPanel === 'downloads') renderDownloads();
});

$('#btn-clear-downloads')?.addEventListener('click', async () => {
  await window.nexus.clearDownloads();
  downloadsData = [];
  renderDownloads();
  $('#btn-downloads')?.classList.remove('has-badge');
});

// ─── Gaming Hub ───────────────────────────────────────────────────────────────
const GAMING_LINKS = [
  { icon: '🎮', name: 'Steam',    url: 'https://store.steampowered.com' },
  { icon: '📺', name: 'Twitch',   url: 'https://www.twitch.tv' },
  { icon: '⚡', name: 'Epic',     url: 'https://www.epicgames.com/store' },
  { icon: '💬', name: 'Discord',  url: 'https://discord.com/app' },
  { icon: '🕹', name: 'itch.io',  url: 'https://itch.io' },
  { icon: '🔮', name: 'GOG',      url: 'https://www.gog.com' },
  { icon: '🎯', name: 'r/gaming', url: 'https://www.reddit.com/r/gaming' },
  { icon: '📰', name: 'IGN',      url: 'https://www.ign.com' },
  { icon: '🏆', name: 'GG.deals', url: 'https://gg.deals' },
  { icon: '📖', name: 'PCGWiki',  url: 'https://www.pcgamingwiki.com' },
];

function renderGamingHub() {
  const grid = $('#gaming-links');
  grid.innerHTML = '';
  GAMING_LINKS.forEach(link => {
    const a = document.createElement('a');
    a.className = 'game-link';
    a.href = '#';
    a.innerHTML = `<div class="game-link-icon">${link.icon}</div>${link.name}`;
    a.addEventListener('click', (e) => { e.preventDefault(); createTab(link.url); closeSidebar(); });
    grid.appendChild(a);
  });
}

// ─── Snake Game ───────────────────────────────────────────────────────────────
function initSnake() {
  const canvas  = $('#snake-canvas');
  const ctx     = canvas.getContext('2d');
  const CELL    = 20;
  const COLS    = canvas.width  / CELL;
  const ROWS    = canvas.height / CELL;
  const ACCENT  = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#7c3aed';
  const ACCENT2 = '#06b6d4';

  let snake, dir, nextDir, food, score, loop, running;

  function reset() {
    snake   = [{ x: 6, y: 7 }, { x: 5, y: 7 }, { x: 4, y: 7 }];
    dir     = { x: 1, y: 0 };
    nextDir = { x: 1, y: 0 };
    score   = 0;
    running = true;
    placeFood();
    $('#snake-score').textContent = 0;
    $('#snake-status').textContent = 'Use WASD or arrow keys';
  }

  function placeFood() {
    let pos;
    do {
      pos = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
    } while (snake.some(s => s.x === pos.x && s.y === pos.y));
    food = pos;
  }

  function step() {
    if (!running) return;
    dir = nextDir;
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS ||
        snake.some(s => s.x === head.x && s.y === head.y)) {
      running = false;
      clearInterval(loop);
      $('#snake-status').textContent = `Game Over! Score: ${score}`;
      $('#btn-snake-play').textContent = '▶ PLAY AGAIN';
      draw();
      return;
    }
    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) {
      score++;
      $('#snake-score').textContent = score;
      placeFood();
    } else { snake.pop(); }
    draw();
  }

  function draw() {
    ctx.fillStyle = '#06060f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    for (let x = 0; x < COLS; x++)
      for (let y = 0; y < ROWS; y++)
        ctx.fillRect(x * CELL + CELL/2 - 1, y * CELL + CELL/2 - 1, 2, 2);
    ctx.shadowColor = ACCENT2; ctx.shadowBlur = 10;
    ctx.fillStyle = ACCENT2;
    ctx.beginPath();
    ctx.arc(food.x * CELL + CELL/2, food.y * CELL + CELL/2, CELL/2 - 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    snake.forEach((seg, i) => {
      ctx.shadowColor = ACCENT; ctx.shadowBlur = i === 0 ? 12 : 4;
      ctx.fillStyle = i === 0 ? '#a78bfa' : ACCENT;
      const pad = i === 0 ? 1 : 2;
      ctx.beginPath();
      ctx.roundRect(seg.x * CELL + pad, seg.y * CELL + pad, CELL - pad*2, CELL - pad*2, 4);
      ctx.fill();
    });
    ctx.shadowBlur = 0;
    if (!running && score >= 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  const keyHandler = (e) => {
    if (currentPanel !== 'gaming') return;
    const map = {
      'ArrowLeft':'left','ArrowRight':'right','ArrowUp':'up','ArrowDown':'down',
      'a':'left','d':'right','w':'up','s':'down'
    };
    const dir2 = map[e.key];
    if (!dir2) return;
    e.preventDefault();
    if (dir2 === 'left'  && dir.x !== 1)  nextDir = { x:-1, y: 0 };
    if (dir2 === 'right' && dir.x !== -1) nextDir = { x: 1, y: 0 };
    if (dir2 === 'up'    && dir.y !== 1)  nextDir = { x: 0, y:-1 };
    if (dir2 === 'down'  && dir.y !== -1) nextDir = { x: 0, y: 1 };
  };
  document.addEventListener('keydown', keyHandler);

  $('#btn-snake-play').addEventListener('click', () => {
    if (loop) clearInterval(loop);
    reset();
    loop = setInterval(step, 120);
    $('#btn-snake-play').textContent = '■ STOP';
    $('#btn-snake-play').onclick = () => {
      clearInterval(loop); running = false;
      $('#snake-status').textContent = 'Stopped';
      $('#btn-snake-play').textContent = '▶ PLAY';
      $('#btn-snake-play').onclick = startSnake;
    };
  });

  function startSnake() {
    if (loop) clearInterval(loop);
    reset();
    loop = setInterval(step, 120);
  }

  ctx.fillStyle = '#06060f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(124,58,237,0.3)';
  ctx.font = '0.7rem JetBrains Mono';
  ctx.textAlign = 'center';
  ctx.fillText('Press PLAY to start', canvas.width/2, canvas.height/2);

  return { stop: () => { if (loop) clearInterval(loop); document.removeEventListener('keydown', keyHandler); } };
}

// ─── Sidebar Management ───────────────────────────────────────────────────────
function openPanel(name) {
  const sidebar = $('#sidebar');
  $$('.panel').forEach(p => p.classList.add('hidden'));

  const panelMap = {
    bookmarks: '#panel-bookmarks',
    history:   '#panel-history',
    clipboard: '#panel-clipboard',
    passwords: '#panel-passwords',
    downloads: '#panel-downloads',
    gaming:    '#panel-gaming',
    settings:  '#panel-settings',
  };
  const titleMap = {
    bookmarks: '★ BOOKMARKS',
    history:   '⏱ HISTORY',
    clipboard: '📋 CLIPBOARD',
    passwords: '🔑 PASSWORDS',
    downloads: '📥 DOWNLOADS',
    gaming:    '🎮 GAMING HUB',
    settings:  '⚙ SETTINGS',
  };

  const panel = $(panelMap[name]);
  if (!panel) return;
  panel.classList.remove('hidden');
  $('#sidebar-title').textContent = titleMap[name] || name.toUpperCase();
  sidebar.classList.remove('hidden');
  currentPanel = name;

  $$('.nav-btn.action-btn').forEach(b => b.classList.remove('active-panel'));
  const btnMap = {
    bookmarks: '#btn-bookmark', history: '#btn-history', clipboard: '#btn-clipboard',
    passwords: '#btn-passwords', downloads: '#btn-downloads',
    gaming: '#btn-gaming', settings: '#btn-settings'
  };
  if (btnMap[name]) $(btnMap[name])?.classList.add('active-panel');

  if (name === 'clipboard') loadClipboard();
  if (name === 'gaming')    { renderGamingHub(); if (!snakeGame) snakeGame = initSnake(); }
  if (name === 'bookmarks') renderBookmarks();
  if (name === 'history')   renderHistory();
  if (name === 'passwords') renderPasswords();
  if (name === 'downloads') renderDownloads();
}

function closeSidebar() {
  $('#sidebar').classList.add('hidden');
  currentPanel = null;
  $$('.nav-btn.action-btn').forEach(b => b.classList.remove('active-panel'));
}

function toggleSidebar(name) {
  if (currentPanel === name) { closeSidebar(); return; }
  openPanel(name);
}

// ─── Password Modal ───────────────────────────────────────────────────────────
function promptPassword(title, desc, callback) {
  const modal = $('#pwd-modal');
  $('#modal-title').textContent = title;
  $('#modal-desc').textContent  = desc;
  $('#modal-input').value = '';
  $('#modal-error').classList.add('hidden');
  modal.classList.remove('hidden');
  setTimeout(() => $('#modal-input').focus(), 50);
  modalCallback = callback;
}

async function confirmModal() {
  const pwd    = $('#modal-input').value;
  const result = await window.nexus.verifyPassword(pwd);
  if (result.valid) {
    $('#pwd-modal').classList.add('hidden');
    if (modalCallback) { modalCallback(); modalCallback = null; }
  } else {
    $('#modal-error').classList.remove('hidden');
    $('#modal-input').value = '';
    $('#modal-input').focus();
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function loadSettingsPanel() {
  $('#setting-search-engine').value = settings.searchEngine;
  $('#setting-homepage').value      = settings.homepage;
  $('#setting-update-url').value    = settings.updateUrl || '';
  const zoomSel = $('#setting-default-zoom');
  if (zoomSel) zoomSel.value = String(settings.defaultZoom || 1.0);
  $$('#accent-swatches .swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.color === settings.accent);
  });
  applyAccent(settings.accent);
  window.nexus.getVersion().then(v => {
    const el = $('#app-version-label');
    if (el) el.textContent = 'v' + v;
  });
  // Load cookie import browser info
  loadBrowserCookieInfo();
}

function saveAllSettings() {
  settings.searchEngine = $('#setting-search-engine').value;
  settings.homepage     = $('#setting-homepage').value.trim();
  settings.updateUrl    = $('#setting-update-url').value.trim();
  const zoomSel = $('#setting-default-zoom');
  if (zoomSel) settings.defaultZoom = parseFloat(zoomSel.value) || 1.0;
  saveSettings();
  toast('✓ Settings saved!');
}

// ─── Auto-Update Checker ──────────────────────────────────────────────────────
async function checkForUpdates() {
  const url = (settings.updateUrl || '').trim() || ($('#setting-update-url')?.value?.trim());
  const statusEl = $('#update-status');
  if (!url) {
    if (statusEl) { statusEl.textContent = '⚠ No Update URL set. Paste a version.json URL above.'; statusEl.className = 'update-status error'; statusEl.classList.remove('hidden'); }
    toast('⚠ Set an Update URL in Settings first.');
    return;
  }
  if (statusEl) { statusEl.textContent = '⏳ Checking…'; statusEl.className = 'update-status'; statusEl.classList.remove('hidden'); }
  try {
    const result = await window.nexus.checkForUpdates(url);
    if (!result.ok) throw new Error(result.error || 'Request failed');
    const data = result.data;
    const currentVersion = (await window.nexus.getVersion()) || '1.0.0';
    if (!data.version) throw new Error('version.json missing "version" field. Format: {"version":"1.1.0","url":"https://..."}');

    const isNewer = compareVersions(data.version, currentVersion) > 0;
    if (isNewer) {
      if (statusEl) {
        statusEl.innerHTML = `🚀 Update available: <b>v${escHtml(data.version)}</b>${data.notes ? `<br><span style="color:var(--text-dim)">${escHtml(data.notes)}</span>` : ''}<br><a class="update-dl-link" href="#">⬇ Download Update</a>`;
        statusEl.className = 'update-status success';
        statusEl.classList.remove('hidden');
        statusEl.querySelector('.update-dl-link')?.addEventListener('click', (e) => {
          e.preventDefault();
          if (data.url) window.nexus.openExternal(data.url);
          else toast('⚠ No download URL in version.json');
        });
      }
    } else {
      if (statusEl) { statusEl.textContent = `✓ Already on latest version (v${currentVersion})`; statusEl.className = 'update-status ok'; statusEl.classList.remove('hidden'); }
      toast('✓ Already on latest version!');
    }
  } catch (err) {
    if (statusEl) { statusEl.textContent = `✕ ${err.message}`; statusEl.className = 'update-status error'; statusEl.classList.remove('hidden'); }
  }
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

$('#btn-check-update')?.addEventListener('click', checkForUpdates);

// ─── Global Default Zoom (applies to all new + existing tabs) ─────────────────
function applyGlobalZoom(factor) {
  settings.defaultZoom = factor;
  saveSettings();
  Object.entries(webviews).forEach(([id, wv]) => {
    try { wv.setZoomFactor(factor); } catch(e) {}
    zoomLevels[parseInt(id)] = factor;
  });
  updateZoomBadge();
  toast(`🔍 Global zoom: ${Math.round(factor * 100)}%`);
}

// ─── File Picker Overlay ──────────────────────────────────────────────────────
// Opens when any <input type="file"> is clicked inside a webview.
// Shows clipboard image + recent downloads so user can pick one to inject.
function openFilePicker(tabId, opts) {
  filePickTabId = tabId;
  const overlay = $('#file-pick-overlay');
  overlay.classList.remove('hidden');
  renderFilePickerDownloads();
  renderFilePickerClipboard();
}

function closeFilePicker() {
  $('#file-pick-overlay').classList.add('hidden');
  filePickTabId = null;
}

async function renderFilePickerClipboard() {
  const sec = $('#fp-clipboard-section');
  const data = await window.nexus.readClipboard();
  if (data.image) {
    sec.classList.remove('hidden');
    const img = $('#fp-clipboard-img');
    img.src = data.image;
    img.onclick = async () => {
      // Convert data URL to base64 and inject
      const b64  = data.image.split(',')[1];
      const mime = data.image.match(/data:([^;]+);/)?.[1] || 'image/png';
      const ext  = mime.split('/')[1] || 'png';
      await injectFileToWebview({ name: `clipboard.${ext}`, type: mime, base64: b64 });
    };
  } else {
    sec.classList.add('hidden');
  }
}

function renderFilePickerDownloads() {
  const list = $('#fp-downloads-list');
  list.innerHTML = '';
  const completed = downloadsData.filter(d => d.state === 'completed' && d.savePath);
  if (!completed.length) {
    list.innerHTML = '<div class="fp-empty">No completed downloads yet.</div>';
    return;
  }
  completed.slice(0, 20).forEach(dl => {
    const el = document.createElement('div');
    el.className = 'fp-dl-item';
    const ext = dl.filename.split('.').pop().toLowerCase();
    const isImg = ['png','jpg','jpeg','gif','webp','svg'].includes(ext);
    el.innerHTML = `
      <div class="fp-dl-icon">${isImg ? '🖼' : '📄'}</div>
      <div class="fp-dl-info">
        <div class="fp-dl-name">${escHtml(dl.filename)}</div>
        <div class="fp-dl-size">${formatBytes(dl.totalBytes || 0)}</div>
      </div>`;
    el.addEventListener('click', async () => {
      const result = await window.nexus.readFileForUpload(dl.savePath);
      if (result.error) { toast('⚠ ' + result.error); return; }
      await injectFileToWebview(result);
    });
    list.appendChild(el);
  });
}

async function injectFileToWebview(fileData) {
  const wv = webviews[filePickTabId];
  if (!wv) { closeFilePicker(); return; }
  try {
    wv.send('inject-file', fileData);
    closeFilePicker();
    toast(`📎 File attached: ${fileData.name}`);
  } catch(e) {
    toast('⚠ Could not inject file: ' + e.message);
  }
}

// ─── Cookie Import ────────────────────────────────────────────────────────────
let browserInfo = null;

async function loadBrowserCookieInfo() {
  const container = $('#cookie-import-section');
  if (!container) return;
  try {
    browserInfo = await window.nexus.getBrowserInfo();
    const browsers = Object.entries(browserInfo).filter(([, v]) => v !== null);
    if (!browsers.length) {
      container.innerHTML = '<div class="panel-notice">⚠ No supported browsers detected on this system.</div>';
      return;
    }
    const labels = { chrome: '🌐 Google Chrome', operaGX: '🎮 Opera GX', edge: '🔵 Microsoft Edge' };
    container.innerHTML = '';
    browsers.forEach(([key]) => {
      const row = document.createElement('div');
      row.className = 'cookie-import-row';
      row.innerHTML = `
        <span class="cookie-browser-name">${labels[key] || key}</span>
        <button class="settings-btn cookie-import-btn" data-browser="${key}">Import Cookies</button>
        <span class="cookie-status" id="cookie-status-${key}"></span>`;
      container.appendChild(row);
      row.querySelector('.cookie-import-btn').addEventListener('click', () => importCookies(key));
    });
  } catch(e) {
    if (container) container.innerHTML = `<div class="panel-notice">⚠ Could not detect browsers: ${e.message}</div>`;
  }
}

async function importCookies(browserKey) {
  const info = browserInfo?.[browserKey];
  if (!info) return;
  const statusEl = $(`#cookie-status-${browserKey}`);
  if (statusEl) { statusEl.textContent = '⏳ Importing…'; statusEl.style.color = 'var(--text-dim)'; }
  try {
    const result = await window.nexus.importBrowserCookies(info);
    if (result.error) throw new Error(result.error);
    if (statusEl) { statusEl.textContent = `✓ ${result.count} cookies imported`; statusEl.style.color = 'var(--success)'; }
    toast(`🍪 Imported ${result.count} cookies from ${browserKey === 'operaGX' ? 'Opera GX' : browserKey}`);
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 5000);
  } catch(e) {
    if (statusEl) { statusEl.textContent = '✕ ' + e.message; statusEl.style.color = 'var(--danger)'; }
    toast('⚠ Cookie import failed: ' + e.message);
  }
}

// ─── Wire Up Events ───────────────────────────────────────────────────────────
// Navigation buttons
$('#btn-back').addEventListener('click',    () => getActiveWV()?.goBack());
$('#btn-forward').addEventListener('click', () => getActiveWV()?.goForward());
$('#btn-reload').addEventListener('click',  () => {
  const wv = getActiveWV();
  if (!wv) return;
  if (getTab(activeTabId)?.loading) wv.stop();
  else wv.reload();
});
$('#btn-home').addEventListener('click', () => navigate(settings.homepage));
$('#btn-new-tab').addEventListener('click', () => createTab());

// URL bar
$('#urlbar').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { navigate($('#urlbar').value); $('#urlbar').blur(); }
  if (e.key === 'Escape') { updateUrlBar(getTab(activeTabId)?.url || ''); $('#urlbar').blur(); }
});
$('#urlbar').addEventListener('focus', () => {
  const bar = $('#urlbar');
  if (bar.value.startsWith('blob:')) bar.value = '';
  bar.select();
});

// Zoom badge click → reset
$('#zoom-badge')?.addEventListener('click', resetZoom);

// Bookmark button
$('#btn-bookmark').addEventListener('click', () => {
  const wv  = getActiveWV();
  if (!wv) return;
  const tab = getTab(activeTabId);
  if (!tab) return;
  const url = tab.url;
  const idx = bookmarks.findIndex(b => b.url === url);
  if (idx !== -1) {
    bookmarks.splice(idx, 1);
    saveBookmarks();
    toast('Bookmark removed');
  } else {
    bookmarks.unshift({ title: tab.title || url, url, favicon: tab.favicon || '' });
    saveBookmarks();
    toast('★ Bookmarked!');
  }
  updateBookmarkBtn();
  if (currentPanel === 'bookmarks') renderBookmarks();
});

// Sidebar panel toggles
$('#btn-clipboard').addEventListener('click', () => toggleSidebar('clipboard'));
$('#btn-gaming').addEventListener('click',    () => toggleSidebar('gaming'));
$('#btn-downloads').addEventListener('click', () => {
  toggleSidebar('downloads');
  $('#btn-downloads')?.classList.remove('has-badge');
});
$('#btn-passwords').addEventListener('click', () => {
  promptPassword('PASSWORD MANAGER', 'Enter app password to access saved credentials.', () => {
    toggleSidebar('passwords');
  });
});
$('#btn-settings').addEventListener('click', () => {
  promptPassword('SETTINGS ACCESS', 'Enter password to access settings.', () => {
    loadSettingsPanel();
    toggleSidebar('settings');
  });
});
$('#btn-history').addEventListener('click', () => {
  promptPassword('HISTORY ACCESS', 'Enter password to view your history.', () => {
    toggleSidebar('history');
  });
});

// Sidebar close
$('#sidebar-close').addEventListener('click', closeSidebar);

// Ad block toggle
$('#btn-adblock').addEventListener('click', async () => {
  adBlockOn = await window.nexus.toggleAdBlock(!adBlockOn);
  updateAdBlockBtn();
  toast(adBlockOn ? '🛡 Ad Blocker ON' : '🛡 Ad Blocker OFF');
});

// Dev tools
$('#btn-devtools').addEventListener('click', () => {
  const wv = getActiveWV();
  if (!wv) return;
  if (wv.isDevToolsOpened()) wv.closeDevTools();
  else wv.openDevTools();
});

// Password modal
$('#modal-confirm').addEventListener('click', confirmModal);
$('#modal-cancel').addEventListener('click', () => {
  $('#pwd-modal').classList.add('hidden');
  modalCallback = null;
});
$('#modal-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmModal(); });

// Bookmark search
$('#bookmark-search').addEventListener('input', e => renderBookmarks(e.target.value));

// History search + clear
$('#history-search').addEventListener('input', e => renderHistory(e.target.value));
$('#btn-clear-history').addEventListener('click', () => {
  if (!confirm('Clear all history?')) return;
  history = [];
  saveHistory();
  renderHistory();
});

// Clipboard refresh
$('#btn-refresh-clipboard').addEventListener('click', loadClipboard);

// Accent swatches
$('#accent-swatches').addEventListener('click', (e) => {
  const swatch = e.target.closest('.swatch');
  if (!swatch) return;
  $$('#accent-swatches .swatch').forEach(s => s.classList.remove('active'));
  swatch.classList.add('active');
  settings.accent = swatch.dataset.color;
  applyAccent(settings.accent);
});

// Settings save
$('#btn-save-settings').addEventListener('click', saveAllSettings);

// Global zoom select
$('#setting-default-zoom')?.addEventListener('change', (e) => {
  const factor = parseFloat(e.target.value) || 1.0;
  applyGlobalZoom(factor);
});

// File picker overlay
$('#fp-close-btn')?.addEventListener('click', closeFilePicker);
$('#fp-overlay-backdrop')?.addEventListener('click', closeFilePicker);

// Native file input fallback inside the file picker overlay
$('#fp-native-input')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    const base64 = ev.target.result.split(',')[1];
    await injectFileToWebview({ name: file.name, type: file.type || 'application/octet-stream', base64 });
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

// Change password
$('#btn-change-pwd').addEventListener('click', async () => {
  const oldPwd  = $('#setting-old-pwd').value;
  const newPwd  = $('#setting-new-pwd').value;
  const confPwd = $('#setting-conf-pwd').value;
  const msgEl   = $('#pwd-change-msg');

  msgEl.className = 'settings-msg';
  msgEl.classList.remove('hidden');

  if (newPwd !== confPwd) { msgEl.textContent = '⚠ Passwords do not match'; msgEl.classList.add('error'); return; }
  if (newPwd.length < 4)  { msgEl.textContent = '⚠ Password must be at least 4 characters'; msgEl.classList.add('error'); return; }

  const result = await window.nexus.changePassword(oldPwd, newPwd);
  if (result.success) {
    msgEl.textContent = '✓ Password updated!';
    msgEl.classList.add('success');
    $('#setting-old-pwd').value = '';
    $('#setting-new-pwd').value = '';
    $('#setting-conf-pwd').value = '';
  } else {
    msgEl.textContent = '⚠ ' + result.error;
    msgEl.classList.add('error');
  }
  setTimeout(() => msgEl.classList.add('hidden'), 3000);
});

// ─── Keyboard Shortcuts ───────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  const key  = e.key;

  if (ctrl) {
    switch (key.toLowerCase()) {
      case 't':
        e.preventDefault();
        if (e.shiftKey) reopenLastTab();
        else createTab();
        return;
      case 'w':
        e.preventDefault();
        if (!getTab(activeTabId)?.pinned) closeTab(activeTabId);
        return;
      case 'r':
        e.preventDefault();
        if (e.shiftKey) { getActiveWV()?.reloadIgnoringCache(); }
        else            { getActiveWV()?.reload(); }
        return;
      case 'l':
        e.preventDefault();
        $('#urlbar').focus();
        return;
      case 'd':
        e.preventDefault();
        $('#btn-bookmark').click();
        return;
      case 'h':
        e.preventDefault();
        $('#btn-history').click();
        return;
      case 'j':
        e.preventDefault();
        if (e.shiftKey) { toggleSidebar('downloads'); $('#btn-downloads')?.classList.remove('has-badge'); }
        else              toggleSidebar('clipboard');
        return;
      case 'p':
        e.preventDefault();
        if (e.shiftKey) $('#btn-passwords').click();
        return;
      case 'b':
        if (e.shiftKey) { e.preventDefault(); toggleSidebar('bookmarks'); return; }
        break;
      case 'e':
        e.preventDefault();
        toggleSidebar('gaming');
        return;
      case 'u':
        e.preventDefault();
        // Duplicate tab
        { const tab = getTab(activeTabId); if (tab) createTab(tab.url); }
        return;
      case 'f':
        if (!e.shiftKey) { e.preventDefault(); if (findActive) closeFindBar(); else openFindBar(); return; }
        break;
      case 'm':
        e.preventDefault();
        // Mute/unmute active webview
        { const wv = getActiveWV();
          if (wv) { const tab = getTab(activeTabId);
            try { tab._muted = !tab._muted; wv.setAudioMuted(tab._muted); toast(tab._muted ? '🔇 Tab muted' : '🔊 Tab unmuted'); } catch(e) {} }
        }
        return;
      case '=':
      case '+':
        e.preventDefault();
        adjustZoom(0.1);
        return;
      case '-':
        e.preventDefault();
        adjustZoom(-0.1);
        return;
      case '0':
        e.preventDefault();
        resetZoom();
        return;
      case 'tab':
        e.preventDefault();
        switchTabByOffset(e.shiftKey ? -1 : 1);
        return;
    }
    // Ctrl+1-9 → switch to tab N
    if (key >= '1' && key <= '9') {
      e.preventDefault();
      const idx = parseInt(key) - 1;
      if (tabs[idx]) setActiveTab(tabs[idx].id);
      return;
    }
    // Ctrl+Shift+Delete → clear history
    if (key === 'Delete' && e.shiftKey) {
      e.preventDefault();
      history = []; saveHistory(); toast('🗑 History cleared');
      return;
    }
  }

  // Alt+Left / Alt+Right
  if (e.altKey) {
    if (key === 'ArrowLeft')  { e.preventDefault(); getActiveWV()?.goBack();    return; }
    if (key === 'ArrowRight') { e.preventDefault(); getActiveWV()?.goForward(); return; }
  }

  // F keys
  if (key === 'F5')  { e.preventDefault(); e.shiftKey ? getActiveWV()?.reloadIgnoringCache() : getActiveWV()?.reload(); return; }
  if (key === 'F6')  { e.preventDefault(); $('#urlbar').focus(); return; }
  if (key === 'F11') {
    e.preventDefault();
    window.nexus.toggleFullscreen().then(fs => toast(fs ? '⛶ Fullscreen' : '⛶ Exit Fullscreen'));
    return;
  }
  if (key === 'F12') {
    e.preventDefault();
    const wv = getActiveWV();
    if (!wv) return;
    if (wv.isDevToolsOpened()) wv.closeDevTools();
    else wv.openDevTools();
    return;
  }

  // Escape
  if (key === 'Escape') {
    if (!$('#file-pick-overlay').classList.contains('hidden')) { closeFilePicker(); return; }
    if (findActive) { closeFindBar(); return; }
    if (!$('#pwd-modal').classList.contains('hidden')) { $('#modal-cancel').click(); return; }
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  applyAccent(settings.accent);

  $('#btn-minimize').addEventListener('click', () => window.nexus.minimize());
  $('#btn-maximize').addEventListener('click', () => window.nexus.maximize());
  $('#btn-close').addEventListener('click',    () => window.nexus.close());

  adBlockOn = await window.nexus.getAdBlockState();
  updateAdBlockBtn();

  // Load existing downloads from session
  try {
    const existing = await window.nexus.getDownloads();
    if (existing?.length) downloadsData = existing;
  } catch(e) {}

  createTab(settings.homepage !== 'nexus://newtab' ? settings.homepage : null);
  loadSettingsPanel();
}

function updateAdBlockBtn() {
  const btn = $('#btn-adblock');
  if (adBlockOn) { btn.classList.remove('adblock-off'); btn.classList.add('adblock-on');  btn.title = 'Ad Blocker: ON (click to disable)'; }
  else           { btn.classList.remove('adblock-on');  btn.classList.add('adblock-off'); btn.title = 'Ad Blocker: OFF (click to enable)'; }
}

// ─── Password Lock Screen ─────────────────────────────────────────────────────
async function setupLockScreen() {
  const overlay  = $('#lock-overlay');
  const input    = $('#lock-input');
  const btn      = $('#lock-btn');
  const errEl    = $('#lock-error');
  const subEl    = $('#lock-sub');
  const hintEl   = $('#lock-hint');

  const hasPassword = await window.nexus.hasPassword();

  if (!hasPassword) {
    subEl.textContent  = 'CREATE YOUR PASSWORD';
    btn.textContent    = 'CREATE PASSWORD';
    hintEl.textContent = 'You can change this in Settings later.';
    btn.addEventListener('click', async () => {
      const pwd = input.value.trim();
      if (pwd.length < 4) {
        errEl.textContent = '⚠ PASSWORD MUST BE AT LEAST 4 CHARACTERS';
        errEl.classList.remove('hidden');
        return;
      }
      await window.nexus.setPassword(pwd);
      overlay.style.opacity = '0';
      setTimeout(() => { overlay.style.display = 'none'; init(); }, 500);
    });
  } else {
    subEl.textContent  = 'SECURE ACCESS REQUIRED';
    btn.textContent    = 'AUTHENTICATE';
    hintEl.textContent = '';
    btn.addEventListener('click', async () => {
      const result = await window.nexus.verifyPassword(input.value);
      if (result.valid) {
        overlay.style.opacity = '0';
        setTimeout(() => { overlay.style.display = 'none'; init(); }, 500);
      } else {
        errEl.classList.remove('hidden');
        input.value = '';
        input.focus();
        setTimeout(() => errEl.classList.add('hidden'), 2500);
      }
    });
  }

  input.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });
  input.focus();
}

// ─── Start ────────────────────────────────────────────────────────────────────
setupLockScreen();
