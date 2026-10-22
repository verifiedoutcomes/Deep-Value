/**
 * Renders queued showAlert() dialogs on web: a centred card for one or
 * two buttons, an iOS-style action list for more (e.g. "Move to …" for
 * every group). Destructive actions are red, cancel sits last. Tapping
 * the backdrop or pressing Escape cancels.
 */
import React from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useDialogQueue, type AlertButton } from '../alert';
import { colors, space } from '../theme';
import { Mono } from './ui';

export function DialogHost() {
  const dialog = useDialogQueue((s) => s.queue[0]);
  const resolve = useDialogQueue((s) => s.resolve);
  if (Platform.OS !== 'web' || !dialog) return null;

  const cancel = dialog.buttons.find((b) => b.style === 'cancel');
  const actions = dialog.buttons.filter((b) => b.style !== 'cancel');
  // side by side only when two short labels fit
  const stacked = dialog.buttons.length > 2 || dialog.buttons.some((b) => b.text.length > 12);
  // a lone OK/acknowledge button behaves as the dismiss action
  const dismiss = () => resolve(cancel ?? (actions.length === 1 ? actions[0] : undefined));

  const button = (b: AlertButton, i: number, isCancel = false) => (
    <Pressable
      key={`${b.text}-${i}`}
      onPress={() => resolve(b)}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.btn,
        stacked ? styles.btnStacked : styles.btnInline,
        pressed && { backgroundColor: colors.chipBg },
      ]}
    >
      <Mono
        size="md"
        bold={!isCancel}
        color={
          b.style === 'destructive' ? colors.red : isCancel ? colors.textDim : colors.accent
        }
      >
        {b.text}
      </Mono>
    </Pressable>
  );

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <Pressable style={styles.scrim} onPress={dismiss} accessibilityLabel="dismiss">
        <Pressable
          style={styles.card}
          onPress={(e) => e.stopPropagation()}
          accessibilityRole="alert"
        >
          <View style={styles.body}>
            <Mono size="md" bold>{dialog.title}</Mono>
            {dialog.message ? (
              <Mono size="sm" color={colors.textDim}>{dialog.message}</Mono>
            ) : null}
          </View>
          <View style={stacked ? undefined : styles.row}>
            {stacked ? (
              <>
                {actions.map((b, i) => button(b, i))}
                {cancel && button(cancel, -1, true)}
              </>
            ) : (
              <>
                {cancel && button(cancel, -1, true)}
                {actions.map((b, i) => button(b, i))}
              </>
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  body: { padding: space.lg, gap: space.sm },
  row: { flexDirection: 'row' },
  btn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  btnInline: { flex: 1 },
  btnStacked: { alignSelf: 'stretch' },
});
