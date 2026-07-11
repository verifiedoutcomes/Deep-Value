/**
 * Formula transparency UI: a small (i) tag next to any number opens a
 * bottom card showing the original sheet cell, the formula, and the same
 * formula with live numbers substituted — the calculation can be
 * followed step by step.
 */
import React, { createContext, useContext, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { colors, space, type } from '../theme';
import { Mono } from './ui';
import type { FormulaSpec } from '../formulas';
import { tapHaptic } from '../haptics';

const FormulaContext = createContext<(spec: FormulaSpec) => void>(() => {});

export function FormulaProvider({ children }: { children: React.ReactNode }) {
  const [spec, setSpec] = useState<FormulaSpec | null>(null);
  return (
    <FormulaContext.Provider
      value={(s) => {
        tapHaptic();
        setSpec(s);
      }}
    >
      {children}
      <Modal
        visible={spec != null}
        transparent
        animationType="slide"
        onRequestClose={() => setSpec(null)}
      >
        <Pressable style={styles.scrim} onPress={() => setSpec(null)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            {spec && (
              <ScrollView bounces={false}>
                <View style={styles.head}>
                  <Mono size="md" bold>{spec.title}</Mono>
                  <View style={styles.cellRef}>
                    <Mono size="xs" color={colors.amber}>sheet {spec.cell}</Mono>
                  </View>
                </View>
                <View style={styles.formulaBox}>
                  <Mono size="sm" color={colors.blue}>{spec.formula}</Mono>
                </View>
                {spec.steps.map((step, i) => (
                  <Mono key={i} size="sm" color={colors.text}>
                    {step}
                  </Mono>
                ))}
                {spec.note && (
                  <View style={styles.note}>
                    <Mono size="xs" color={colors.textDim}>{spec.note}</Mono>
                  </View>
                )}
                <Pressable style={styles.close} onPress={() => setSpec(null)}>
                  <Mono size="sm" color={colors.textDim}>close</Mono>
                </Pressable>
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </FormulaContext.Provider>
  );
}

/** The (i) tag. Wrap a screen in FormulaProvider, then drop these anywhere. */
export function InfoTag({ spec }: { spec: () => FormulaSpec }) {
  const show = useContext(FormulaContext);
  return (
    <Pressable
      onPress={() => show(spec())}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel="show formula"
      style={styles.tag}
    >
      <Mono size="xs" color={colors.blue}>ⓘ</Mono>
    </Pressable>
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
    maxHeight: '70%',
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
  formulaBox: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 6,
    padding: space.sm,
    marginBottom: space.sm,
  },
  note: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: space.sm,
    paddingTop: space.sm,
  },
  close: {
    alignSelf: 'center',
    padding: space.sm,
    marginTop: space.xs,
  },
  tag: { marginLeft: 4 },
});
