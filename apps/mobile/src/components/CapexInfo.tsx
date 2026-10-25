/**
 * Capex-treatment ⓘ bubble: lives next to the "Adj FCF = OCF − |capex| −
 * SBC" note wherever it appears, and holds BOTH the explanation and the
 * toggle (moved here from Settings so the choice sits where the
 * convention is actually used). Two correct definitions only; the
 * sheet's capex add-back is no longer offered.
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
            Adj FCF ={' '}
            {capexTreatment === 'owner'
              ? 'OCF − D&A − SBC (owner)'
              : capexTreatment === 'sheet'
                ? 'OCF + |capex| − SBC (old sheet)'
                : 'OCF − |capex| − SBC'}{' '}
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
                <Mono size="xs" color={colors.amber}>sheet K · corrected</Mono>
              </View>
            </View>
            <View style={{ flexDirection: 'row', marginBottom: space.sm, flexWrap: 'wrap', gap: 4 }}>
              <Chip
                label="Standard: OCF − |capex| − SBC"
                active={capexTreatment === 'conventional'}
                onPress={() => {
                  toggleHaptic();
                  setCapexTreatment('conventional');
                }}
              />
              <Chip
                label="Owner: OCF − D&A − SBC"
                active={capexTreatment === 'owner'}
                onPress={() => {
                  toggleHaptic();
                  setCapexTreatment('owner');
                }}
              />
            </View>
            <Mono size="xs" color={colors.textDim}>
              Standard (default): Adjusted FCF = operating cash flow − |capex| − stock-based
              compensation. Capex is a cash cost; the absolute value makes it right whichever
              sign the data provider uses (capex arrives negative). SBC is subtracted because
              paying staff in shares dilutes you as surely as paying cash.
            </Mono>
            <View style={{ height: space.sm }} />
            <Mono size="xs" color={colors.textDim}>
              Owner earnings (Buffett): subtracts depreciation & amortization instead of capex,
              as a proxy for the maintenance spend needed to defend today's earnings. Useful in
              heavy build-out years, but generous: D&A lags a young asset base. It needs D&A,
              which the sheet's 2026-07-10 META snapshot lacks (it shows dashes there).
            </Mono>
            <View style={{ height: space.sm }} />
            <Mono size="xs" color={colors.textFaint}>
              The original sheet computed K = OCF − capex − SBC with capex stored negative,
              which added capex back. That sign error is corrected everywhere in the app;
              analyses saved before the fix still replay their original numbers.
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
