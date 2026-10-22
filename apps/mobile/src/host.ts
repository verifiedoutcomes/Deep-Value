/**
 * Where the app is running. The Claude app's artifact viewer (the
 * "preview" build, packaged by scripts/build-artifact.mjs) runs the web
 * bundle in a locked-down frame that blocks every network call except
 * the page's own files, so live data is off there and the app says so
 * instead of failing request by request.
 */
import { Platform } from 'react-native';

export type Host = 'native' | 'web' | 'preview';

const flag = (globalThis as { __DVH_HOST__?: unknown }).__DVH_HOST__;

export const HOST: Host =
  Platform.OS !== 'web' ? 'native' : flag === 'claude-artifact' ? 'preview' : 'web';

export const NETWORK_BLOCKED = HOST === 'preview';

export const PREVIEW_OFFLINE_MESSAGE =
  'Live data is off in the Claude app preview: its viewer blocks network calls. ' +
  'The bundled snapshots work fully; run the app in Expo Go for live pulls.';
