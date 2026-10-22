/**
 * Web-only global CSS for app-like touch behaviour in both web builds
 * (GitHub Pages and the Claude preview): a long-press opens the row menu
 * instead of starting a text selection, taps don't flash, and the page
 * doesn't rubber-band. Inputs stay selectable.
 */
import { Platform } from 'react-native';

const CSS = `
body { -webkit-tap-highlight-color: transparent; overscroll-behavior: none;
  -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
input, textarea { -webkit-user-select: text; user-select: text; }
`;

export function installWebStyles(): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  if (document.getElementById('dvh-web-styles')) return;
  const el = document.createElement('style');
  el.id = 'dvh-web-styles';
  el.textContent = CSS;
  document.head.appendChild(el);
}
