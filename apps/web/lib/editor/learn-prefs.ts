import { create } from "zustand";

/**
 * Opt-out preference for the Inspector "Learn" panel (issue #80). Contextual
 * learning is optional and never forced: a pro can turn it off and never see it
 * again. Persisted client-side (localStorage) like the rest of Phase 1 — no
 * account, no server (ADR-0008). Defaults to on so beginners get it for free.
 */

const STORAGE_KEY = "openbench.learnPanel.enabled";

function loadEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

export interface LearnPrefsState {
  /** Whether the Learn panel is shown at all. */
  enabled: boolean;
  /** Turn the Learn panel on/off; persists the choice. */
  setEnabled(enabled: boolean): void;
}

export const useLearnPrefs = create<LearnPrefsState>((set) => ({
  enabled: loadEnabled(),
  setEnabled(enabled) {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STORAGE_KEY, String(enabled));
      } catch {
        /* storage unavailable (private mode / SSR) — keep in-memory only */
      }
    }
    set({ enabled });
  },
}));

/** Reset to the default (enabled) and clear persistence — for tests. */
export function resetLearnPrefs(): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  useLearnPrefs.setState({ enabled: true });
}
