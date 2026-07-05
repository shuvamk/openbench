import { beforeEach, describe, expect, it, vi } from "vitest";

// Electron is mocked so the shell can be unit-tested without the native binary.
const { BrowserWindow, loadURL, loadFile } = vi.hoisted(() => {
  const loadURL = vi.fn();
  const loadFile = vi.fn();
  const BrowserWindow = vi.fn(() => ({ loadURL, loadFile }));
  return { BrowserWindow, loadURL, loadFile };
});

vi.mock("electron", () => ({
  app: { whenReady: () => Promise.resolve(), on: vi.fn(), quit: vi.fn() },
  BrowserWindow,
  contextBridge: { exposeInMainWorld: vi.fn() },
}));

import { createMainWindow, DEV_URL } from "./main";

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
