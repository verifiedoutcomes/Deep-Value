/**
 * Copy text to the clipboard. Native: expo-clipboard. Web: a synchronous
 * execCommand copy first, which still works inside sandboxed frames (the
 * Claude app's viewer) as long as it runs in the tap handler, then the
 * async Clipboard API. Returns false when both are refused, so the caller
 * can show the text for a manual Select All → Copy.
 */
import { Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';

function execCommandCopy(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const span = document.createElement('span');
  span.textContent = text;
  // the page disables text selection for app-like touch; re-enable here
  span.style.cssText =
    'position:fixed;top:0;left:0;opacity:0;white-space:pre;' +
    '-webkit-user-select:text;user-select:text;font-size:16px;';
  document.body.appendChild(span);
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(span);
  selection?.removeAllRanges();
  selection?.addRange(range);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  selection?.removeAllRanges();
  document.body.removeChild(span);
  return ok;
}

export async function copyText(text: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    if (execCommandCopy(text)) return true;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  try {
    await Clipboard.setStringAsync(text);
    return true;
  } catch {
    return false;
  }
}
