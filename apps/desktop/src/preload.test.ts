import { describe, expect, it, vi } from "vitest";

const { exposeInMainWorld } = vi.hoisted(() => ({ exposeInMainWorld: vi.fn() }));

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), send: vi.fn() },
}));

describe("preload bridge", () => {
  it("exposes exactly one 'openbench' bridge object via contextBridge", async () => {
    // Importing the preload module runs its top-level exposeInMainWorld call.
    await import("./preload");

    expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
    const [name, api] = exposeInMainWorld.mock.calls[0] ?? [];
    expect(name).toBe("openbench");
    expect(typeof api).toBe("object");
    expect(api).not.toBeNull();
  });
});
