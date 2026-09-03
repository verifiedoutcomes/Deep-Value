/**
 * Alert that works everywhere. React Native's Alert.alert is a no-op on
 * web (react-native-web doesn't implement it), which would silently
 * swallow every confirmation in the hosted demo. On web this maps to the
 * browser's confirm()/alert(); on native it is Alert.alert verbatim.
 */
import { Alert, Platform } from 'react-native';

export interface AlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

export function showAlert(title: string, message?: string, buttons?: AlertButton[]): void {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons);
    return;
  }
  const text = message ? `${title}\n\n${message}` : title;
  const actions = (buttons ?? []).filter((b) => b.style !== 'cancel');
  if (actions.length === 0) {
    try {
      window.alert(text);
    } catch {
      // headless / static render: nothing to show
    }
    return;
  }
  // One non-cancel action: confirm it. Several: confirm runs the first
  // (the primary), which is how the app orders its button lists.
  let ok = true;
  try {
    ok = window.confirm(
      actions.length > 1 ? `${text}\n\n[OK] = ${actions[0]!.text}` : text,
    );
  } catch {
    ok = false;
  }
  if (ok) actions[0]!.onPress?.();
}
