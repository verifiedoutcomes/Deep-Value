/**
 * Valuation screen: scenario editor (5yr/3yr toggle, Bear/Base/Bull tabs,
 * per-year inputs for growth and margins, exit multiple, discount rate,
 * adjustment), fair value + IRR results, IRR-at-price strip, margin of
 * safety targets, verdict card.
 */
import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import type {
  HorizonYears,
  Maybe,
  ScenarioKind,
  ScenarioOverrides,
  ScenarioValuation,
} from '@dvh/engine';
import {
  DEFAULT_DISCOUNT_RATE,
  DEFAULT_MOS_THRESHOLDS,
  derive3yExitMultiple,
  seedBaseScenario,
  seedEmptyScenario,
} from '@dvh/engine';
import { useTickerAnalysis } from '../../src/analysis';
import { useAppStore } from '../../src/store';
import { tapHaptic, toggleHaptic } from '../../src/haptics';
import { colors, deltaColor, space, type } from '../../src/theme';
import { Banner, Card, Chip, KV, Mono, SectionTitle } from '../../src/components/ui';
import { money, pct, pctSigned, price } from '../../src/format';

export default function ValuationScreen() {
  const { ticker, state, snapshot, analysis } = useTickerAnalysis();
  const setOverrides = useAppStore((s) => s.setOverrides);
  const setHorizon = useAppStore((s) => s.setHorizon);
  const setScenarioTab = useAppStore((s) => s.setScenarioTab);
  const capexTreatment = useAppStore((s) => s.capexTreatment);

  if (!snapshot || !analysis || !state) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: space.lg }}>
        <Banner>No snapshot for {ticker} yet — load one from the Company tab.</Banner>
      </View>
    );
  }

  const horizon = state.horizon;
  const kind = state.scenarioTab;
  const overrides = state.overrides;
  const valuation = analysis.scenarios[kind][horizon];
  const seededExit5 = analysis.derived[analysis.derived.length - 1]?.evToEbit ?? 0;

  const years =
    overrides.years?.[kind]?.[horizon] ??
    (kind === 'base' ? seedBaseScenario(analysis.derived, horizon) : seedEmptyScenario(horizon));

  const patch = (p: Partial<ScenarioOverrides>) => setOverrides(ticker, { ...overrides, ...p });

  const setYear = (idx: number, field: 'revenueYoY' | 'operatingMargin' | 'adjFcfMargin', v: number) => {
    const next = years.map((y, i) => (i === idx ? { ...y, [field]: v } : y));
    patch({
      years: {
        ...overrides.years,
        [kind]: { ...overrides.years?.[kind], [horizon]: next },
      },
    });
  };

  const exit5 = overrides.exitMultiple5?.[kind] ?? (kind === 'base' ? seededExit5 : 0);
  const exitCurrent =
    horizon === 5 ? exit5 : overrides.exitMultiple3?.[kind] ?? derive3yExitMultiple(kind, exit5);

  const hasEdits =
    overrides.years?.[kind]?.[horizon] != null ||
    (horizon === 5
      ? overrides.exitMultiple5?.[kind] != null
      : overrides.exitMultiple3?.[kind] != null) ||
    overrides.adjustmentMillions?.[kind]?.[horizon] != null;

  const resetToSeeded = () => {
    toggleHaptic();
    const years = { ...overrides.years?.[kind] };
    delete years[horizon];
    const adj = { ...overrides.adjustmentMillions?.[kind] };
    delete adj[horizon];
    const next = {
      ...overrides,
      years: { ...overrides.years, [kind]: years },
      adjustmentMillions: { ...overrides.adjustmentMillions, [kind]: adj },
    };
    if (horizon === 5) {
      const em = { ...overrides.exitMultiple5 };
      delete em[kind];
      next.exitMultiple5 = em;
    } else {
      const em = { ...overrides.exitMultiple3 };
      delete em[kind];
      next.exitMultiple3 = em;
    }
    setOverrides(ticker, next);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={96}
    >
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: space.xl }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.toggles}>
        <View style={{ flexDirection: 'row' }}>
          {(['bear', 'base', 'bull'] as ScenarioKind[]).map((k) => (
            <Chip
              key={k}
              label={k.toUpperCase()}
              active={kind === k}
              tone={k === 'bear' ? 'bad' : k === 'bull' ? 'good' : 'neutral'}
              onPress={() => {
                tapHaptic();
                setScenarioTab(ticker, k);
              }}
            />
          ))}
        </View>
        <View style={{ flexDirection: 'row' }}>
          {([5, 3] as HorizonYears[]).map((hz) => (
            <Chip
              key={hz}
              label={`${hz}yr`}
              active={horizon === hz}
              onPress={() => {
                tapHaptic();
                setHorizon(ticker, hz);
              }}
            />
          ))}
        </View>
      </View>

      <ResultCard valuation={valuation} priceToday={snapshot.quote.price} horizon={horizon} />

      <Card>
        <View style={styles.assumTitleRow}>
          <SectionTitle>
            Assumptions · {kind} · {horizon}yr
          </SectionTitle>
          {hasEdits && (
            <Pressable onPress={resetToSeeded} hitSlop={8}>
              <Mono size="xs" color={colors.blue}>↺ reset to seeded</Mono>
            </Pressable>
          )}
        </View>
        <View style={styles.assumHead}>
          <Mono size="xs" color={colors.textFaint}>year</Mono>
          <Mono size="xs" color={colors.textFaint}>rev y/y %</Mono>
          <Mono size="xs" color={colors.textFaint}>op mgn %</Mono>
          <Mono size="xs" color={colors.textFaint}>fcf mgn %</Mono>
        </View>
        {years.map((y, i) => (
          <View key={i} style={styles.assumRow}>
            <Mono size="sm" color={colors.textDim}>{analysis.anchors.firstForecastYear + i}</Mono>
            <PctInput value={y.revenueYoY} onCommit={(v) => setYear(i, 'revenueYoY', v)} />
            <PctInput value={y.operatingMargin} onCommit={(v) => setYear(i, 'operatingMargin', v)} />
            <PctInput value={y.adjFcfMargin} onCommit={(v) => setYear(i, 'adjFcfMargin', v)} />
          </View>
        ))}
        <View style={{ height: space.sm }} />
        <NumRow
          label={`exit EV/EBIT (${horizon}yr)`}
          value={exitCurrent}
          digits={1}
          onCommit={(v) =>
            horizon === 5
              ? patch({ exitMultiple5: { ...overrides.exitMultiple5, [kind]: v } })
              : patch({ exitMultiple3: { ...overrides.exitMultiple3, [kind]: v } })
          }
        />
        <NumRow
          label="discount rate %"
          value={(horizon === 5 ? overrides.discountRate5 : overrides.discountRate3) ?? DEFAULT_DISCOUNT_RATE}
          digits={1}
          scale={100}
          onCommit={(v) => (horizon === 5 ? patch({ discountRate5: v }) : patch({ discountRate3: v }))}
        />
        <NumRow
          label="adjustment ($M)"
          value={overrides.adjustmentMillions?.[kind]?.[horizon] ?? 0}
          digits={0}
          onCommit={(v) =>
            patch({
              adjustmentMillions: {
                ...overrides.adjustmentMillions,
                [kind]: { ...overrides.adjustmentMillions?.[kind], [horizon]: v },
              },
            })
          }
        />
        {capexTreatment === 'sheet' && (
          <Mono size="xs" color={colors.textFaint}>
            note: Adj FCF uses the sheet convention (OCF + |capex| − SBC)
          </Mono>
        )}
      </Card>

      <Card>
        <SectionTitle>Base-case IRR at price</SectionTitle>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {analysis.irrStrip.map((cell) => {
            const isCurrent = Math.abs(cell.price - Math.round(snapshot.quote.price)) < 0.5;
            return (
              <View key={cell.price} style={[styles.irrCell, isCurrent && styles.irrCellActive]}>
                <Mono size="sm" bold color={isCurrent ? colors.accent : colors.text}>
                  {price(cell.price).replace('.00', '')}
                </Mono>
                <Mono size="xs" color={deltaColor(cell.irr)}>{pct(cell.irr)}</Mono>
              </View>
            );
          })}
        </ScrollView>
      </Card>

      <Card>
        <SectionTitle>Margin of safety · target buy</SectionTitle>
        {analysis.marginOfSafety.map((row, i) => (
          <View key={i} style={styles.mosRow}>
            <PctInput
              value={row.threshold}
              onCommit={(v) => {
                const t = [...(overrides.mosThresholds ?? DEFAULT_MOS_THRESHOLDS)];
                t[i] = v;
                patch({ mosThresholds: t });
              }}
            />
            <Mono size="sm" color={colors.accent} bold>
              {price(row.targetBuyPrice)}
            </Mono>
          </View>
        ))}
      </Card>

      <Card>
        <SectionTitle>Verdict · fair value vs price</SectionTitle>
        <View style={styles.verdictRow}>
          {(
            [
              ['Bear', analysis.verdict.bearFairValue],
              ['Base', analysis.verdict.baseFairValue],
              ['Bull', analysis.verdict.bullFairValue],
            ] as [string, Maybe][]
          ).map(([label, fv]) => (
            <View key={label} style={styles.verdictCell}>
              <Mono size="xs" color={colors.textFaint}>{label}</Mono>
              <Mono size="md" bold color={fv == null ? colors.textFaint : fv >= snapshot.quote.price ? colors.accent : colors.red}>
                {fv == null ? 'No Forecast' : price(fv)}
              </Mono>
              <Mono size="xs" color={colors.textDim}>vs {price(analysis.verdict.price)}</Mono>
            </View>
          ))}
        </View>
      </Card>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ResultCard({
  valuation,
  priceToday,
  horizon,
}: {
  valuation: ScenarioValuation;
  priceToday: number;
  horizon: HorizonYears;
}) {
  if (valuation.status === 'no-forecast') {
    return (
      <Card>
        <Mono size="lg" color={colors.textFaint}>No Forecast</Mono>
        <Mono size="xs" color={colors.textFaint}>
          enter margins below to activate this scenario
        </Mono>
      </Card>
    );
  }
  const err = valuation.status === 'num-error';
  return (
    <Card>
      <View style={styles.resultRow}>
        <View>
          <Mono size="xs" color={colors.textFaint}>fair value today</Mono>
          <Mono size="xl" bold color={err ? colors.red : colors.accent}>
            {err ? '#NUM!' : price(valuation.fairValuePerShare)}
          </Mono>
          <Mono size="xs" color={deltaColor(valuation.priceDelta)}>
            {err ? 'no IRR root' : `${pctSigned(valuation.priceDelta)} vs ${price(priceToday)}`}
          </Mono>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Mono size="xs" color={colors.textFaint}>irr</Mono>
          <Mono size="xl" bold color={err ? colors.red : colors.text}>
            {err ? '–' : pct(valuation.irr)}
          </Mono>
          <Mono size="xs" color={colors.textDim}>
            {`${horizon}-yr px Δ ${pctSigned(valuation.horizonPriceChange, 0)}`}
          </Mono>
        </View>
      </View>
      <View style={{ height: space.sm }} />
      <KV label={`terminal EV (${valuation.exitMultiple.toFixed(1)}x ebit)`} value={money(valuation.terminalEv)} />
      <KV label="terminal mkt cap" value={money(valuation.terminalMarketCap)} />
      <KV label="intrinsic equity value" value={money(valuation.intrinsicValue)} />
    </Card>
  );
}

/**
 * Percent input with ± steppers (0.5pp per tap): editable by keyboard,
 * but tunable one-thumbed without one.
 */
function PctInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [text, setText] = React.useState((value * 100).toFixed(1));
  React.useEffect(() => setText((value * 100).toFixed(1)), [value]);
  const bump = (dir: 1 | -1) => {
    tapHaptic();
    onCommit(Math.round((value + dir * 0.005) * 1000) / 1000);
  };
  return (
    <View style={styles.stepper}>
      <Pressable style={styles.stepBtn} onPress={() => bump(-1)} hitSlop={6}>
        <Mono size="sm" color={colors.textDim}>−</Mono>
      </Pressable>
      <TextInput
        style={styles.stepInput}
        value={text}
        keyboardType="numbers-and-punctuation"
        onChangeText={setText}
        selectTextOnFocus
        onEndEditing={() => {
          const v = parseFloat(text);
          if (Number.isFinite(v)) onCommit(v / 100);
          else setText((value * 100).toFixed(1));
        }}
      />
      <Pressable style={styles.stepBtn} onPress={() => bump(1)} hitSlop={6}>
        <Mono size="sm" color={colors.textDim}>+</Mono>
      </Pressable>
    </View>
  );
}

function NumRow({
  label,
  value,
  digits,
  scale = 1,
  onCommit,
}: {
  label: string;
  value: number;
  digits: number;
  scale?: number;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = React.useState((value * scale).toFixed(digits));
  React.useEffect(() => setText((value * scale).toFixed(digits)), [value, scale, digits]);
  return (
    <View style={styles.numRow}>
      <Mono size="sm" color={colors.textDim}>{label}</Mono>
      <TextInput
        style={styles.input}
        value={text}
        keyboardType="numbers-and-punctuation"
        onChangeText={setText}
        selectTextOnFocus
        onEndEditing={() => {
          const v = parseFloat(text);
          if (Number.isFinite(v)) onCommit(v / scale);
          else setText((value * scale).toFixed(digits));
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  toggles: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
    paddingTop: space.sm,
  },
  resultRow: { flexDirection: 'row', justifyContent: 'space-between' },
  assumHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  assumRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 4,
    color: colors.text,
    fontFamily: type.mono,
    fontSize: type.size.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 72,
    textAlign: 'right',
  },
  assumTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  stepBtn: {
    backgroundColor: colors.chipBg,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  stepInput: {
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    fontFamily: type.mono,
    fontSize: type.size.sm,
    paddingHorizontal: 6,
    paddingVertical: 4,
    minWidth: 52,
    textAlign: 'right',
  },
  numRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  irrCell: {
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRightColor: colors.border,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  irrCellActive: {
    backgroundColor: colors.accentDim,
    borderRadius: 4,
  },
  mosRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  verdictRow: { flexDirection: 'row', justifyContent: 'space-between' },
  verdictCell: { flex: 1, alignItems: 'center' },
});
