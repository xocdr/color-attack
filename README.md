# Color Attack Demo

A cross-platform 2D visual effects demo built with HTML5 Canvas + vanilla JavaScript.
No build step required for the browser version.

---

## 1. Browser

Just open `index.html` in any modern browser — no server, no install needed.

```
double-click index.html
# or
open index.html        # macOS
start index.html       # Windows
xdg-open index.html    # Linux
```

---

## 2. Desktop (Electron)

### Prerequisites
- Node.js ≥ 18

### Run in development

```bash
cd electron
npm install
npm start
```

This opens an 800×600 resizable window loading the root `index.html`.

### Package for distribution

```bash
cd electron
npm install
npm run build
```

Output is written to `../dist/`. Targets:
- **Windows** — NSIS installer (`.exe`)
- **macOS** — DMG (`.dmg`)
- **Linux** — AppImage

---

## 3. Mobile (Capacitor)

### Prerequisites
- Node.js ≥ 18
- For iOS: Xcode + CocoaPods (`sudo gem install cocoapods`)
- For Android: Android Studio + JDK 17

### Setup

```bash
# 1. Install Capacitor CLI + core from the project root
npm init -y
npm install @capacitor/core @capacitor/cli

# 2. Init Capacitor (use the config in capacitor/)
npx cap init "Color Attack Demo" com.example.colorattackdemo \
  --web-dir . --config capacitor/capacitor.config.json

# 3. Add platforms
npx cap add ios
npx cap add android

# 4. Sync web assets into native projects
npx cap sync

# 5a. Open in Xcode (iOS)
npx cap open ios

# 5b. Open in Android Studio (Android)
npx cap open android
```

After each change to `game.js` / `index.html`, re-run `npx cap sync` before building natively.

---

## Known Cross-Platform Gotchas

| Issue | Detail |
|---|---|
| **Touch vs mouse** | Both `touchstart` and `click` listeners are registered. On mobile, `touchstart` fires first — `e.preventDefault()` prevents the follow-up ghost `click`. |
| **Canvas DPI scaling** | The canvas is sized with `devicePixelRatio` so it stays sharp on Retina / high-DPI screens. CSS `width/height` remain at logical pixels while the internal buffer is larger. |
| **Canvas scaling on resize** | A `resize` listener recomputes the canvas buffer and all layout constants. Button hit areas are recomputed each frame from the live canvas dimensions. |
| **Electron window chrome** | On macOS, the traffic-light buttons overlap the top-left corner. If that matters, add `titleBarStyle: 'hiddenInset'` and a draggable region in `main.js`. |
| **Capacitor `webDir`** | Points to the project root (`../`) so Capacitor copies `index.html`, `game.js`, and `style.css` into the native bundle. Do not put secrets in those files. |
| **iOS WKWebView** | Older iOS versions may throttle `requestAnimationFrame` in the background. This is expected behavior, not a bug. |
| **Android back button** | Capacitor's default back-button behavior will exit the app on a single press since there is no routing. Add a `@capacitor/app` listener if you want confirmation dialogs. |
"# color-attack-demo-win32-x64" 
