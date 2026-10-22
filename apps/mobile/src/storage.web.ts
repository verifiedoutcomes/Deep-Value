/**
 * Persistence backend for the zustand store — WEB (the hosted demo):
 * localStorage, guarded so that static rendering and privacy modes (no
 * storage available) fall back to an in-memory store instead of crashing.
 */
import type { StateStorage } from 'zustand/middleware';

const memory = new Map<string, string>();

const memoryStorage: StateStorage = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => {
    memory.set(k, v);
  },
  removeItem: (k) => {
    memory.delete(k);
  },
};

export function appStorage(): StateStorage {
  try {
    if (typeof localStorage === 'undefined') return memoryStorage;
    const probe = '__dvh_probe__'; // some browsers throw on access in private mode
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    // A write over the ~5MB quota (many saved analyses) keeps the latest
    // state in memory for the session instead of throwing mid-update.
    return {
      getItem: (k) => memory.get(k) ?? localStorage.getItem(k),
      setItem: (k, v) => {
        try {
          localStorage.setItem(k, v);
          memory.delete(k);
        } catch {
          memory.set(k, v);
        }
      },
      removeItem: (k) => {
        memory.delete(k);
        try {
          localStorage.removeItem(k);
        } catch {
          // storage revoked mid-session: nothing left to remove
        }
      },
    };
  } catch {
    return memoryStorage;
  }
}
