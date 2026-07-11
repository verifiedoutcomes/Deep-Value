/** Settings: capex treatment, snapshot pinning, proxy URL, dev tools. */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { Link } from 'expo-router';
import { useAppStore, activeSnapshot } from '../src/store';
import { colors, space, type } from '../src/theme';
import { Banner, Card, Chip, Mono, SectionTitle } from '../src/components/ui';
import { toggleHaptic } from '../src/haptics';

export default function SettingsScreen() {
  const capexTreatment = useAppStore((s) => s.capexTreatment);
  const setCapexTreatment = useAppStore((s) => s.setCapexTreatment);
  const devMode = useAppStore((s) => s.devMode);
  const setDevMode = useAppStore((s) => s.setDevMode);
  const proxyBaseUrl = useAppStore((s) => s.proxyBaseUrl);
  const devFmpApiKey = useAppStore((s) => s.devFmpApiKey);
  const setProxyBaseUrl = useAppStore((s) => s.setProxyBaseUrl);
  const setDevFmpApiKey = useAppStore((s) => s.setDevFmpApiKey);
  const [proxyError, setProxyError] = React.useState<string | null>(null);
  const [showDisclaimer, setShowDisclaimer] = React.useState(false);
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
              onPress={() => {
                toggleHaptic();
                pinSnapshot(ticker, pinned ? undefined : s.snapshotDate);
              }}
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
          keyboardType="url"
          defaultValue={proxyBaseUrl}
          onEndEditing={(e) => setProxyError(setProxyBaseUrl(e.nativeEvent.text))}
        />
        {proxyError && (
          <Mono size="xs" color={colors.red}>
            {proxyError}
          </Mono>
        )}
        <Mono size="xs" color={colors.textFaint}>
          All provider calls route through the serverless proxy (apps/api); no API key is stored
          in this app. https only.
        </Mono>
        <View style={{ height: space.sm }} />
        <SectionTitle>FMP API key (dev only)</SectionTitle>
        <TextInput
          style={styles.input}
          placeholder={devFmpApiKey ? maskKey(devFmpApiKey) : 'used directly against FMP when no proxy is set'}
          placeholderTextColor={devFmpApiKey ? colors.textDim : colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          onEndEditing={(e) => {
            const text = e.nativeEvent.text;
            if (text.trim()) void setDevFmpApiKey(text);
          }}
        />
        {Boolean(devFmpApiKey) && (
          <Pressable onPress={() => void setDevFmpApiKey('')}>
            <Mono size="xs" color={colors.red}>
              remove key from Keychain
            </Mono>
          </Pressable>
        )}
        <Mono size="xs" color={colors.textFaint}>
          Stored in the iOS Keychain (this device only), never in the app database. Free tier
          covers ~5 years of history; the model's 2007+ table needs the Starter plan. Ship
          production builds with the proxy instead.
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

      <Card>
        <Pressable
          onPress={() => setShowDisclaimer((v) => !v)}
          accessibilityRole="button"
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <SectionTitle>Legal · full investment disclaimer</SectionTitle>
          <Mono size="sm" color={colors.textFaint}>{showDisclaimer ? '▾' : '▸'}</Mono>
        </Pressable>
        {showDisclaimer && (
          <Mono size="xs" color={colors.textDim}>
            {FULL_DISCLAIMER}
          </Mono>
        )}
      </Card>
    </ScrollView>
  );
}

const FULL_DISCLAIMER = `1. NO INVESTMENT ADVICE. Deep Value Hunter ("the App") is an educational and analytical tool. All content, calculations, valuations, fair-value estimates, IRRs, target buy prices, verdicts, checklists and any other output are provided for informational purposes only and do not constitute investment advice, a research report, a recommendation, or an offer or solicitation to buy or sell any security or other financial instrument.

2. NO ADVISORY RELATIONSHIP. Use of the App does not create a fiduciary, advisory, brokerage or other professional relationship. The App's operators are not registered investment advisers, broker-dealers or financial planners. Consult a qualified, licensed professional before making any investment decision.

3. MODEL OUTPUTS ARE HYPOTHETICAL. Fair values, IRRs and forecasts are the mechanical output of a model driven by assumptions you control (growth rates, margins, exit multiples, discount rates). They are forward-looking, hypothetical and highly sensitive to those assumptions. They are not predictions and there is no assurance any security will trade at any modelled value. Note that the App's default "Adjusted FCF" convention ADDS BACK capital expenditure (replicating the source spreadsheet); this materially increases computed cash flow versus conventional free-cash-flow definitions.

4. DATA ACCURACY. Market and fundamental data come from third-party providers and public filings. Data may be delayed, incomplete, misstated, restated or wrong, and snapshots you pin become stale by design. Nothing in the App should be relied on without independent verification from primary sources.

5. RISK OF LOSS. Investing in securities involves substantial risk, including possible loss of the entire principal. Past performance, historical growth rates and historical margins do not guarantee future results. Concentrated positions, small-capitalisation stocks and companies with negative earnings carry elevated risk.

6. NO GUARANTEE OF PERFORMANCE OR AVAILABILITY. The App and its data feeds are provided "as is" and "as available", without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose and non-infringement. Calculations may contain errors despite validation against the source model.

7. LIMITATION OF LIABILITY. To the maximum extent permitted by law, the App's creators, operators and data providers shall not be liable for any direct, indirect, incidental, consequential, special or exemplary damages — including trading losses and lost profits — arising from use of, or reliance on, the App or its output, even if advised of the possibility of such damages.

8. YOUR RESPONSIBILITY. You are solely responsible for your investment decisions, for evaluating the merits and risks of any security, and for compliance with the laws, regulations and tax rules of your jurisdiction. The App is not directed at any jurisdiction where its use would be contrary to law.

9. NO TAX, LEGAL OR ACCOUNTING ADVICE. Nothing in the App constitutes tax, legal or accounting advice.

10. THIRD-PARTY CONTENT. References to data providers, exchanges or companies are for identification only and do not imply endorsement, affiliation or sponsorship.

By using the App you acknowledge that you have read, understood and agreed to this disclaimer in full.`;

function maskKey(key: string): string {
  return key.length <= 5 ? '•••••' : `${'•'.repeat(8)}${key.slice(-5)} (saved)`;
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
