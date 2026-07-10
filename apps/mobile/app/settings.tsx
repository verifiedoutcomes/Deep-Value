/** Settings: capex treatment, snapshot pinning, proxy URL, dev tools. */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { Link } from 'expo-router';
import { useAppStore, activeSnapshot } from '../src/store';
import { colors, space, type } from '../src/theme';
import { Banner, Card, Chip, Mono, SectionTitle } from '../src/components/ui';

export default function SettingsScreen() {
  const capexTreatment = useAppStore((s) => s.capexTreatment);
  const setCapexTreatment = useAppStore((s) => s.setCapexTreatment);
  const devMode = useAppStore((s) => s.devMode);
  const setDevMode = useAppStore((s) => s.setDevMode);
  const proxyBaseUrl = useAppStore((s) => s.proxyBaseUrl);
  const ticker = useAppStore((s) => s.selectedTicker);
  const tickerState = useAppStore((s) => s.tickers[ticker]);
  const pinSnapshot = useAppStore((s) => s.pinSnapshot);
  const active = activeSnapshot(tickerState);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: space.xl }}>
      <Card>
        <SectionTitle>Capex treatment</SectionTitle>
        <View style={{ flexDirection: 'row', marginBottom: space.sm }}>
          <Chip
            label="Sheet: OCF + |capex| − SBC"
            active={capexTreatment === 'sheet'}
            onPress={() => setCapexTreatment('sheet')}
          />
          <Chip
            label="OCF − |capex| − SBC"
            active={capexTreatment === 'conventional'}
            onPress={() => setCapexTreatment('conventional')}
          />
        </View>
        <Mono size="xs" color={colors.textFaint}>
          The sheet stores capex as a negative number and computes Adj FCF as OCF − capex − SBC,
          which ADDS the absolute value of capex back. That is the model this app replicates and
          the default. The conventional alternative subtracts capex. Changing this reprices
          everything downstream.
        </Mono>
      </Card>

      <Card>
        <SectionTitle>Snapshots · {ticker}</SectionTitle>
        {(tickerState?.snapshots ?? []).map((s) => {
          const pinned = tickerState?.pinnedSnapshotDate === s.snapshotDate;
          const isActive = s === active;
          return (
            <Pressable
              key={s.snapshotDate + String(s.quote.price)}
              style={styles.snapRow}
              onPress={() => pinSnapshot(ticker, pinned ? undefined : s.snapshotDate)}
            >
              <Mono size="sm" color={isActive ? colors.accent : colors.text}>
                {s.snapshotDate} · px {s.quote.price.toFixed(2)}
              </Mono>
              <Mono size="xs" color={pinned ? colors.amber : colors.textFaint}>
                {pinned ? 'PINNED' : 'pin'}
              </Mono>
            </Pressable>
          );
        })}
        <Mono size="xs" color={colors.textFaint}>
          Every live refresh persists a timestamped snapshot. Pin one to freeze the analysis
          (the sheet's Static mode); unpin to follow the newest pull.
        </Mono>
      </Card>

      <Card>
        <SectionTitle>Data proxy</SectionTitle>
        <TextInput
          style={styles.input}
          placeholder="https://dvh-proxy.….workers.dev"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          defaultValue={proxyBaseUrl}
          onEndEditing={(e) => useAppStore.setState({ proxyBaseUrl: e.nativeEvent.text.trim() })}
        />
        <Mono size="xs" color={colors.textFaint}>
          All provider calls route through the serverless proxy (apps/api); no API key is stored
          in this app.
        </Mono>
      </Card>

      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <SectionTitle>Developer mode</SectionTitle>
          <Switch value={devMode} onValueChange={setDevMode} thumbColor={colors.accent} />
        </View>
        {devMode && (
          <Link href="/dev-parity" asChild>
            <Pressable>
              <Mono size="sm" color={colors.blue}>→ Live-data parity vs bundled META fixture</Mono>
            </Pressable>
          </Link>
        )}
      </Card>

      <Banner tone="warn">
        Deep Value Hunter provides information and modelling tools only. Nothing in this app is
        investment advice or a recommendation to buy or sell any security. Data may be delayed or
        inaccurate; verify before acting. Investing involves risk, including loss of principal.
      </Banner>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  snapRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
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
    paddingVertical: 8,
    marginBottom: space.sm,
  },
});
