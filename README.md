# Deep Value Hunter

Mobile-first stock analysis app that replicates, exactly, the valuation
model in `Latest_Deep_Value_Hunter_Model.xlsx` (a Google Sheets template
built on GOOGLEFINANCE + the DVH add-on). US-listed stocks at launch;
symbol/FX architecture ready for other markets later.

> **Disclaimer:** Deep Value Hunter provides information and modelling
> tools only — not investment advice or recommendations. See the in-app
> disclaimer (Settings).

## Layout

```
packages/engine   pure TS valuation engine (no React, no network) + META fixture + gate tests
packages/data     provider abstraction: FMP adapter, SEC EDGAR fallback, FX, snapshot assembly
apps/api          Cloudflare Worker proxy (holds the FMP key, caches responses)
apps/mobile       Expo app (expo-router, zustand, React Query, react-native-svg)
scripts/          fixture extraction from the xlsx (openpyxl)
DECISIONS.md      every judgement call, incl. replicated sheet quirks
```

## The META validation gate

The `META` sheet ships in Static mode with a snapshot dated 2026-07-10;
that snapshot is the fixture. The engine must reproduce **every** derived
number in the sheet — headline metrics, all per-year derived columns,
summary stats, seeded forecasts, terminal values, fair values, IRRs, the
IRR-at-price strip and margin-of-safety targets — at 1e-9 relative
tolerance (1e-6 for IRR). Do not ship if this fails.

```bash
npm install
npm test          # 86 gate assertions (engine) + data-layer tests
npm run typecheck
```

Regenerate fixtures after any change to the workbook (never edit JSON by
hand):

```bash
pip install openpyxl
npm run extract-fixture
```

Live parity (soft gate; needs network + key): pulls META live and asserts
each fundamental within 3% of the fixture, logging a field-by-field diff.
The same diff is visible in-app under Settings → Developer mode.

```bash
DVH_FMP_BASE_URL=https://financialmodelingprep.com DVH_FMP_API_KEY=... \
  npx vitest run -w packages/data live-parity
```

## Data

Provider: **Financial Modeling Prep** (verified cheapest full-coverage
option; see DECISIONS.md §16). Get a key at financialmodelingprep.com —
the Starter tier suffices. Free fallback: SEC EDGAR XBRL company facts.
**Nothing here signs you up or spends money; keys and accounts are yours
to create.**

**EDGAR-first mode** (license-clean backbone): set `DATA_SOURCE=edgar-first`
on the Worker and /bundle assembles statements from public-domain SEC XBRL
(19+ years for US filers), using FMP only for prices/quotes; per-year market
cap = shares × close at the fiscal year end, EV = cap + net debt. No app
update needed to switch.

Deploy the proxy so the key never ships in the app:

```bash
cd apps/api
npx wrangler kv namespace create CACHE   # put the id in wrangler.toml
npx wrangler secret put FMP_API_KEY
npx wrangler deploy                       # note the workers.dev URL
```

Then set that URL as `extra.proxyBaseUrl` in `apps/mobile/app.json` (or at
runtime in the app's Settings).

For development without a deployed proxy, paste an FMP key into Settings →
"FMP API key (dev only)" and the app talks to FMP directly. Note the free
tier caps annual history at 5 years (the adapter degrades gracefully);
the full 2007+ table the model wants needs FMP's Starter plan. Never
commit keys to the repo.

## Mobile app

```bash
cd apps/mobile
npx expo start          # Expo Go / simulator
```

First run opens META pre-loaded from the bundled 2026-07-10 snapshot with
a banner offering a live refresh. Four screens + settings: Watchlist,
Company (summary card, ownership strip, price chart, scrollable historical
table with sparklines), Valuation (scenario editor, fair value/IRR,
IRR-at-price strip, margin of safety, verdict), Checklist.

Note the "Capex treatment" setting: the default replicates the sheet
(`Adj FCF = OCF + |capex| − SBC`, because capex is stored negative). See
DECISIONS.md §1 before changing it.

## App Store

You need an Apple Developer account (**$99/yr**). Release path: EAS Build
→ TestFlight → App Store review. Signing is left to you — nothing in this
repo fabricates credentials.

```bash
cd apps/mobile
npm i -g eas-cli
eas login && eas build:configure
eas build --platform ios --profile production
eas submit --platform ios
```

Included for review readiness: privacy manifest (`app.json`
`ios.privacyManifests`), no tracking, encryption-exempt flag, in-app
disclaimer (Apple reviews financial apps against this), placeholder icon
and splash (replace `apps/mobile/assets/*.png` with branded art before
submission).
