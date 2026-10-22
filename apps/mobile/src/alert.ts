/**
 * Alert that works everywhere. On native this is Alert.alert verbatim.
 * On web, react-native-web's Alert is a no-op and the browser's own
 * dialogs are unusable (the Claude app's artifact viewer makes confirm()
 * return false without showing anything), so requests queue here and
 * <DialogHost/> renders them in-app with every button intact.
 */
import { Alert, Platform } from 'react-native';
import { create } from 'zustand';

export interface AlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

export interface DialogRequest {
  id: number;
  title: string;
  message?: string;
  buttons: AlertButton[];
}

interface DialogQueue {
  queue: DialogRequest[];
  push: (d: Omit<DialogRequest, 'id'>) => void;
  /** Close the front dialog, then run the chosen button's action. */
  resolve: (button?: AlertButton) => void;
}

let nextId = 1;

export const useDialogQueue = create<DialogQueue>()((set) => ({
  queue: [],
  push: (d) => set((s) => ({ queue: [...s.queue, { ...d, id: nextId++ }] })),
  resolve: (button) => {
    set((s) => ({ queue: s.queue.slice(1) }));
    // after the close, so an action that opens another dialog queues it
    if (button?.onPress) setTimeout(button.onPress, 0);
  },
}));

export function showAlert(title: string, message?: string, buttons?: AlertButton[]): void {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons);
    return;
  }
  useDialogQueue.getState().push({
    title,
    message,
    buttons: buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }],
  });
}
