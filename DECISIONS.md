# DECISIONS

Running log of every judgement call, so a human can audit them. Cell
references are to the `META` sheet of `Latest_Deep_Value_Hunter_Model.xlsx`
(the executable specification). Where the build prompt and the file
disagreed, **the file won**; those cases are called out explicitly.

## Model semantics

1. **Capex sign convention (kept, not fixed).** The data layer delivers
   capex as a negative number (I34:I53) and Adjusted FCF is `K = H − I − J`,
   i.e. OCF **plus** |capex| minus SBC. META TTM Adj FCF = 165,064,000,000
   and every valuation number downstream depends on it. The engine
   replicates this exactly as the default. A Settings toggle ("Capex
   treatment") offers the conventional `OCF − |capex| − SBC`, and the UI
   shows a one-line note while the sheet default is active. The
   conventional option is deliberately NOT the default.

2. **IRR implementation.** Newton–Raphson from Excel's default guess 0.1
   (50 iterations, convergence 1e-12 on the step), falling back to a
   sign-change scan + bisection over (−1, 10]. No root → `null`, rendered
   as a dash / `#NUM!` exactly where the sheet errs. Validated to 1e-6
   against all 11 cached IRRs (two scenario IRRs + nine strip cells).

3. **3-year terminal PV uses nper = 5 (sheet quirk, replicated).** N92 =
   `sum(J88:J90) + PV(N91, 5, 0, −N90)` — the 3-year block still discounts
   its terminal market cap five periods. Flagged in a code comment in
   `packages/engine/src/scenario.ts`; required for fixture parity
   (Q88 = 866.3726995).

4. **3-year "No Forecast" can never trigger (sheet quirk, replicated).**
   The no-forecast test is `countif(G..:H..,"=0") = 10`. The 3-year blocks
   compare a 6-cell range against 10, which is never true, so an all-zero
   3-year scenario computes IRR over non-positive flows and yields `#NUM!`
   (see Q94) instead of "No Forecast". Engine models this as status
   `'num-error'` vs `'no-forecast'`.

5. **TTM YoY skips the FY-latest row.** E53 = `D53/D51 − 1` (TTM over the
   *prior completed* fiscal year), not D53/D52. Engine: TTM row compares
   against index n−3.

6. **Two P/Es exist and differ.** E10 = live market cap D9 / X53
   (27.06142081); Q120 = snapshot market cap P53 / X53 (27.52467647). Both
   are surfaced on the Company screen ("P/E (live)" / "P/E (snap)").

7. **All FCF discounting uses the 5-year base rate cell.** Bear/bull 5-year
   rates are formulas pointing at N66, and *all three* 3-year blocks
   discount their FCF PVs at N$66/N$74/N$82 (the 5-year cells) while their
   terminal PV uses N91. The app therefore exposes two rates: a 5-year
   rate (N66) and a 3-year rate (N91, terminal-only), both defaulting to
   0.10, wired exactly as the sheet references them.

8. **3-year exit multiple offsets are inconsistent in the sheet (kept).**
   Base N86 = N61 − 2, bear N94 = N69 − **3**, bull N102 = N77 − 2. The
   engine derives 3-year multiples from the 5-year ones with those
   per-scenario offsets (user-overridable in the app).

9. **IRR-at-price strip is 4 steps down, 4 up.** The prompt said "three
   steps down and four up", but the sheet's chain (L15 = M15−(N15−M15),
   … P15 = round(I6)) resolves to nine equally spaced prices from
   P15 − 4·step to P15 + 4·step with step = round(I6/10). The file wins:
   grid for META is 379…883 by 63, and L16 (IRR at 379) is a headline
   assertion.

10. **Momentum formula direction.** The prompt described T124 as "1-year
    price change minus the 1-month price change"; the sheet formula is
    `(price_1m_ago − price_1y_ago) / price_1y_ago` — the 1-year change
    measured up to one month ago. The file wins;
    `momentumFromHistory()` implements the file's formula from weekly
    closes and the fixture carries the sheet's cached value (−0.2149).

11. **52-week high/low cells are broken in the sheet.** K9/K11 call
    `GOOGLEFINANCE($C$5,"")` and return the company *name*. The app
    computes the 52-week range from the quote / weekly price history
    instead (`fiftyTwoWeekRange()`); not part of the validation gate.

12. **Ownership strip comes from the provider, never scraped.** The sheet
    scrapes Finviz for insider ownership (change), institutional
    ownership and short interest. FMP's Starter plan does not expose those
    as ratios, so they render "–" (unavailable) on live pulls rather than
    being invented; the bundled META fixture still carries the sheet's
    values. The Finviz analyst-ratings table (P111:T116) was likewise not
    replicated. Momentum is computed from price history.

13. **Pre-history years are zero-filled.** Years before a company's data
    begins render as 0 rows (as the sheet does for META 2007–2008), and
    the derived-column error semantics (`IFERROR → blank`) are preserved
    via `null`.

14. **Bear/Bull growth decay applies to the zero seed.** Unedited bear/bull
    scenarios keep the sheet's E-column pattern, so years 4–5 (or 2–3) sit
    at −1%/−2% even though margins are zero. Replicated so N75 =
    −29,819,125,619 matches.

15. **Excel TRIMMEAN semantics.** Drop `floor(n × percent / 2)` values from
    each tail of the sorted window (rows 41:53, 40% ⇒ 2 per tail of 13).
    Excel ROUND (half away from zero) is used for the price grid.

## Data & architecture

16. **Provider: Financial Modeling Prep, verified 2026-07.** Checked
    current pricing/coverage per the prompt: FMP Starter ($15/mo west,
    annual discounts) covers all required fields for US equities with
    30+ years of annual history (statements incl. SBC/capex,
    enterprise-values, key-metrics ROIC, historical market cap, EOD
    prices). EODHD's fundamentals tier is dearer (~$60/mo; the €19.99
    plan is EOD-only), Alpha Vantage ($49.99/mo+) lacks EV/ROIC
    endpoints, Polygon's fundamentals (from $29) carry no EV/ROIC.
    **No key purchased or account created — that's the human's call.**

17. **SEC EDGAR XBRL company-facts as the free fallback** for US
    fundamentals (no market cap/EV/ROIC/ownership there; those degrade to
    null). Ticker→CIK mapping via the SEC's `company_tickers.json`, both
    cached in the proxy. EDGAR requires a User-Agent with contact info —
    currently the repo owner's email in `apps/api/src/worker.ts`; change
    before deploying if desired.

18. **Proxy (apps/api, Cloudflare Workers + KV).** API key lives only in a
    Worker secret; clients can never inject their own key. Closed fiscal
    years are immutable ⇒ statement/EV/metrics/price-history responses
    cache 30 days, quotes 60 s.

19. **Stack.** Expo (managed, EAS) + TypeScript + expo-router; zustand
    (+ persist on expo-sqlite kv-store — works in the managed workflow,
    unlike MMKV which needs a dev build); React Query for live pulls;
    react-native-svg for sparklines/price chart (Victory Native would add
    a Skia dependency for charts this simple). Monorepo via npm
    workspaces; `packages/engine` has zero React/network deps so the META
    gate is provable in isolation.

20. **Snapshot model = the sheet's modes.** Load ⇒ a refresh pull; every
    pull is persisted as a timestamped snapshot (25 kept per ticker);
    pinning a snapshot = Static mode; unpinned = newest pull. The bundled
    META fixture is the first-run snapshot with a banner + refresh offer.

21. **DVH's vendor is FMP (verified live, 2026-07-10).** A live pull with a
    real key reproduced every closed-fiscal-year fundamental 2021–2025 at
    exactly 0.00% deviation (capex −69,691,000,000; OCF 115,800,000,000;
    SBC 20,427,000,000 …). Three mappings were pinned down by this:
    - **Net debt cash definition:** total debt − `cashAndCashEquivalents`
      (NOT incl. short-term investments); FMP's own `netDebt` field equals
      the sheet's M column for all five verifiable years.
    - **ROIC (E15) is the latest ANNUAL key-metrics value** (fixture
      0.1795 = FMP FY2025 `returnOnInvestedCapital` 0.17950279…, not the
      TTM figure 0.1996). Fallback order: latest FY → prior FY → TTM.
    - **Tangible book** = equity − `goodwillAndIntangibleAssets` (matches
      2021–2024 exactly; the sheet's FY2025 value subtracts goodwill only —
      a vendor-side inconsistency left as 1.9% parity drift).

22. **FMP free tier: history capped at 5 years (HTTP 402 above limit=5).**
    The adapter retries at the cap so free keys degrade to five years of
    history instead of failing; the full 2007+ table needs the Starter
    plan. Quote responses carry no share count → derived as
    marketCap / price (exactly the P53/I6 relationship).

23. **Parity report categories.** Closed fiscal years are immutable ⇒
    out-of-tolerance there is a hard failure (3%; 15% for per-year market
    cap/EV and share counts, whose sources differ). TTM and quote fields
    drift legitimately as quarters land after the fixture date ⇒ reported
    as recency drift, not failure. Live-side gaps from the free-tier cap ⇒
    reported as missing. With the free key on 2026-07-10: 0 hard failures.

24. **Dev-only direct key.** Settings accepts an FMP key used straight
    against FMP when no proxy URL is set — development convenience only;
    production builds configure the proxy so no key lives on-device. API
    keys are never committed to the repo.

25. **Proxy hardening (2026-07-11).** The worker forwards ONLY an
    allowlisted set of FMP endpoints, each with a parameter schema
    (symbol/date/limit regexes, limit ≤ 100); anything else is 403/400, so
    the worker cannot be used as an open proxy to burn the key's quota.
    Client-supplied `apikey` params are dropped; the secret never appears
    in cache keys. Per-IP fixed-window rate limit (default 60 req/min,
    `RATE_LIMIT_PER_MIN` var), GET-only, `nosniff`/`no-referrer` headers,
    upstream errors passed through as opaque JSON and never cached.

26. **Key storage on-device (2026-07-11).** The dev-only FMP key lives in
    the iOS Keychain / Android Keystore via expo-secure-store
    (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`), is excluded from the
    SQLite-persisted zustand state via `partialize`, is masked in the UI,
    and can be removed with one tap. Proxy URLs are validated https-only.
    Production remains proxy-only: no key on device at all.

27. **Usability pass (2026-07-11).** Valuation assumptions get ± steppers
    (0.5pp per tap) alongside keyboard entry, plus a one-tap "reset to
    seeded" that drops the per-block overrides; KeyboardAvoidingView so
    inputs aren't hidden by the keyboard; watchlist rows long-press to
    remove (with confirm) and an empty state; the snapshot banner turns
    amber and shows age when a snapshot is >7 days old, and surfaces
    refresh errors; checklist gains a progress bar and switch semantics
    for VoiceOver; haptic feedback (expo-haptics) on toggles, pins,
    steppers and refresh outcomes.

28. **Fixture discipline.** `scripts/extract_fixture.py` extracts both
    inputs and all expected outputs programmatically from cached values
    (openpyxl, two passes). Nothing hand-typed; if the gate fails, fix the
    engine — never the fixture.
