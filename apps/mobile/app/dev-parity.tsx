/**
 * Hidden developer screen: pulls META live and shows the field-by-field
 * diff against the bundled 2026-07-10 fixture, so data-source drift is
 * visible outside CI.
 */
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useMetaParity } from '../src/data';
import { colors, space } from '../src/theme';
import { Banner, Mono } from '../src/components/ui';
import { useAppStore } from '../src/store';

export default function DevParityScreen() {
  const devMode = useAppStore((s) => s.devMode);
  const parity = useMetaParity(devMode);

  if (parity.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: space.lg }}>
        <Mono color={colors.textDim}>pulling META live…</Mono>
      </View>
    );
  }
  if (parity.isError || !parity.data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: space.lg }}>
        <Banner tone="warn">
          Parity pull failed: {String(parity.error ?? 'no data')}. Configure the proxy URL in
          Settings.
        </Banner>
      </View>
    );
  }

  const report = parity.data;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.md }}>
      <Banner tone={report.failures.length ? 'warn' : 'info'}>
        {report.failures.length} of {report.diffs.length} fields outside tolerance · fixture{' '}
        {report.fixtureDate} vs live {report.liveDate}
      </Banner>
      {report.diffs.map((d) => (
        <View
          key={d.path}
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            paddingVertical: 3,
            borderBottomColor: colors.border,
            borderBottomWidth: 0.5,
          }}
        >
          <Mono size="xs" color={d.withinTolerance ? colors.textDim : colors.red}>
            {d.path}
          </Mono>
          <Mono size="xs" color={d.withinTolerance ? colors.textFaint : colors.red}>
            {d.relDiff == null ? '–' : `${(d.relDiff * 100).toFixed(2)}%`}
          </Mono>
        </View>
      ))}
    </ScrollView>
  );
}
