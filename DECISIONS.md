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

28. **Sheet-faithful valuation layout + formula transparency (2026-07-11).**
    The valuation tab now renders the forecast block exactly as sheet rows
    61:67: one row per year with Revenue, Y/Y Δ (editable), Op Income,
    Op Margin (editable), Adj FCF Margin (editable), Adj FCF and PV of
    Adj FCF; terminal EV / terminal market cap / intrinsic-value display
    lines were removed at the owner's request. In their place, every
    computed number carries an ⓘ tag opening a card with the sheet cell
    reference, the formula, and the formula again with live numbers
    substituted (src/formulas.ts + FormulaInfo component) — the model is
    auditable from TTM revenue to fair value without leaving the app.

29. **Full historical table, aligned and grouped (2026-07-11).** All 24
    sheet columns (D..AB incl. the Z/AA/AB income-split waterfall
    components) render in the Company table; headers (title + sparkline)
    share each column's right edge with the numbers below; group chips
    (All / P&L / Cash Flow / Balance & Val / Income Split) split the table
    for phone reading.

30. **Editable checklist (2026-07-11).** Checklist items became per-ticker
    data seeded from the 14 baseline questions: add unlimited questions,
    long-press-remove any item, restore the baseline set. Persisted-state
    schema bumped to v2 with a migration from the boolean[] shape.

31. **Watchlist at scale (2026-07-11).** The search box doubles as a live
    filter over the watchlist; A–Z/added sort toggle; fixed row heights
    with getItemLayout + windowed rendering so thousands of tickers
    scroll flat. Per-row engine runs stay memoised and virtualized, so
    cost tracks visible rows, not list size.

32. **Watchlist subcategories (2026-07-11).** The watchlist is now groups
    of max 50 names each (`MAX_GROUP_SIZE`), with create/delete groups,
    move-between-groups on long-press, per-group counts on the chips, and
    a friendly error when a group is full. Persisted schema v3 migrates
    the old flat list into 50-name chunks.

33. **Metric history charts (2026-07-11).** Tapping any column header in
    the Company table opens a full-width bar chart of that metric across
    all years — tap a bar to read its exact value, 10Y/All period toggle,
    TTM bar highlighted. Functionally inspired by per-metric charting in
    modern research platforms (fiscal.ai et al.); implemented from
    scratch with our own visual language — no assets, layouts or code
    copied.

34. **Dark-mode only, by design.** The app ships a single dark theme
    (`userInterfaceStyle: "dark"`), chosen for the terminal-density
    aesthetic and to halve the design/QA surface pre-launch. A light
    theme can be added later purely in `src/theme.ts`.

35. **Comprehensive legal disclaimer (2026-07-11).** Settings ends with a
    collapsed "Legal · full investment disclaimer" section: ten sections
    covering no-advice, no advisory relationship, hypothetical model
    outputs (explicitly flagging the capex add-back convention), data
    accuracy, risk of loss, no warranty, limitation of liability, user
    responsibility, no tax/legal advice, third-party content. The short
    banner above it remains always visible for App Store review.

36. **Login deliberately deferred.** All state is on-device; nothing
    requires an account yet. When sync/backup or paid tiers arrive, the
    plan is Sign in with Apple + Google + email magic links only (Apple
    requires offering Sign in with Apple whenever third-party logins are
    present — App Review 4.8). The persisted store is already one
    serializable JSON document, so a sync layer bolts on cleanly.

37. **Scaling economics: the /bundle endpoint (2026-07-11).** A company
    open now costs the client exactly ONE request: GET /bundle/:ticker
    returns the fully assembled CompanySnapshot, built server-side and
    cached 15 minutes in KV. Upstream provider calls (~10 per assembly)
    are therefore paid per TICKER per cache window across the whole user
    base, not per user — marginal data cost per additional user ≈ 0.
    End users never see or hold an API key.

38. **Data plan for launch (researched 2026-07-11).** FMP Starter caps
    history at 5 years, so the model's 2007+ table needs FMP Premium
    ($99/mo, ~$69/mo annual; 750 calls/min, 30y history) — trivially
    sufficient behind the bundle cache. HOWEVER: FMP's standard-plan ToS
    prohibits displaying/redistributing data to app end users; a Data
    Display licensing agreement (enterprise, quote required) is needed
    before public sale. License-clean fallback architecture is already in
    the codebase: SEC EDGAR XBRL (public domain) for statements + a
    display-licensed price/quote source, with per-year market cap
    computed as year-end price × shares. EODHD's fundamentals feed
    (€59.99/mo) is the nearest like-for-like vendor alternative but also
    requires its commercial/redistribution tier for app display. Action
    before App Store launch: get FMP's display-license quote and compare
    with the EDGAR-first build-out.

39. **MSFT live validation (2026-07-11).** live-smoke.integration.test.ts
    pulls any ticker (default MSFT) through the real pipeline and asserts
    the ticker-agnostic engine invariants: K = H − I − J, Q53 = P53 + M53,
    seeded base-case forecast/IRR compute, bear/bull "No Forecast", IRR
    strip centred on round(price), 52-week range and momentum from price
    history. MSFT passed with plausible values (P/E 22.8, EV/EBIT 19.8,
    op margin 46.8%, ROIC 21.6%).

40. **Saved analyses (2026-07-11).** "⌸ save analysis" on the Company or
    Valuation tab freezes the complete state behind BOTH tabs — the data
    snapshot, all scenario overrides, capex treatment, horizon and
    scenario tab — plus a digest of headline results. Because the engine
    is pure, replaying those frozen inputs reproduces every original
    number exactly, so a saved analysis is revisited bit-for-bit rather
    than re-rendered from stored screenshots. Review mode is read-only
    (refresh disabled, edits ignored) with an amber banner; the /saved
    list shows then-price vs fair value/IRR digests; saving offers a
    one-tap "Research next ticker →" that lands on the Watchlist with
    the search box focused. Capped at 200 entries, newest first.

41. **Golden-company robustness suite (2026-07-11).** Beyond the META
    exactness gate, `golden-companies.test.ts` runs seven synthetic sector
    archetypes (bank with null capex/gross profit, leveraged REIT, 3-year
    IPO, money-losing biotech, negative-tangible-book staple, pre-revenue
    shell, null-riddled provider data) through the full engine with three
    invariants: never throw; never emit NaN/Infinity anywhere in the
    output tree; degrade only to the sheet's honest states ('No
    Forecast', '#NUM!', 'Neg Book', dashes). Two findings encoded as
    expectations, both correct sheet behaviour: a bank's IRR computes
    from the terminal value alone (op margin non-zero keeps the countif
    gate open over zero FCF years), and a net-cash shell's 3-year block
    finds a real deeply-negative IRR instead of #NUM!.

42. **EDGAR-first path completed (2026-07-11).** `EdgarFirstProvider`
    composes public-domain SEC XBRL statements with a market feed used
    ONLY for prices/quotes: per-year market cap = shares × close nearest
    the fiscal-year-END date (new `fiscalYearEnd` field; MSFT's June FYE
    verified live), EV = market cap + net debt (the model's own P+M
    definition), ROIC left null rather than inventing a definition (Adj
    ROIC Q124 covers it). The worker's /bundle flips backbones with a
    single `DATA_SOURCE=edgar-first` env var — no app update. Live MSFT
    result: 19 fiscal years of statements (2007–2025) vs 6 under the FMP
    free tier, engine clean end-to-end. This is both the licensing
    escape hatch and negotiating leverage on any display-license quote.

43. **Inspiration page + Settings rework (2026-07-12).** An Apple
    Notes-style Inspiration page (serif block quotes with a left rule,
    "— attribution" beneath, add-your-own composer, long-press remove)
    sits at the top of Settings, seeded with the owner's Buffett and
    Munger quotes ("Olym-pic-diving" in the supplied text was a PDF
    line-break artifact, normalised to "Olympic-diving"). The capex
    treatment card moved OUT of Settings into a ⓘ bubble beside the
    Adj FCF note on the Company and Valuation tabs — the toggle now
    lives where the convention is actually used. About and the legal
    disclaimer merged into a single "About · Legal" card with the full
    10-section disclaimer still collapsed beneath it.

44. **Expo SDK 54 upgrade (2026-07-13).** apps/mobile moved from SDK 52
    to 54: React Native 0.81.5, React 19.1.0, expo-router 6, TypeScript
    5.9, New Architecture enabled explicitly. Versions aligned with
    `expo install --fix`; a root `overrides.react = 19.1.0` pins a
    single React across the workspace (npm was hoisting a newer 19.x
    for peer ranges). Zero code changes were needed — the app
    typechecks clean under React 19 and Metro exports a full Hermes
    bundle. expo-doctor's one remaining note is the intentional
    monorepo metro.config.js (watchFolders/nodeModulesPaths per Expo's
    own monorepo guidance).

45. **App mode diverges from the sheet where the owner chose to
    (2026-07-13).** Two engine options, BOTH defaulting to sheet parity
    (the META gate is unchanged), with the app opting in everywhere via
    APP_ANALYZE_OPTIONS:
    - `correct3yTerminal`: the 3-year block discounts its terminal cap
      THREE periods (the sheet's N92 uses five); the quirk note was
      removed from the fair-value formula card accordingly.
    - `seedBearBullFromBase`: unedited Bear/Bull seed from the Base case
      (growth, margins, exit multiple), so all three scenarios are live
      immediately and the user adjusts from Base rather than from zeros.
    Also: price chart now shows a trailing 2 years with the y-domain
    including the 52-week band and labels clamped on-canvas; historical
    table headers enlarged; margin-of-safety card explains
    target = base fair value × (1 − MoS) — the numbers are anchored to
    fair value, not the current price, which is why they can sit far
    above a cheap stock; IRR capitalised throughout; save/saved bar made
    prominent and centred.

46. **Data-spend controls (2026-07-13).** Two layers, because
    client-side limits alone are advisory:
    - CLIENT freshness gate: a refresh within 6 hours of a ticker's last
      live pull never touches the network — the app explains when the
      next update unlocks. Developer mode bypasses.
    - SERVER quota: /bundle enforces N distinct tickers per device per
      UTC day (env `DAILY_TICKER_QUOTA`, default 5 — raisable without an
      app update). Repeat pulls of the same ticker that day are free.
      Device = a Keychain-persisted install id (reinstalls do NOT mint a
      fresh quota); requests without the header fall back to per-IP
      quota, so omitting it is not a bypass. 429 carries a friendly
      message; X-DVH-Quota-Remaining is surfaced in Settings.
    Known residual loopholes (accepted for now, documented): spoofable
    install ids (mitigation when it matters: per-IP layer already
    caps it; later App Attest / receipt-gating), and the /fmp
    passthrough is quota-free but endpoint-allowlisted and per-IP
    rate-limited.

47. **TTM Revenue Y/Y corrected to a true trailing comparison
    (2026-07-13, owner-requested audit).** The sheet's E53 = D53/D51 − 1
    divides TTM revenue by the SECOND-latest FY (2024) — exact right
    after fiscal year-end, drifting to overstate as quarters advance.
    Dividing by the latest FY instead (D52) would be worse: the periods
    overlap by up to three quarters, reading ~0% for a fast grower just
    after year-end. The correct measure is TTM over the PRIOR TTM
    (quarters 5..8 back): the data layer now requests eight quarters and
    supplies `priorTtmRevenue`; the engine uses it when present and
    falls back to the sheet's proxy when not (free-tier keys cap at five
    quarters). The fixture carries no priorTtmRevenue, so the META gate
    is byte-identical. IMPORTANT: this only affects the displayed TTM
    row and the 4-row growth average — the valuation seed always used
    E52 (FY-latest over prior FY, non-overlapping), so fair values and
    IRRs were never contaminated.

48. **Soundest-logic pass (2026-07-13, owner-requested).** Four more
    app-mode flags (sheet-parity defaults untouched; META gate green):
    - `correctedSummaryStats`: CAGRs anchor to the LATEST fiscal year
      (sheet's D54 = D51/D43 quietly excluded the newest year) and the
      averaging/trimmed-mean windows use fiscal years only (the sheet's
      windows included the TTM row, double-counting the latest year).
    - `seedExitFromTrimmedMean`: the seeded exit multiple is the
      40%-trimmed-mean EV/EBIT (S54) — the mean-reversion-consistent
      choice for a deep-value thesis — falling back to the current
      multiple (S53) when unavailable.
    - `seedMarginsFromTtm`: both seeded margins come from the TTM row
      (sheet mixed TTM op margin with FY FCF margin).
    - `symmetric3yOffsets`: every 3-year exit multiple = 5-year − 2
      (sheet had bear −3, base/bull −2 for no stated reason).
    Display: the "5-Yr Price Change" (Q66) was PROVEN algebraically
    redundant — it reduces exactly to (1+IRR)^h − 1 — so the app shows
    horizon MOIC ((Σ FCF + terminal cap) ÷ outlay, undiscounted) as the
    IRR's companion metric instead; the parity field remains in the
    engine, with the identity pinned by a test.

49. **Fixture discipline.** `scripts/extract_fixture.py` extracts both
    inputs and all expected outputs programmatically from cached values
    (openpyxl, two passes). Nothing hand-typed; if the gate fails, fix the
    engine — never the fixture.
