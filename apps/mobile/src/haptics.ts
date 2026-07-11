/** Haptic feedback helpers: silent no-ops where unsupported. */
import * as Haptics from 'expo-haptics';

export function tapHaptic(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function toggleHaptic(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

export function successHaptic(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

export function warningHaptic(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}
