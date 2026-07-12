/**
 * Capex-treatment ⓘ bubble: lives next to the "Adj FCF = OCF + |capex| −
 * SBC" note wherever it appears, and holds BOTH the explanation and the
 * toggle (moved here from Settings so the choice sits where the
 * convention is actually used).
 */
import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useAppStore } from '../store';
import { colors, space } from '../theme';
import { Chip, Mono } from './ui';
import { tapHaptic, toggleHaptic } from '../haptics';

export function CapexInfoTag({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const capexTreatment = useAppStore((s) => s.capexTreatment);
  const setCapexTreatment = useAppStore((s) => s.setCapexTreatment);

  return (
    <>
      <Pressable
        onPress={() => {
          tapHaptic();
          setOpen(true);
        }}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="capex treatment: explanation and setting"
        style={{ flexDirection: 'row', alignItems: 'center' }}
      >
        {!compact && (
          <Mono size="xs" color={colors.textFaint}>
            Adj FCF = {capexTreatment === 'sheet' ? 'OCF + |capex| − SBC' : 'OCF − |capex| − SBC'}{' '}
          </Mono>
        )}
        <Mono size="xs" color={colors.blue}>ⓘ</Mono>
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.head}>
              <Mono size="md" bold>Capex treatment</Mono>
              <View style={styles.cellRef}>
                <Mono size="xs" color={colors.amber}>sheet K column</Mono>
              </View>
            </View>
            <View style={{ flexDirection: 'row', marginBottom: space.sm, flexWrap: 'wrap', gap: 4 }}>
              <Chip
                label="Sheet: OCF + |capex| − SBC"
                active={capexTreatment === 'sheet'}
                onPress={() => {
                  toggleHaptic();
                  setCapexTreatment('sheet');
                }}
              />
              <Chip
                label="OCF − |capex| − SBC"
                active={capexTreatment === 'conventional'}
                onPress={() => {
                  toggleHaptic();
                  setCapexTreatment('conventional');
                }}
              />
            </View>
            <Mono size="xs" color={colors.textDim}>
              The sheet stores capex as a NEGATIVE number and computes Adjusted FCF as
              OCF − capex − SBC, which adds the absolute value of capex back. That is the
              original model's convention and the default here. The conventional alternative
              subtracts capex instead. Changing this reprices everything downstream — margins,
              yields, forecasts, fair values and IRRs.
            </Mono>
            <Pressable style={styles.close} onPress={() => setOpen(false)}>
              <Mono size="sm" color={colors.textDim}>close</Mono>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderColor: colors.border,
    borderWidth: 1,
    padding: space.lg,
  },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.sm,
  },
  cellRef: {
    borderColor: colors.amber,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  close: {
    alignSelf: 'center',
    padding: space.sm,
    marginTop: space.xs,
  },
});
