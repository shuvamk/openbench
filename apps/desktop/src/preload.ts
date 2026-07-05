import { contextBridge, ipcRenderer } from "electron";

/**
 * The typed surface exposed to the renderer as `window.openbench`.
 *
 * This is intentionally minimal for #116 — a version marker plus a health
 * `ping`. Engine IPC (simulation, firmware, board queries) is wired onto this
 * bridge by the desktop-backend issue; the renderer never touches Node
 * directly, only this object.
 */
export const openbenchBridge = {
  version: 1 as const,
  ping: (): Promise<string> => ipcRenderer.invoke("openbench:ping"),
};

export type OpenbenchBridge = typeof openbenchBridge;

contextBridge.exposeInMainWorld("openbench", openbenchBridge);
