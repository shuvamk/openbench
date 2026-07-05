import { beforeEach, describe, expect, it, vi } from "vitest";

// Electron is mocked so the shell can be unit-tested without the native binary.
const { app, BrowserWindow, loadURL, loadFile } = vi.hoisted(() => {
  const loadURL = vi.fn();
  const loadFile = vi.fn();
  const BrowserWindow = Object.assign(
    vi.fn(() => ({ loadURL, loadFile })),
    { getAllWindows: vi.fn(() => []) },
  );
  const app = { whenReady: vi.fn(() => Promise.resolve()), on: vi.fn(), quit: vi.fn() };
  return { app, BrowserWindow, loadURL, loadFile };
});

vi.mock("electron", () => ({
  app,
  BrowserWindow,
  contextBridge: { exposeInMainWorld: vi.fn() },
}));

import { bootstrap, createMainWindow, DEV_URL } from "./main";

describe("createMainWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OPENBENCH_DESKTOP_ENV;
  });

  it("constructs exactly one BrowserWindow with a hardened webPreferences", () => {
    createMainWindow();

    expect(BrowserWindow).toHaveBeenCalledTimes(1);
    const opts = BrowserWindow.mock.calls[0]?.[0] as {
      webPreferences: { nodeIntegration: boolean; contextIsolation: boolean };
    };
    // No arbitrary Node API is exposed to the loaded web UI.
    expect(opts.webPreferences.nodeIntegration).toBe(false);
    expect(opts.webPreferences.contextIsolation).toBe(true);
  });

  it("loads the dev server URL when OPENBENCH_DESKTOP_ENV === 'dev'", () => {
    process.env.OPENBENCH_DESKTOP_ENV = "dev";

    createMainWindow();

    expect(loadURL).toHaveBeenCalledWith(DEV_URL);
    expect(loadFile).not.toHaveBeenCalled();
  });

  it("loads the packaged static build (not localhost) when not in dev", () => {
    process.env.OPENBENCH_DESKTOP_ENV = "production";

    createMainWindow();

    expect(loadFile).toHaveBeenCalledTimes(1);
    const target = loadFile.mock.calls[0]?.[0] as string;
    expect(target).not.toContain("localhost");
    expect(target).toContain("index.html");
    expect(loadURL).not.toHaveBeenCalled();
  });
});

describe("bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OPENBENCH_DESKTOP_ENV;
  });

  it("opens a window once Electron is ready and registers lifecycle handlers", async () => {
    bootstrap();

    // The window is created only after app.whenReady() resolves.
    expect(BrowserWindow).not.toHaveBeenCalled();
    await Promise.resolve();
    await Promise.resolve();
    expect(BrowserWindow).toHaveBeenCalledTimes(1);

    // Lifecycle handlers are registered for re-activation and shutdown.
    const events = app.on.mock.calls.map((call) => call[0]);
    expect(events).toContain("activate");
    expect(events).toContain("window-all-closed");
  });

  it("quits when all windows close off macOS, but stays alive on macOS", () => {
    bootstrap();
    const handler = app.on.mock.calls.find(([event]) => event === "window-all-closed")?.[1] as
      | (() => void)
      | undefined;
    expect(handler).toBeDefined();

    const original = process.platform;
    try {
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      handler?.();
      expect(app.quit).toHaveBeenCalledTimes(1);

      Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
      handler?.();
      // macOS convention: the app stays open with no windows, so no extra quit.
      expect(app.quit).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(process, "platform", { value: original, configurable: true });
    }
  });
});
