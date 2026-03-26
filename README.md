# ⬡ NEXUS Browser
### The Gamer's Dream Browser — Built with Electron

---

## ⚡ Quick Start

**Requirements:** Node.js 18+ installed ([nodejs.org](https://nodejs.org))

```bash
# 1. Open this folder in terminal
cd nexus-browser

# 2. Install Electron
npm install

# 3. Launch NEXUS
npm start
```

On first launch you'll be prompted to **create a password**. This protects your browser.

---

## 🔐 Security Features

| Area | Password Protected |
|------|-------------------|
| App Startup | ✅ Yes |
| History Panel | ✅ Yes |
| Settings Panel | ✅ Yes |
| Normal Browsing | ❌ No (just browse!) |

---

## 🎮 Features

### Browsing
- **Multi-tab** browsing — `Ctrl+T` new tab, `Ctrl+W` close tab
- **Address bar** — type a URL or search query and press Enter
- Back / Forward / Reload / Home buttons
- Custom **new tab page** with gaming quick links

### 📋 Clipboard Panel
- Click the 📋 button (or `Ctrl+J`) to open
- Shows your current clipboard text and images
- If clipboard text is a URL → **Navigate directly**
- Search clipboard text with one click

### 🛡 Ad Blocker
- Blocks 30+ major ad/tracker domains by default
- Click the 🛡 button to toggle ON/OFF
- Green = active, dimmed = disabled

### 🎮 Gaming Hub
- Quick links: Steam, Twitch, Epic, Discord, itch.io, GOG, IGN, and more
- Built-in **Snake mini-game** — use WASD or arrow keys

### ⚙ Settings (Password Protected)
- Change search engine (Google, DuckDuckGo, Brave, Bing)
- Set custom homepage
- Choose accent color theme (6 options)
- Change your password

### ⏱ History (Password Protected)
- Full browsing history with search
- Click any entry to navigate back
- Clear individual entries or all history

### ★ Bookmarks
- Press ☆ in the nav bar to bookmark current page
- Open bookmarks panel to browse/search/delete
- Bookmarks persist between sessions

---

## ⌨ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+T` | New Tab |
| `Ctrl+W` | Close Tab |
| `Ctrl+R` | Reload |
| `Ctrl+L` | Focus URL bar |
| `Ctrl+D` | Bookmark page |
| `Ctrl+H` | Open History |
| `Ctrl+J` | Clipboard panel |
| `Ctrl+1-9` | Switch to tab N |
| `F12` / ⚙ btn | Toggle DevTools |

---

## 📦 Build for Distribution

```bash
npm run build
# Output in /dist folder — .exe (Windows), .dmg (Mac), .AppImage (Linux)
```

---

## 🗂 Project Structure

```
nexus-browser/
├── main.js       — Electron main process, ad blocking, IPC
├── preload.js    — Secure bridge between main and renderer
├── index.html    — UI shell
├── renderer.js   — All browser logic
├── styles.css    — Cyberpunk dark theme
└── package.json  — Dependencies
```

---

*NEXUS Browser — Built for gamers. Locked for privacy.*
