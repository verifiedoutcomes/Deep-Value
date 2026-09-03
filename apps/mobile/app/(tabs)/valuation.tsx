/**
 * Valuation screen — the heart of the app, laid out as the sheet is:
 *
 *  - scenario tabs (Bear/Base/Bull) and 5yr/3yr toggle
 *  - fair value / IRR / price Δ results
 *  - the forecast block exactly like sheet rows 61:67 — one row per year
 *    with Revenue, Y/Y Δ (editable), Op Income, Op Margin (editable),
 *    Adj FCF Margin (editable), Adj FCF and PV of Adj FCF
 *  - terminal inputs (exit multiple, discount rate, adjustment)
 *  - IRR-at-price strip, margin of safety, verdict
 *
 * Every computed number carries an (i) tag that opens the formula with
 * live values substituted, so the whole calculation can be followed from
 * TTM revenue to fair value.
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
  ValuationAnchors,
} from '@dvh/engine';
import {
  DEFAULT_DISCOUNT_RATE,
  DEFAULT_MOS_THRESHOLDS,
  derive3yExitMultiple,
  seedBaseScenario,
} from '@dvh/engine';
import { useTickerAnalysis } from '../../src/analysis';
import { useAppStore } from '../../src/store';
import { tapHaptic, toggleHaptic } from '../../src/haptics';
import { colors, deltaColor, space, type } from '../../src/theme';
import { Banner, Card, Chip, Mono, SectionTitle } from '../../src/components/ui';
import { AnalysisBar } from '../../src/components/AnalysisBar';
import { CapexInfoTag } from '../../src/components/CapexInfo';
import { FormulaProvider, InfoTag } from '../../src/components/FormulaInfo';
import {
  adjFcfMarginFormula,
  exitMultipleFormula,
  fairValueFormula,
  forecastRevenueFormula,
  irrFormula,
  irrStripFormula,
  pvOfFcfFormula,
  targetBuyFormula,
} from '../../src/formulas';
import { money, pct, pctSigned, price } from '../../src/format';

export default function ValuationScreen() {
  const {
    ticker,
    snapshot,
    analysis,
    overrides,
    capexTreatment,
    horizon,
    scenarioTab: kind,
    reviewing,
  } = useTickerAnalysis();
  const setOverrides = useAppStore((s) => s.setOverrides);
  const setHorizon = useAppStore((s) => s.setHorizon);
  const setScenarioTab = useAppStore((s) => s.setScenarioTab);
  const readOnly = reviewing != null;

  if (!snapshot || !analysis) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: space.lg }}>
        <Banner>No snapshot for {ticker} yet — load one from the Company tab.</Banner>
      </View>
    );
  }

  const valuation = analysis.scenarios[kind][horizon];
  const anchors = analysis.anchors;
  const seededExit5 = analysis.seededExitMultiple5;

  // App mode: every scenario (Bear/Bull included) seeds from the Base
  // case, so users adjust from a live starting point.
  const years =
    overrides.years?.[kind]?.[horizon] ?? seedBaseScenario(analysis.derived, horizon, true);

  // In review mode the frozen analysis is read-only: edits are ignored.
  const patch = (p: Partial<ScenarioOverrides>) => {
    if (readOnly) return;
    setOverrides(ticker, { ...overrides, ...p });
  };

  const setYear = (
    idx: number,
    field: 'revenueYoY' | 'operatingMargin' | 'adjFcfMargin',
    v: number,
  ) => {
    if (readOnly) return;
    const next = years.map((y, i) => (i === idx ? { ...y, [field]: v } : y));
    patch({
      years: {
        ...overrides.years,
        [kind]: { ...overrides.years?.[kind], [horizon]: next },
      },
    });
  };

  const exit5 = overrides.exitMultiple5?.[kind] ?? seededExit5;
  const exitCurrent =
    horizon === 5
      ? exit5
      : overrides.exitMultiple3?.[kind] ?? derive3yExitMultiple(kind, exit5, true);
  const fcfRate = overrides.discountRate5 ?? DEFAULT_DISCOUNT_RATE;

  const hasEdits =
    overrides.years?.[kind]?.[horizon] != null ||
    (horizon === 5
      ? overrides.exitMultiple5?.[kind] != null
      : overrides.exitMultiple3?.[kind] != null) ||
    overrides.adjustmentMillions?.[kind]?.[horizon] != null;

  const resetToSeeded = () => {
    if (readOnly) return;
    toggleHaptic();
    const yearsCopy = { ...overrides.years?.[kind] };
    delete yearsCopy[horizon];
    const adj = { ...overrides.adjustmentMillions?.[kind] };
    delete adj[horizon];
    const next = {
      ...overrides,
      years: { ...overrides.years, [kind]: yearsCopy },
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

  const finalYear = anchors.firstForecastYear + horizon - 1;

  return (
    <FormulaProvider>
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
      <AnalysisBar reviewing={reviewing} />
      <View style={[styles.toggles, readOnly && { opacity: 0.55 }]}>
        <View style={{ flexDirection: 'row' }}>
          {(['bear', 'base', 'bull'] as ScenarioKind[]).map((k) => (
            <Chip
              key={k}
              label={k.toUpperCase()}
              active={kind === k}
              tone={k === 'bear' ? 'bad' : k === 'bull' ? 'good' : 'neutral'}
              onPress={() => {
                if (readOnly) return;
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
                if (readOnly) return;
                tapHaptic();
                setHorizon(ticker, hz);
              }}
            />
          ))}
        </View>
      </View>

      <ResultCard
        valuation={valuation}
        anchors={anchors}
        horizon={horizon}
        priceToday={snapshot.quote.price}
      />

      {/* ---- the sheet's forecast block (rows 61:67 / 86:92) ---- */}
      <Card style={{ paddingHorizontal: 0 }}>
        <View style={[styles.assumTitleRow, { paddingHorizontal: space.md }]}>
          <SectionTitle>
            {horizon}-year {finalYear} forecast · {kind}
          </SectionTitle>
          {hasEdits && !readOnly && (
            <Pressable onPress={resetToSeeded} hitSlop={8}>
              <Mono size="xs" color={colors.blue}>↺ reset to seeded</Mono>
            </Pressable>
          )}
        </View>
        <ForecastTable
          valuation={valuation}
          anchors={anchors}
          years={years}
          fcfRate={fcfRate}
          setYear={setYear}
        />
        <View style={{ paddingHorizontal: space.md, gap: 4 }}>
          <Mono size="xs" color={colors.textFaint}>
            boxed cells are yours to edit · tap ⓘ to follow any calculation
          </Mono>
          <CapexInfoTag />
        </View>
      </Card>

      {/* ---- terminal inputs (sheet N61:N66 block) ---- */}
      <Card>
        <SectionTitle>Terminal value inputs</SectionTitle>
        <NumRow
          label={`exit EV/EBIT at ${finalYear}`}
          value={exitCurrent}
          digits={1}
          info={() => exitMultipleFormula(horizon, kind, exitCurrent, seededExit5)}
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
      </Card>

      <Card>
        <SectionTitle>Base-case IRR at price</SectionTitle>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {analysis.irrStrip.map((cell) => {
            const isCurrent = Math.abs(cell.price - Math.round(snapshot.quote.price)) < 0.5;
            return (
              <Pressable
                key={cell.price}
                style={[styles.irrCell, isCurrent && styles.irrCellActive]}
                onPress={() => {}}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Mono size="sm" bold color={isCurrent ? colors.accent : colors.text}>
                    {price(cell.price).replace('.00', '')}
                  </Mono>
                  <InfoTag spec={() => irrStripFormula(cell.price, anchors, cell.irr)} />
                </View>
                <Mono size="xs" color={deltaColor(cell.irr)}>{pct(cell.irr)}</Mono>
              </Pressable>
            );
          })}
        </ScrollView>
      </Card>

      <Card>
        <SectionTitle>Margin of safety · target buy</SectionTitle>
        <Mono size="xs" color={colors.textFaint}>
          target buy = base fair value {price(analysis.verdict.baseFairValue)} × (1 − MoS) — the
          entry price that bakes in that discount to fair value
        </Mono>
        <View style={{ height: space.xs }} />
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
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Mono size="sm" color={colors.accent} bold>
                {price(row.targetBuyPrice)}
              </Mono>
              <InfoTag
                spec={() =>
                  targetBuyFormula(
                    row.threshold,
                    analysis.verdict.baseFairValue,
                    row.targetBuyPrice,
                  )
                }
              />
            </View>
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
              <Mono
                size="md"
                bold
                color={fv == null ? colors.textFaint : fv >= snapshot.quote.price ? colors.accent : colors.red}
              >
                {fv == null ? 'No Forecast' : price(fv)}
              </Mono>
              <Mono size="xs" color={colors.textDim}>vs {price(analysis.verdict.price)}</Mono>
            </View>
          ))}
        </View>
      </Card>
    </ScrollView>
    </KeyboardAvoidingView>
    </FormulaProvider>
  );
}

/* ---------------- results ---------------- */

function ResultCard({
  valuation,
  anchors,
  horizon,
  priceToday,
}: {
  valuation: ScenarioValuation;
  anchors: ValuationAnchors;
  horizon: HorizonYears;
  priceToday: number;
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
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Mono size="xl" bold color={err ? colors.red : colors.accent}>
              {err ? '#NUM!' : price(valuation.fairValuePerShare)}
            </Mono>
            {!err && <InfoTag spec={() => fairValueFormula(valuation, anchors, horizon)} />}
          </View>
          <Mono size="xs" color={deltaColor(valuation.priceDelta)}>
            {err ? 'no IRR root — check the assumptions' : `${pctSigned(valuation.priceDelta)} vs ${price(priceToday)}`}
          </Mono>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Mono size="xs" color={colors.textFaint}>IRR</Mono>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Mono size="xl" bold color={err ? colors.red : colors.text}>
              {err ? '–' : pct(valuation.irr)}
            </Mono>
            {!err && <InfoTag spec={() => irrFormula(valuation, anchors, horizon)} />}
          </View>
          <Mono size="xs" color={colors.textDim}>
            {`${horizon}-yr MOIC ${valuation.horizonMoic.toFixed(2)}×`}
          </Mono>
        </View>
      </View>
    </Card>
  );
}

/* ---------------- the sheet-like forecast table ---------------- */

const FROW_H = 34;

function ForecastTable({
  valuation,
  anchors,
  years,
  fcfRate,
  setYear,
}: {
  valuation: ScenarioValuation;
  anchors: ValuationAnchors;
  years: { revenueYoY: number; operatingMargin: number; adjFcfMargin: number }[];
  fcfRate: number;
  setYear: (idx: number, f: 'revenueYoY' | 'operatingMargin' | 'adjFcfMargin', v: number) => void;
}) {
  const f = valuation.forecast;
  return (
    <View style={{ flexDirection: 'row', marginBottom: space.sm }}>
      <View style={styles.fyearCol}>
        <View style={styles.fhead}><Mono size="xs" color={colors.textFaint}> </Mono></View>
        {f.map((row) => (
          <View key={row.year} style={styles.frow}>
            <Mono size="xs" color={colors.textDim} bold>{row.year}</Mono>
          </View>
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {/* Rev Y/Y — editable */}
        <FCol title="Rev Y/Y ∆" editable>
          {f.map((row, t) => (
            <View key={t} style={styles.frow}>
              <MiniPct value={years[t]!.revenueYoY} onCommit={(v) => setYear(t, 'revenueYoY', v)} />
            </View>
          ))}
        </FCol>
        {/* Revenue — computed */}
        <FCol title="Revenue">
          {f.map((row, t) => (
            <View key={t} style={[styles.frow, styles.fcomputed]}>
              <Mono size="xs">{money(row.revenue)}</Mono>
              <InfoTag
                spec={() =>
                  forecastRevenueFormula(
                    row.year,
                    t === 0 ? anchors.ttmRevenue : f[t - 1]!.revenue,
                    row.revenueYoY,
                    row.revenue,
                    t === 0,
                  )
                }
              />
            </View>
          ))}
        </FCol>
        {/* Op margin — editable */}
        <FCol title="Op Margin" editable>
          {f.map((_row, t) => (
            <View key={t} style={styles.frow}>
              <MiniPct
                value={years[t]!.operatingMargin}
                onCommit={(v) => setYear(t, 'operatingMargin', v)}
              />
            </View>
          ))}
        </FCol>
        {/* Op income — computed */}
        <FCol title="Op Income">
          {f.map((row, t) => (
            <View key={t} style={[styles.frow, styles.fcomputed]}>
              <Mono size="xs">{money(row.operatingIncome)}</Mono>
            </View>
          ))}
        </FCol>
        {/* FCF margin — editable */}
        <FCol title="Adj FCF Mgn" editable>
          {f.map((_row, t) => (
            <View key={t} style={styles.frow}>
              <MiniPct
                value={years[t]!.adjFcfMargin}
                onCommit={(v) => setYear(t, 'adjFcfMargin', v)}
              />
            </View>
          ))}
        </FCol>
        {/* Adj FCF — computed */}
        <FCol title="Adj FCF">
          {f.map((row, t) => (
            <View key={t} style={[styles.frow, styles.fcomputed]}>
              <Mono size="xs">{money(row.adjFcf)}</Mono>
              <InfoTag
                spec={() => adjFcfMarginFormula(row.year, row.revenue, row.adjFcfMargin, row.adjFcf)}
              />
            </View>
          ))}
        </FCol>
        {/* PV of FCF — computed */}
        <FCol title="PV of Adj FCF">
          {f.map((row, t) => (
            <View key={t} style={[styles.frow, styles.fcomputed]}>
              <Mono size="xs" color={colors.blue}>{money(row.pvOfAdjFcf)}</Mono>
              <InfoTag
                spec={() => pvOfFcfFormula(row.year, t, row.adjFcf, fcfRate, row.pvOfAdjFcf)}
              />
            </View>
          ))}
        </FCol>
      </ScrollView>
    </View>
  );
}

function FCol({
  title,
  editable = false,
  children,
}: {
  title: string;
  editable?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.fcol}>
      <View style={styles.fhead}>
        <Mono size="xs" color={editable ? colors.amber : colors.textDim}>
          {title}
          {editable ? ' ✎' : ''}
        </Mono>
      </View>
      {children}
    </View>
  );
}

/** Compact percent editor for forecast cells (tap to type, ± steppers). */
function MiniPct({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [text, setText] = React.useState((value * 100).toFixed(1));
  React.useEffect(() => setText((value * 100).toFixed(1)), [value]);
  const bump = (dir: 1 | -1) => {
    tapHaptic();
    onCommit(Math.round((value + dir * 0.005) * 1000) / 1000);
  };
  return (
    <View style={styles.mini}>
      <Pressable onPress={() => bump(-1)} hitSlop={6} style={styles.miniBtn}>
        <Mono size="xs" color={colors.textDim}>−</Mono>
      </Pressable>
      <TextInput
        style={styles.miniInput}
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
      <Pressable onPress={() => bump(1)} hitSlop={6} style={styles.miniBtn}>
        <Mono size="xs" color={colors.textDim}>+</Mono>
      </Pressable>
    </View>
  );
}

/* ---------------- shared inputs ---------------- */

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
  info,
}: {
  label: string;
  value: number;
  digits: number;
  scale?: number;
  onCommit: (v: number) => void;
  info?: () => import('../../src/formulas').FormulaSpec;
}) {
  const [text, setText] = React.useState((value * scale).toFixed(digits));
  React.useEffect(() => setText((value * scale).toFixed(digits)), [value, scale, digits]);
  return (
    <View style={styles.numRow}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Mono size="sm" color={colors.textDim}>{label}</Mono>
        {info && <InfoTag spec={info} />}
      </View>
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
  assumTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  /* forecast table */
  fyearCol: {
    width: 46,
    flexShrink: 0,
    paddingLeft: space.md,
    borderRightColor: colors.border,
    borderRightWidth: StyleSheet.hairlineWidth,
    marginRight: space.sm,
  },
  // wide enough for the ± stepper in browser fonts too (web demo)
  fcol: { width: 124, paddingRight: space.sm, overflow: 'hidden' },
  fhead: { height: 20, justifyContent: 'center' },
  frow: {
    height: FROW_H,
    flexDirection: 'row',
    alignItems: 'center',
  },
  fcomputed: { justifyContent: 'flex-start' },
  mini: {
    flexDirection: 'row',
    alignItems: 'center',
    borderColor: colors.amber,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
    overflow: 'hidden',
  },
  miniBtn: {
    backgroundColor: colors.chipBg,
    paddingHorizontal: 6,
    paddingVertical: 5,
  },
  miniInput: {
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    fontFamily: type.mono,
    fontSize: type.size.xs,
    paddingHorizontal: 4,
    paddingVertical: 4,
    width: 46,
    textAlign: 'right',
  },
  /* shared inputs */
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
