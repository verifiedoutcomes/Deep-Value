/**
 * Persistence backend for the zustand store — NATIVE (iOS/Android):
 * expo-sqlite's kv-store, synchronous and durable in the managed workflow.
 *
 * Metro picks this file for native builds and `storage.web.ts` for web,
 * so expo-sqlite never enters the browser bundle at all.
 */
import Storage from 'expo-sqlite/kv-store';
import type { StateStorage } from 'zustand/middleware';

export function appStorage(): StateStorage {
  return Storage as unknown as StateStorage;
}
