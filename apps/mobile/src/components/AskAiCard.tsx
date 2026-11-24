/**
 * "Ask an AI for the forecast": copy a prompt carrying this company's
 * history into Claude (or any chat AI), paste its answer back, review
 * what it says, apply. Nothing changes until Apply; ↺ Reset to seeded
 * undoes it per scenario.
 */
import React from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import type { ScenarioKind } from '@dvh/engine';
import { parseForecastAnswer, type ParsedForecast } from '../llmPrompt';
import { copyText } from '../clipboard';
import { colors, space, type } from '../theme';
import { pct } from '../format';
import { successHaptic, tapHaptic, warningHaptic } from '../haptics';
import { Card, Mono, SectionTitle } from './ui';

const LABEL: Record<ScenarioKind, string> = { bear: 'Bear', base: 'Base', bull: 'Bull' };

export function AskAiCard({
  buildPrompt,
  onApply,
  readOnly,
}: {
  buildPrompt: () => string;
  onApply: (forecast: ParsedForecast) => void;
  readOnly: boolean;
}) {
  const [prompt, setPrompt] = React.useState<string | null>(null);
  const [showPrompt, setShowPrompt] = React.useState(false);
  const [copyState, setCopyState] = React.useState<'idle' | 'copied' | 'failed'>('idle');
  const [answer, setAnswer] = React.useState('');
  const [applied, setApplied] = React.useState<string | null>(null);

  const parsed = React.useMemo(() => (answer.trim() ? parseForecastAnswer(answer) : null), [answer]);

  if (readOnly) return null;

  const copy = () => {
    const text = buildPrompt();
    setPrompt(text);
    void copyText(text).then((ok) => {
      if (ok) {
        successHaptic();
        setCopyState('copied');
      } else {
        warningHaptic();
        setCopyState('failed');
        setShowPrompt(true);
      }
    });
  };

  const apply = () => {
    if (!parsed?.ok) return;
    onApply(parsed.value);
    successHaptic();
    const kinds = (Object.keys(parsed.value.scenarios) as ScenarioKind[]).map((k) => LABEL[k]);
    setApplied(`Applied to ${kinds.join(', ')} (${parsed.value.horizon}-year).`);
    setAnswer('');
  };

  return (
    <Card>
      <SectionTitle>Ask an AI for the forecast</SectionTitle>
      <Mono size="xs" color={colors.textDim}>
        Copy a prompt with this company&apos;s history into Claude or another AI. It answers with
        revenue growth, operating margin and FCF margin for each year of Bear, Base and Bull,
        plus exit multiples. Paste the whole answer below to fill in the forecast.
      </Mono>

      <View style={styles.buttons}>
        <Pressable onPress={copy} style={[styles.btn, styles.primary]} accessibilityRole="button">
          <Mono size="sm" color={colors.accent} bold>
            {copyState === 'copied' ? '✓ Prompt copied' : '1 · Copy prompt'}
          </Mono>
        </Pressable>
        <Pressable
          onPress={() => {
            tapHaptic();
            if (!prompt) setPrompt(buildPrompt());
            setShowPrompt((v) => !v);
          }}
          style={styles.btn}
          accessibilityRole="button"
        >
          <Mono size="sm" color={colors.blue}>{showPrompt ? 'Hide prompt' : 'Show prompt'}</Mono>
        </Pressable>
      </View>
      {copyState === 'failed' && (
        <Mono size="xs" color={colors.amber}>
          This viewer blocked copying. Tap in the box below, Select All, then Copy.
        </Mono>
      )}
      {showPrompt && prompt && (
        <TextInput
          style={[styles.box, { height: 180 }]}
          value={prompt}
          multiline
          // kept editable so it can be selected everywhere; typing is ignored
          onChangeText={() => {}}
          selectTextOnFocus
          scrollEnabled
        />
      )}

      <View style={{ height: space.sm }} />
      <Mono size="xs" color={colors.textFaint}>2 · Paste the AI&apos;s whole answer:</Mono>
      <TextInput
        style={[styles.box, { height: 96 }]}
        value={answer}
        onChangeText={(t) => {
          setAnswer(t);
          setApplied(null);
        }}
        multiline
        placeholder="Paste here…"
        placeholderTextColor={colors.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {parsed && !parsed.ok && (
        <Mono size="xs" color={colors.red}>{parsed.error}</Mono>
      )}
      {parsed?.ok && (
        <View style={{ gap: 4 }}>
          {(['bull', 'base', 'bear'] as ScenarioKind[]).map((k) => {
            const sc = parsed.value.scenarios[k];
            if (!sc) return null;
            const first = sc.years[0]!;
            const last = sc.years[sc.years.length - 1]!;
            return (
              <Mono key={k} size="xs" color={colors.textDim}>
                {LABEL[k]}: growth {pct(first.revenueYoY)}→{pct(last.revenueYoY)} · op margin{' '}
                {pct(first.operatingMargin)}→{pct(last.operatingMargin)} · FCF margin{' '}
                {pct(first.adjFcfMargin)}→{pct(last.adjFcfMargin)}
                {sc.exitMultiple != null ? ` · exit ${sc.exitMultiple.toFixed(1)}×` : ''}
              </Mono>
            );
          })}
          {parsed.value.warnings.map((w) => (
            <Mono key={w} size="xs" color={colors.amber}>{w}</Mono>
          ))}
          <Pressable onPress={apply} style={[styles.btn, styles.primary, { alignSelf: 'flex-start' }]}>
            <Mono size="sm" color={colors.accent} bold>
              3 · Apply to the {parsed.value.horizon}-year forecast
            </Mono>
          </Pressable>
        </View>
      )}
      {applied && (
        <Mono size="xs" color={colors.accent}>
          {applied} Check the assumption flags above; ↺ Reset to seeded undoes it per scenario.
        </Mono>
      )}
      <View style={{ height: space.xs }} />
      <Mono size="xs" color={colors.textFaint}>
        An AI&apos;s numbers are a starting point, not research: they can be confidently wrong.
      </Mono>
    </Card>
  );
}

const styles = StyleSheet.create({
  buttons: { flexDirection: 'row', gap: space.sm, marginTop: space.sm, marginBottom: space.xs },
  btn: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.chipBg,
    borderRadius: 6,
    paddingHorizontal: space.md,
    paddingVertical: 8,
    marginTop: 4,
  },
  primary: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  box: {
    marginTop: 4,
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 4,
    color: colors.text,
    fontFamily: type.mono,
    fontSize: type.size.xs,
    padding: space.sm,
    textAlignVertical: 'top',
  },
});
