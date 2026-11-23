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
packages/data     provider abstraction: free SEC EDGAR + Yahoo source, FMP adapter, FX,
                  snapshot assembly, the S&P 500 + Nasdaq-100 universe
apps/api          Cloudflare Worker proxy (holds the FMP key, caches responses)
apps/mobile       Expo SDK 54 app (RN 0.81 / React 19, expo-router v6, zustand, React Query, react-native-svg)
scripts/          fixture extraction from the xlsx (openpyxl); universe, dataset and
                  Claude-artifact builders
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

**Free source (the default on iPhone; no key, no account).** Every
S&P 500 and Nasdaq-100 company is searchable in the app (518 tickers,
`packages/data/src/universe.json`). A live pull assembles the snapshot
on the phone:

- **Financial statements:** SEC EDGAR XBRL company facts
  (`data.sec.gov`, public domain), 2007 onwards. TTM = latest 10-K + this
  year's 10-Q year-to-date − the same period a year earlier.
- **Prices, splits, market cap:** Yahoo Finance's public chart endpoint.
  Market cap = SEC share count (restated through later splits) × price.
  Yahoo's data is for personal, non-commercial use; a paid release
  should switch prices to a licensed feed.
- **Index membership:** Wikipedia's current constituent tables, mapped
  to SEC CIKs by `scripts/build_universe.py` (re-run it when the indexes
  change; it checks counts and CIKs against SEC's own ticker file).

Coverage and limits (DECISIONS.md §59): 506 of 518 build. Seven foreign
issuers file 20-F/40-F rather than 10-K (ARM, ASML, CCEP, FER, NBIS, PDD,
TRI); three have no 10-K yet (HONA, SPCX, VYLR); and APA and LHX report
their latest revenue only in company-specific tags. Search shows each of
these with its reason. Anything the standard tags can't give is
approximated and flagged on the Company tab. Ownership, short interest
and ROIC aren't in public filings, so they show as –. Set
`expo.extra.secContact` in `apps/mobile/app.json` (e.g. `"contact:
you@example.com"`) before release: SEC asks every client to identify
itself, and the placeholder is not a real address. Browsers can't call SEC or Yahoo
(no CORS), so the web build still needs the proxy or a dev key.

**Financial Modeling Prep** (optional, via the proxy): the verified
cheapest full-coverage paid option (DECISIONS.md §16). Get a key at
financialmodelingprep.com; the Starter tier suffices.
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

Adjusted FCF is `OCF − |capex| − SBC` everywhere in the app. The original
sheet's `K = H − I − J` added capex back, because capex is stored negative;
that sign error is corrected (DECISIONS.md §57). The ⓘ beside the Adj FCF
note also offers owner earnings (`OCF − D&A − SBC`).

## Web demo (GitHub Pages)

The real app also runs in a browser via react-native-web, so anyone can
try it without Expo Go or a Mac:

- **Live app:** https://verifiedoutcomes.github.io/Deep-Value/

`.github/workflows/pages.yml` exports the web bundle and deploys it on
every push to `main`. One-time setup by a repo admin: **Settings → Pages →
Source: "GitHub Actions"**, then re-run the workflow once from the Actions
tab. The demo ships the bundled META snapshot; live refresh (the ↻ button
in the Company banner) needs a proxy URL or dev key exactly like the phone
app, and state persists in the browser's localStorage.

Local web build: `cd apps/mobile && npx expo export --platform web` (or
`npx expo start --web` for a dev server).

## In the Claude app (iPhone)

The same app also runs as a private Claude artifact, so it opens on a phone
inside the Claude app: https://claude.ai/artifact/8u8StfF7JT2zwXk8w5zbWy

The artifact viewer is locked down (no network, no `alert`/`confirm`,
unknown serving path), so `scripts/build-artifact.mjs` packages a special
build: one self-contained page with the bundle and icons inlined, no base
path, in-app dialogs, and the whole universe baked in: 506 snapshots from
the free source, compactly encoded, about 4.4 MB. Live refresh is off in
that build; everything else (search, editing, ⓘ cards, saved analyses,
checklist) works and persists per device.

```bash
# from the repo root; --dataset rebuilds every snapshot from SEC + Yahoo
# (~2 GB of SEC filings on the first run; DVH_SEC_CACHE keeps them)
DVH_SEC_CACHE=~/.cache/dvh-edgar node scripts/build-artifact.mjs --dataset
# → .artifact/deep-value-hunter.html, then publish it to the artifact
```

`DVH_ONLY=AAPL,MSFT` limits a dataset run to some tickers, and
`.artifact/dataset-report.json` lists each ticker's result and data notes.
The dataset and page stay in `.artifact/` (gitignored) because they carry
Yahoo prices; keep the artifact private.

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
