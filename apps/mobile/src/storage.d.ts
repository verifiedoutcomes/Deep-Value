/**
 * Type declaration for the platform-split storage module. Metro resolves
 * `./storage` to `storage.native.ts` (iOS/Android) or `storage.web.ts`
 * (browser); TypeScript resolves it here. Keep the signature in sync.
 */
import type { StateStorage } from 'zustand/middleware';

export function appStorage(): StateStorage;
