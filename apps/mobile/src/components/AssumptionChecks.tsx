/**
 * Assumption check strip under the valuation result: one line per flag
 * from the engine's checkAssumptions(), each with an optional one-tap fix
 * the user chooses. Nothing changes unless they tap.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { AssumptionFlag } from '@dvh/engine';
import { HIGH_GROWTH, FADE_TO_GROWTH } from '@dvh/engine';
import { colors, space } from '../theme';
import { Card, Mono, SectionTitle } from './ui';
import { pct } from '../format';
import { tapHaptic } from '../haptics';

export interface CheckActions {
  fadeGrowth: () => void;
  useMultiple: (m: number) => void;
  useOwnerEarnings: () => void;
  useConventional: () => void;
  useOpMargin: (m: number) => void;
}

interface Line {
  title: string;
  detail: string;
  action?: { label: string; run: () => void };
}

function describe(
  f: AssumptionFlag,
  finalYear: number,
  ownerAvailable: boolean,
  act: CheckActions,
): Line {
  switch (f.kind) {
    case 'fcf-above-op':
      return {
        title: 'FCF margin above operating margin',
        detail:
          `Adj FCF margin ${pct(f.fcfMargin)} vs operating margin ${pct(f.opMargin)}: ` +
          `${(f.fcfMargin / f.opMargin).toFixed(1)}× operating income. ` +
          (f.treatment === 'sheet'
            ? 'The sheet convention adds capex back (OCF + |capex| − SBC), which inflates FCF most for the heaviest investors.'
            : 'Check the TTM cash flow for one-off working-capital inflows.'),
        action:
          f.treatment === 'sheet'
            ? ownerAvailable
              ? { label: 'use owner earnings', run: act.useOwnerEarnings }
              : { label: 'use conventional FCF', run: act.useConventional }
            : undefined,
      };
    case 'high-growth':
      return {
        title: `Growth of ${pct(f.peakGrowth, 0)}/yr`,
        detail:
          `Revenue reaches ${f.revenueMultiple.toFixed(1)}× TTM in ${f.years} years. ` +
          `Few companies sustain growth above ${pct(HIGH_GROWTH, 0)} for long, and past growth barely predicts future growth.`,
        action: {
          label: `fade to ${pct(FADE_TO_GROWTH, 0)} by ${finalYear}`,
          run: act.fadeGrowth,
        },
      };
    case 'rich-exit': {
      const cur = f.currentEvEbit;
      return {
        title: `Exit at ${f.exitMultiple.toFixed(1)}× EBIT`,
        detail:
          `That assumes the market still pays a premium multiple in ${finalYear}` +
          `${cur != null ? ` (today ${cur.toFixed(1)}×` : ' ('}; the long-run market is about 15–20×).`,
        action:
          cur != null && cur > 0 && cur < f.exitMultiple
            ? { label: `use today's ${cur.toFixed(1)}×`, run: () => act.useMultiple(cur) }
            : undefined,
      };
    }
    case 'depressed-earnings': {
      const avg = f.avg4OpMargin;
      return {
        title: 'Depressed earnings',
        detail:
          `TTM operating margin ${pct(f.ttmOpMargin)} (4-yr avg ${pct(avg)})` +
          `${f.currentEvEbit != null ? `, EV/EBIT ${f.currentEvEbit.toFixed(0)}×` : ''}. ` +
          'A terminal value of operating income × multiple means little until margins normalise.',
        action:
          avg != null && avg > 0 && (f.ttmOpMargin == null || avg > f.ttmOpMargin)
            ? { label: `use 4-yr avg margin ${pct(avg)}`, run: () => act.useOpMargin(avg) }
            : undefined,
      };
    }
  }
}

export function AssumptionChecks({
  flags,
  finalYear,
  ownerAvailable,
  readOnly,
  actions,
}: {
  flags: AssumptionFlag[];
  finalYear: number;
  ownerAvailable: boolean;
  readOnly: boolean;
  actions: CheckActions;
}) {
  if (flags.length === 0) {
    return (
      <View style={styles.clean}>
        <Mono size="xs" color={colors.textFaint}>✓ assumption check: no red flags</Mono>
      </View>
    );
  }
  return (
    <Card style={styles.card}>
      <SectionTitle>Assumption check · {flags.length}</SectionTitle>
      {flags.map((f) => {
        const line = describe(f, finalYear, ownerAvailable, actions);
        return (
          <View key={f.kind} style={styles.line}>
            <Mono size="sm" color={colors.amber} bold>! {line.title}</Mono>
            <Mono size="xs" color={colors.textDim}>{line.detail}</Mono>
            {line.action && !readOnly && (
              <Pressable
                onPress={() => {
                  tapHaptic();
                  line.action!.run();
                }}
                accessibilityRole="button"
                style={styles.fix}
                hitSlop={6}
              >
                <Mono size="xs" color={colors.accent} bold>→ {line.action.label}</Mono>
              </Pressable>
            )}
          </View>
        );
      })}
      <Mono size="xs" color={colors.textFaint}>
        flags change nothing until you tap a fix · ↺ reset to seeded undoes forecast fixes
      </Mono>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { borderColor: colors.amber },
  clean: { paddingHorizontal: space.md + 2, paddingTop: space.sm },
  line: {
    gap: 3,
    paddingBottom: space.sm,
    marginBottom: space.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  fix: {
    alignSelf: 'flex-start',
    marginTop: 2,
    borderColor: colors.accentDim,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
  },
});
