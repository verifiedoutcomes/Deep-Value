/**
 * Valuation screen — the heart of the app, laid out as the sheet is:
 *
 *  - a fixed left rail: Bull/Base/Bear (with each fair value) and 3/5 yr
 *  - fair value / IRR / price Δ results
 *  - the forecast block exactly like sheet rows 61:67 — one row per year
 *    with Revenue, Y/Y Δ (editable), Op Income, Op Margin (editable),
 *    Adj FCF Margin (editable), Adj FCF and PV of Adj FCF
 *  - terminal inputs (exit multiple, discount rate, adjustment)
 *  - what the price implies (reverse DCF) and the fair-value sensitivity
 *    grid — app-only lenses, flagged as such in their ⓘ cards
 *  - IRR-at-price strip, margin of safety, verdict
 *
 * Every computed number carries an (i) tag that opens the formula with
 * live values substituted, so the whole calculation can be followed from
 * TTM revenue to fair value.
 */
import React, { useMemo } from 'react';
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
  CapexTreatment,
  CompanyAnalysis,
  HorizonYears,
  ImpliedExpectations,
  ImpliedValue,
  Maybe,
  ScenarioKind,
  ScenarioOverrides,
  ScenarioValuation,
  SensitivityGrid,
  ValuationAnchors,
} from '@dvh/engine';
import {
  checkAssumptions,
  computeIrrStrip,
  computeMarginOfSafety,
  computeVerdict,
  DEFAULT_DISCOUNT_RATE,
  DEFAULT_MOS_THRESHOLDS,
  derive3yExitMultiple,
  fadeGrowth,
  impliedExpectations,
  seedBaseScenario,
  sensitivityGrid,
} from '@dvh/engine';
import { useTickerAnalysis } from '../../src/analysis';
import { useAppStore } from '../../src/store';
import { tapHaptic, toggleHaptic } from '../../src/haptics';
import { colors, deltaColor, space, type } from '../../src/theme';
import { Banner, Card, Chip, Mono, SectionTitle } from '../../src/components/ui';
import { AnalysisBar } from '../../src/components/AnalysisBar';
import { AssumptionChecks } from '../../src/components/AssumptionChecks';
import { CapexInfoTag } from '../../src/components/CapexInfo';
import { FormulaProvider, InfoTag } from '../../src/components/FormulaInfo';
import {
  adjFcfMarginFormula,
  exitMultipleFormula,
  fairValueFormula,
  forecastRevenueFormula,
  impliedFormula,
  irrFormula,
  moicFormula,
  irrStripFormula,
  pvOfFcfFormula,
  sensitivityFormula,
  targetBuyFormula,
} from '../../src/formulas';
import { money, pct, price } from '../../src/format';
import { AskAiCard } from '../../src/components/AskAiCard';
import { buildForecastPrompt, type ParsedForecast } from '../../src/llmPrompt';

const KIND_LABEL: Record<ScenarioKind, string> = { bear: 'Bear', base: 'Base', bull: 'Bull' };

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
  const setCapexTreatment = useAppStore((s) => s.setCapexTreatment);
  const readOnly = reviewing != null;

  // app-only lenses over the open scenario (cheap: no IRR solves)
  const lenses = useMemo(() => {
    if (!analysis) return null;
    const inputs = analysis.scenarioInputs[kind][horizon];
    // The sheet's strip, margin of safety and verdict use the 5-year
    // block; here they follow the horizon on screen.
    const s = analysis.scenarios;
    const base = s.base[horizon];
    return {
      inputs,
      implied: impliedExpectations(analysis.anchors, inputs),
      grid: sensitivityGrid(analysis.anchors, inputs),
      flags: checkAssumptions(analysis, kind, horizon, capexTreatment, snapshot?.rows),
      irrStrip: computeIrrStrip(analysis.anchors, base),
      marginOfSafety: computeMarginOfSafety(
        base.status === 'ok' ? base.fairValuePerShare : null,
        overrides.mosThresholds ?? DEFAULT_MOS_THRESHOLDS,
      ),
      verdict: computeVerdict(analysis.anchors.price, s.bear[horizon], base, s.bull[horizon]),
    };
  }, [analysis, kind, horizon, capexTreatment, snapshot, overrides.mosThresholds]);

  if (!snapshot || !analysis || !lenses) {
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

  const applyAiForecast = (p: ParsedForecast) => {
    if (readOnly) return;
    const hz = p.horizon;
    const nextYears = { ...overrides.years };
    const exit5 = { ...overrides.exitMultiple5 };
    const exit3 = { ...overrides.exitMultiple3 };
    for (const k of ['bear', 'base', 'bull'] as ScenarioKind[]) {
      const sc = p.scenarios[k];
      if (!sc) continue;
      nextYears[k] = { ...nextYears[k], [hz]: sc.years };
      if (sc.exitMultiple != null) (hz === 5 ? exit5 : exit3)[k] = sc.exitMultiple;
    }
    setOverrides(ticker, { ...overrides, years: nextYears, exitMultiple5: exit5, exitMultiple3: exit3 });
    if (hz !== horizon) setHorizon(ticker, hz);
  };

  const setYearsAll = (next: typeof years) =>
    patch({ years: { ...overrides.years, [kind]: { ...overrides.years?.[kind], [horizon]: next } } });
  const checkActions = {
    fadeGrowth: () => setYearsAll(fadeGrowth(lenses.inputs.years)),
    useMultiple: (m: number) =>
      horizon === 5
        ? patch({ exitMultiple5: { ...overrides.exitMultiple5, [kind]: m } })
        : patch({ exitMultiple3: { ...overrides.exitMultiple3, [kind]: m } }),
    useConventional: () => setCapexTreatment('conventional'),
    useOpMargin: (m: number) =>
      setYearsAll(lenses.inputs.years.map((y) => ({ ...y, operatingMargin: m }))),
    useFcfMargin: (m: number) =>
      setYearsAll(lenses.inputs.years.map((y) => ({ ...y, adjFcfMargin: m }))),
  };

  return (
    <FormulaProvider>
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={96}
    >
    <View style={{ flex: 1, flexDirection: 'row' }}>
    <ScenarioRail
      analysis={analysis}
      kind={kind}
      horizon={horizon}
      priceToday={snapshot.quote.price}
      disabled={readOnly}
      onKind={(k) => setScenarioTab(ticker, k)}
      onHorizon={(hz) => setHorizon(ticker, hz)}
    />
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: space.xl }}
      keyboardShouldPersistTaps="handled"
    >
      <AnalysisBar reviewing={reviewing} />

      <ResultCard
        valuation={valuation}
        anchors={anchors}
        horizon={horizon}
        kind={kind}
        priceToday={snapshot.quote.price}
      />
      {kind !== 'base' && !hasEdits && !readOnly && valuation.status !== 'no-forecast' && (
        <Banner>
          {KIND_LABEL[kind]} starts as a copy of Base, so their values match. Make it a{' '}
          {kind === 'bear' ? 'downside' : 'upside'} case: edit the boxed inputs below, or fill all
          three at once with &quot;Ask an AI&quot; further down.
        </Banner>
      )}
      <AssumptionChecks
        flags={lenses.flags}
        finalYear={finalYear}
        readOnly={readOnly}
        actions={checkActions}
      />

      {/* ---- the sheet's forecast block (rows 61:67 / 86:92) ---- */}
      <Card style={{ paddingHorizontal: 0 }}>
        <View style={[styles.assumTitleRow, { paddingHorizontal: space.md }]}>
          <SectionTitle>
            {KIND_LABEL[kind]} case · {horizon}-year forecast to {finalYear}
          </SectionTitle>
          {hasEdits && !readOnly && (
            <Pressable onPress={resetToSeeded} hitSlop={8}>
              <Mono size="xs" color={colors.blue}>↺ Reset to seeded</Mono>
            </Pressable>
          )}
        </View>
        <ForecastTable
          valuation={valuation}
          anchors={anchors}
          years={years}
          fcfRate={fcfRate}
          setYear={setYear}
          capexTreatment={capexTreatment}
        />
        <View style={{ paddingHorizontal: space.md, gap: 4 }}>
          <Mono size="xs" color={colors.textFaint}>
            Boxed cells are yours to edit (use − and + or type a %). Tap ⓘ to see how any number is
            calculated.
          </Mono>
          <CapexInfoTag />
        </View>
      </Card>

      <AskAiCard
        readOnly={readOnly}
        onApply={applyAiForecast}
        buildPrompt={() =>
          buildForecastPrompt({ snapshot, analysis, horizon, capexTreatment, discountRate: fcfRate })
        }
      />

      {/* ---- terminal inputs (sheet N61:N66 block) ---- */}
      <Card>
        <SectionTitle>Terminal value inputs</SectionTitle>
        <NumRow
          label={`Exit EV/EBIT multiple in ${finalYear}`}
          value={exitCurrent}
          digits={1}
          info={() =>
            exitMultipleFormula(
              horizon,
              exitCurrent,
              seededExit5,
              analysis.header.evOverOperatingIncome,
              analysis.summary.evEbitTrimmean,
            )
          }
          onCommit={(v) =>
            horizon === 5
              ? patch({ exitMultiple5: { ...overrides.exitMultiple5, [kind]: v } })
              : patch({ exitMultiple3: { ...overrides.exitMultiple3, [kind]: v } })
          }
        />
        <NumRow
          label="Discount rate (%)"
          value={(horizon === 5 ? overrides.discountRate5 : overrides.discountRate3) ?? DEFAULT_DISCOUNT_RATE}
          digits={1}
          scale={100}
          onCommit={(v) => (horizon === 5 ? patch({ discountRate5: v }) : patch({ discountRate3: v }))}
        />
        <NumRow
          label="Adjustment ($M)"
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

      {valuation.status === 'ok' && (
        <>
          <ImpliedCard
            implied={lenses.implied}
            priceToday={snapshot.quote.price}
            kind={kind}
            horizon={horizon}
            info={() => impliedFormula(lenses.implied, anchors, lenses.inputs, horizon)}
          />
          <SensitivityCard
            grid={lenses.grid}
            priceToday={snapshot.quote.price}
            info={() => sensitivityFormula(lenses.grid, horizon)}
          />
        </>
      )}

      <Card>
        <SectionTitle>Base-case return (IRR) if you buy at…</SectionTitle>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {lenses.irrStrip.map((cell) => {
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
          Target buy price = base fair value {price(lenses.verdict.baseFairValue)} × (1 − margin
          of safety): the price that builds in that discount. Edit the % on the left.
        </Mono>
        <View style={{ height: space.xs }} />
        {lenses.marginOfSafety.map((row, i) => (
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
                    lenses.verdict.baseFairValue,
                    row.targetBuyPrice,
                  )
                }
              />
            </View>
          </View>
        ))}
      </Card>

      <Card>
        <SectionTitle>Verdict · {horizon}-year fair value of each case</SectionTitle>
        <View style={styles.verdictRow}>
          {(
            [
              ['Bear', lenses.verdict.bearFairValue],
              ['Base', lenses.verdict.baseFairValue],
              ['Bull', lenses.verdict.bullFairValue],
            ] as [string, Maybe][]
          ).map(([label, fv]) => (
            <View key={label} style={styles.verdictCell}>
              <Mono size="xs" color={colors.textFaint}>{label}</Mono>
              <Mono
                size="md"
                bold
                color={fv == null ? colors.textFaint : fv >= snapshot.quote.price ? colors.accent : colors.red}
              >
                {fv == null ? 'No forecast' : price(fv)}
              </Mono>
              <Mono size="xs" color={colors.textDim}>
                {fv == null ? ' ' : upsideText(fv / lenses.verdict.price - 1)}
              </Mono>
            </View>
          ))}
        </View>
      </Card>
    </ScrollView>
    </View>
    </KeyboardAvoidingView>
    </FormulaProvider>
  );
}

/* ---------------- results ---------------- */

/** "45% above today's price" / "12% below today's price". */
function upsideText(delta: number): string {
  if (Math.abs(delta) < 0.005) return "≈ today's price";
  return `${pct(Math.abs(delta), Math.abs(delta) >= 0.1 ? 0 : 1)} ${delta > 0 ? 'above' : 'below'} price`;
}

function ResultCard({
  valuation,
  anchors,
  horizon,
  kind,
  priceToday,
}: {
  valuation: ScenarioValuation;
  anchors: ValuationAnchors;
  horizon: HorizonYears;
  kind: ScenarioKind;
  priceToday: number;
}) {
  if (valuation.status === 'no-forecast') {
    return (
      <Card>
        <Mono size="lg" color={colors.textFaint}>No forecast yet</Mono>
        <Mono size="xs" color={colors.textFaint}>
          Enter margins below to value the {KIND_LABEL[kind]} case.
        </Mono>
      </Card>
    );
  }
  if (valuation.status === 'num-error') {
    return (
      <Card style={{ borderColor: colors.red }}>
        <Mono size="xs" color={colors.textFaint}>
          Fair value per share · {KIND_LABEL[kind]} case, {horizon} years
        </Mono>
        <Mono size="lg" bold color={colors.red}>No valid result</Mono>
        <Mono size="xs" color={colors.textDim}>
          With these inputs the company is worth less than nothing at the end of the forecast
          (or the cash flows can&apos;t be solved for a return). Usually the operating margin or
          the exit multiple is negative: check them below.
        </Mono>
      </Card>
    );
  }
  const delta = valuation.priceDelta;
  return (
    <Card>
      <Mono size="xs" color={colors.textFaint}>
        {KIND_LABEL[kind]} case · {horizon}-year forecast
      </Mono>
      <View style={[styles.resultRow, { marginTop: 4 }]}>
        <View style={{ flexShrink: 1 }}>
          <Mono size="xs" color={colors.textDim}>Fair value per share</Mono>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Mono size="xl" bold color={colors.accent}>
              {price(valuation.fairValuePerShare)}
            </Mono>
            <InfoTag spec={() => fairValueFormula(valuation, anchors, horizon)} />
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Mono size="xs" color={colors.textDim}>Expected return</Mono>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Mono size="xl" bold color={deltaColor(valuation.irr)}>
              {pct(valuation.irr)}
            </Mono>
            <InfoTag spec={() => irrFormula(valuation, anchors, horizon)} />
          </View>
          <Mono size="xs" color={colors.textFaint}>per year (IRR)</Mono>
        </View>
      </View>
      {delta != null && (
        <View style={styles.verdictLine}>
          <Mono size="sm" bold color={deltaColor(delta)}>
            {delta >= 0 ? '▲' : '▼'} {upsideText(delta)}
          </Mono>
          <Mono size="xs" color={colors.textDim}>
            {delta >= 0
              ? `Worth more than today's ${price(priceToday)}: potentially undervalued in this case.`
              : `Worth less than today's ${price(priceToday)}: overvalued in this case.`}
          </Mono>
        </View>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
        <Mono size="xs" color={colors.textDim}>
          Money multiple (MOIC): {valuation.horizonMoic.toFixed(2)}× in {horizon} years
        </Mono>
        <InfoTag spec={() => moicFormula(valuation, anchors, horizon)} />
      </View>
    </Card>
  );
}

/* ---------------- the scenario rail ---------------- */

const RAIL: { kind: ScenarioKind; tone: string }[] = [
  { kind: 'bull', tone: colors.accent },
  { kind: 'base', tone: colors.blue },
  { kind: 'bear', tone: colors.red },
];

/** Compact price for the rail: whole dollars, cents under $100. */
function railPrice(v: Maybe): string {
  if (v == null) return '–';
  if (Math.abs(v) >= 100_000) return `$${Math.round(v / 1000)}k`;
  return Math.abs(v) >= 100 ? `$${Math.round(v)}` : `$${v.toFixed(2)}`;
}

/**
 * Always-visible left rail: Bull/Base/Bear with each case's fair value
 * (green above today's price, red below), then the 3/5-year switch.
 */
function ScenarioRail({
  analysis,
  kind,
  horizon,
  priceToday,
  disabled,
  onKind,
  onHorizon,
}: {
  analysis: CompanyAnalysis;
  kind: ScenarioKind;
  horizon: HorizonYears;
  priceToday: number;
  disabled: boolean;
  onKind: (k: ScenarioKind) => void;
  onHorizon: (h: HorizonYears) => void;
}) {
  return (
    <View style={[styles.rail, disabled && { opacity: 0.55 }]}>
      <Mono size="xs" color={colors.textFaint}>Case</Mono>
      {RAIL.map(({ kind: k, tone }) => {
        const v = analysis.scenarios[k][horizon];
        const fv = v.status === 'ok' ? v.fairValuePerShare : null;
        const active = kind === k;
        return (
          <Pressable
            key={k}
            onPress={() => {
              if (disabled) return;
              tapHaptic();
              onKind(k);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${KIND_LABEL[k]} case, fair value ${railPrice(fv)}`}
            style={[
              styles.railBtn,
              active && { borderColor: tone, borderLeftColor: tone, backgroundColor: colors.surfaceAlt },
            ]}
          >
            <Mono size="sm" bold color={active ? tone : colors.textDim}>
              {KIND_LABEL[k]}
            </Mono>
            <Mono
              size="xs"
              color={fv == null ? colors.textFaint : fv >= priceToday ? colors.accent : colors.red}
            >
              {railPrice(fv)}
            </Mono>
          </Pressable>
        );
      })}
      <View style={styles.railDivider} />
      <Mono size="xs" color={colors.textFaint}>Years</Mono>
      {([3, 5] as HorizonYears[]).map((hz) => {
        const active = horizon === hz;
        return (
          <Pressable
            key={hz}
            onPress={() => {
              if (disabled) return;
              tapHaptic();
              onHorizon(hz);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${hz}-year forecast`}
            style={[
              styles.railBtn,
              active && { borderColor: colors.text, borderLeftColor: colors.text, backgroundColor: colors.surfaceAlt },
            ]}
          >
            <Mono size="sm" bold={active} color={active ? colors.text : colors.textDim}>
              {hz} yr
            </Mono>
          </Pressable>
        );
      })}
      <View style={{ flex: 1 }} />
      <Mono size="xs" color={colors.textFaint}>Today</Mono>
      <Mono size="xs" color={colors.textDim}>{railPrice(priceToday)}</Mono>
    </View>
  );
}

/* ---------------- reverse DCF + sensitivity (app-only) ---------------- */

function impliedText(v: ImpliedValue, fmt: (x: number) => string, lo: string, hi: string): string {
  if (v.value != null) return fmt(v.value);
  return v.bound === 'below' ? lo : v.bound === 'above' ? hi : 'n/a';
}

function ImpliedCard({
  implied,
  priceToday,
  kind,
  horizon,
  info,
}: {
  implied: ImpliedExpectations;
  priceToday: number;
  kind: ScenarioKind;
  horizon: HorizonYears;
  info: () => import('../../src/formulas').FormulaSpec;
}) {
  const rows: { label: string; implied: string; yours: string; cushion: boolean | null }[] = [
    {
      label: 'Revenue growth / yr',
      implied: impliedText(implied.revenueGrowth, (x) => pct(x), '< −50%', '> 100%'),
      yours: pct(implied.scenarioGrowthCagr),
      cushion:
        implied.revenueGrowth.value != null
          ? implied.revenueGrowth.value <= implied.scenarioGrowthCagr
          : implied.revenueGrowth.bound === 'below'
            ? true
            : implied.revenueGrowth.bound === 'above'
              ? false
              : null,
    },
    {
      label: 'Exit EV/EBIT',
      implied: impliedText(implied.exitMultiple, (x) => `${x.toFixed(1)}×`, '< 0×', 'n/a'),
      yours: `${implied.scenarioExitMultiple.toFixed(1)}×`,
      cushion:
        implied.exitMultiple.value != null
          ? implied.exitMultiple.value <= implied.scenarioExitMultiple
          : implied.exitMultiple.bound === 'below'
            ? true
            : null,
    },
  ];
  return (
    <Card>
      <View style={styles.assumTitleRow}>
        <SectionTitle>
          What {price(priceToday)} prices in · {KIND_LABEL[kind]}, {horizon} yr
        </SectionTitle>
        <InfoTag spec={info} />
      </View>
      <View style={styles.impHead}>
        <View style={{ flex: 1 }} />
        <View style={styles.impCol}>
          <Mono size="xs" color={colors.textFaint}>Priced in</Mono>
        </View>
        <View style={styles.impCol}>
          <Mono size="xs" color={colors.textFaint}>Yours</Mono>
        </View>
      </View>
      {rows.map((r) => (
        <View key={r.label} style={styles.impRow}>
          <View style={{ flex: 1 }}>
            <Mono size="sm" color={colors.textDim}>{r.label}</Mono>
          </View>
          <View style={styles.impCol}>
            <Mono
              size="md"
              bold
              color={r.cushion == null ? colors.textDim : r.cushion ? colors.accent : colors.red}
            >
              {r.implied}
            </Mono>
          </View>
          <View style={styles.impCol}>
            <Mono size="sm" color={colors.text}>{r.yours}</Mono>
          </View>
        </View>
      ))}
      <Mono size="xs" color={colors.textFaint}>
        What today&apos;s price already assumes, changing one input at a time and holding the rest of
        this case fixed. Green: the market expects less than you do.
      </Mono>
    </Card>
  );
}

/** Whole dollars when that is precise enough, cents for low prices. */
function cellPrice(v: Maybe): string {
  if (v == null) return '–';
  return v >= 100 ? `$${Math.round(v)}` : `$${v.toFixed(2)}`;
}

function SensitivityCard({
  grid,
  priceToday,
  info,
}: {
  grid: SensitivityGrid;
  priceToday: number;
  info: () => import('../../src/formulas').FormulaSpec;
}) {
  return (
    <Card>
      <View style={styles.assumTitleRow}>
        <SectionTitle>Fair value · exit multiple × rate</SectionTitle>
        <InfoTag spec={info} />
      </View>
      <View style={styles.sensRow}>
        <View style={styles.sensLabel}>
          <Mono size="xs" color={colors.textFaint}>Rate</Mono>
        </View>
        {grid.exitMultiples.map((x, c) => (
          <View key={c} style={styles.sensCell}>
            <Mono size="xs" color={c === grid.current.col ? colors.amber : colors.textFaint} bold>
              {x.toFixed(1)}×
            </Mono>
          </View>
        ))}
      </View>
      {grid.fairValue.map((row, r) => (
        <View key={r} style={styles.sensRow}>
          <View style={styles.sensLabel}>
            <Mono size="xs" color={r === grid.current.row ? colors.amber : colors.textFaint} bold>
              {pct(grid.discountRates[r]!, 0)}
            </Mono>
          </View>
          {row.map((fv, c) => {
            const centre = r === grid.current.row && c === grid.current.col;
            return (
              <View
                key={c}
                style={[
                  styles.sensCell,
                  styles.sensValue,
                  {
                    backgroundColor:
                      fv == null ? 'transparent' : fv >= priceToday ? colors.accentDim : colors.redDim,
                  },
                  centre && styles.sensCentre,
                ]}
              >
                <Mono
                  size="xs"
                  bold={centre}
                  color={fv == null ? colors.textFaint : fv >= priceToday ? colors.text : colors.redSoft}
                >
                  {cellPrice(fv)}
                </Mono>
              </View>
            );
          })}
        </View>
      ))}
      <Mono size="xs" color={colors.textFaint}>
        Rows: discount rate. Columns: exit multiple. The outlined centre is your inputs. Green is
        at or above today&apos;s {price(priceToday)}, red below.
      </Mono>
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
  capexTreatment,
}: {
  valuation: ScenarioValuation;
  anchors: ValuationAnchors;
  years: { revenueYoY: number; operatingMargin: number; adjFcfMargin: number }[];
  fcfRate: number;
  setYear: (idx: number, f: 'revenueYoY' | 'operatingMargin' | 'adjFcfMargin', v: number) => void;
  capexTreatment: CapexTreatment;
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
        <FCol title="Rev growth" editable>
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
        <FCol title="Op margin" editable>
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
        <FCol title="Op income">
          {f.map((row, t) => (
            <View key={t} style={[styles.frow, styles.fcomputed]}>
              <Mono size="xs">{money(row.operatingIncome)}</Mono>
            </View>
          ))}
        </FCol>
        {/* FCF margin — editable */}
        <FCol title="Adj FCF margin" editable>
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
                spec={() =>
                  adjFcfMarginFormula(row.year, row.revenue, row.adjFcfMargin, row.adjFcf, capexTreatment)
                }
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
  rail: {
    width: 64,
    paddingTop: space.md,
    paddingBottom: space.md,
    paddingHorizontal: 5,
    gap: 6,
    alignItems: 'stretch',
    borderRightColor: colors.border,
    borderRightWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.bg,
  },
  railBtn: {
    alignItems: 'center',
    borderWidth: 1,
    borderLeftWidth: 4,
    borderColor: colors.border,
    borderLeftColor: colors.border,
    borderRadius: 6,
    paddingVertical: 8,
    backgroundColor: colors.chipBg,
    gap: 2,
  },
  railDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: space.xs,
  },
  verdictLine: {
    marginTop: space.sm,
    paddingTop: space.sm,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 2,
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
  impHead: { flexDirection: 'row', marginBottom: 2 },
  impRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 2,
  },
  impCol: { width: 76, alignItems: 'flex-end' },
  sensRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 3, gap: 3 },
  sensLabel: { width: 34 },
  sensCell: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 24 },
  sensValue: { borderRadius: 3 },
  sensCentre: { borderColor: colors.amber, borderWidth: 1 },
  verdictCell: { flex: 1, alignItems: 'center' },
});
