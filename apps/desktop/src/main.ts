import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow } from "electron";

/** Dev mode loads the running `next dev` server (see apps/web). */
export const DEV_URL = "http://localhost:3000";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to the static `apps/web` export loaded in packaged builds.
 *
 * Making `apps/web` fully static-exportable is out of scope for #116 (the API
 * routes move to `apps/desktop-backend` first); packaged-mode loading is
 * verified once that backend issue lands. The path is resolved relative to the
 * compiled `dist/` entry: `apps/desktop/dist/main.js` → `apps/web/out/`.
 */
export function packagedIndexPath(): string {
  return path.join(moduleDir, "..", "..", "web", "out", "index.html");
}

/**
 * Create the single application window that hosts the OpenBench UI.
 *
 * The renderer is fully sandboxed — no Node integration, context isolation on —
 * so the web UI only ever talks to the main process through the typed
 * `window.openbench` bridge established in `preload.ts`.
 */
export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    show: true,
    webPreferences: {
      preload: path.join(moduleDir, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  if (process.env.OPENBENCH_DESKTOP_ENV === "dev") {
    window.loadURL(DEV_URL);
  } else {
    window.loadFile(packagedIndexPath());
  }

  return window;
}

/**
 * Wire the Electron app lifecycle to the window factory. Kept separate from
 * module import so unit tests can exercise `createMainWindow` without booting
 * the app runtime; the real entry point is `app.ts`.
 */
export function bootstrap(): void {
  void app.whenReady().then(() => {
    createMainWindow();

    // macOS: re-open a window when the dock icon is clicked and none are open.
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
