#!/usr/bin/env node
/**
 * Packages the real web app as ONE self-contained page for the Claude
 * app's artifact viewer, so it opens on an iPhone inside Claude.
 *
 * The viewer runs pages in a locked-down frame, which shapes every step:
 *  - only the page itself is guaranteed to load, so the JS bundle and its
 *    few icons are inlined (icons as data: URIs);
 *  - the page is served from an unknown path, so the app is exported
 *    with no base URL and boots at "/" (unknown paths redirect home);
 *  - network calls are blocked, so the whole universe (S&P 500 +
 *    Nasdaq-100, built from SEC EDGAR + Yahoo by scripts/build-dataset.ts)
 *    is baked in, compactly encoded, as window.__DVH_PRELOAD__, the
 *    names it couldn't build as window.__DVH_UNAVAILABLE__, and the app
 *    runs as host "claude-artifact";
 *  - alert()/confirm() never show, which the app's in-app dialogs handle.
 *
 * Usage (from the repo root):
 *   node scripts/build-artifact.mjs             # reuse .artifact/universe-snapshots.json
 *   DVH_SEC_CACHE=<dir> node scripts/build-artifact.mjs --dataset   # rebuild it first
 * Output: .artifact/deep-value-hunter.html (gitignored, like the dataset:
 * it carries Yahoo prices, which are not ours to redistribute).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, '.artifact');
const webDir = path.join(outDir, 'web');
const datasetPath = path.join(outDir, 'universe-snapshots.json');
const reportPath = path.join(outDir, 'dataset-report.json');
const outFile = path.join(outDir, 'deep-value-hunter.html');
mkdirSync(outDir, { recursive: true });

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts });

// 1. Optional: rebuild the universe dataset from SEC EDGAR + Yahoo.
if (process.argv.includes('--dataset')) {
  const bundled = path.join(outDir, 'build-dataset.mjs');
  run('npx', [
    'esbuild', 'scripts/build-dataset.ts', '--bundle', '--platform=node',
    '--format=esm', '--log-level=warning', `--outfile=${bundled}`,
  ]);
  run('node', [bundled, datasetPath]);
}
if (!existsSync(datasetPath)) {
  throw new Error(`no ${path.relative(root, datasetPath)}: run with --dataset first`);
}

// 2. Export the web app with no base path.
run('npx', ['expo', 'export', '--platform', 'web', '--output-dir', webDir, '--clear'], {
  cwd: path.join(root, 'apps/mobile'),
  env: { ...process.env, DVH_WEB_BASE_URL: '' },
});

// 3. Inline the bundle, with its image assets as data: URIs.
const indexHtml = readFileSync(path.join(webDir, 'index.html'), 'utf8');
const src = indexHtml.match(/<script src="\/?([^"]+\.js)"/)?.[1];
if (!src) throw new Error('no entry script in the exported index.html');
let js = readFileSync(path.join(webDir, src), 'utf8');

let inlined = 0;
js = js.replace(/uri:"\/(assets\/[^"]+\.png)"/g, (whole, rel) => {
  const file = path.join(webDir, rel);
  if (!existsSync(file)) return whole;
  inlined++;
  return `uri:"data:image/png;base64,${readFileSync(file).toString('base64')}"`;
});
const leftover = js.match(/"\/assets\/[^"]+"/g) ?? [];
if (leftover.length) console.warn(`warning: ${leftover.length} asset paths not inlined`, leftover);

// Inline <script> content must never contain "</script" or "<!--":
// \x3C is "<" in strings, templates and regexes alike.
js = js.replace(/<\/script/gi, '\\x3C/script').replace(/<!--/g, '\\x3C!--');

// 4. Bundled snapshots, compactly encoded (decoded by apps/mobile/src/
// library.ts): each snapshot's rows become arrays keyed by one shared
// key list and its prices [date, close] pairs, 2 years of them (the
// chart's window; momentum needs 1). JSON is valid JS; "<" is escaped
// for the same reason as above.
const PRICE_WEEKS = 104;
const snapshots = JSON.parse(readFileSync(datasetPath, 'utf8'));
const rowKeys = [...new Set(snapshots.flatMap((s) => s.rows.flatMap((r) => Object.keys(r))))];
// Only optional fields are ever missing (enterpriseValue on the TTM row,
// priorTtmRevenue on FY rows), and the engine reads missing and null
// alike there, so a gap is encoded as null; trailing gaps are dropped.
const OPTIONAL = new Set(['enterpriseValue', 'priorTtmRevenue', 'depreciationAmortization']);
const encodeRow = (r) => {
  const vals = rowKeys.map((k) => {
    if (r[k] !== undefined) return r[k];
    if (!OPTIONAL.has(k)) throw new Error(`row ${r.yearLabel} lacks required ${k}`);
    return null;
  });
  while (vals.length && vals.at(-1) === null && r[rowKeys[vals.length - 1]] === undefined) vals.pop();
  return vals;
};
const items = snapshots.map(({ rows, priceHistory, ...rest }) => ({
  ...rest,
  r: rows.map(encodeRow),
  p: priceHistory.slice(-PRICE_WEEKS).map((pt) => [pt.date, Math.round(pt.close * 1e4) / 1e4]),
}));
const preloadJs = JSON.stringify({ v: 2, rowKeys, items }).replace(/</g, '\\u003c');

// Universe members the dataset couldn't build, with the reason (minus
// the "TICKER: " prefix the provider's errors carry).
const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : [];
const unavailable = Object.fromEntries(
  report
    .filter((r) => r.status === 'error')
    .map((r) => {
      const why = r.error.replace(/^[A-Z.\-]+: /, '');
      return [r.ticker, `${why[0].toUpperCase()}${why.slice(1)}, so it can't be modelled from the free source yet.`];
    }),
);
const unavailableJs = JSON.stringify(unavailable).replace(/</g, '\\u003c');

// 5. Compose the page. The viewer wraps it in its own document skeleton
// (doctype, head with charset + viewport, body), so this is content only.
const page = `<title>Deep Value Hunter</title>
<style>
  /* Dark-only by design: the app has a single terminal-style palette. */
  :root { color-scheme: dark; --bg: #0B0F14; --fg: #D7E1EA; --dim: #54636F; }
  html { height: 100%; box-sizing: border-box; background: var(--bg); }
  body {
    height: 100%; margin: 0; overflow: hidden;
    background: var(--bg); color: var(--fg);
    overscroll-behavior: none;
    -webkit-tap-highlight-color: transparent;
    -webkit-text-size-adjust: 100%;
    /* app-like touch: long-press opens the row menu, not text selection */
    -webkit-touch-callout: none; -webkit-user-select: none; user-select: none;
  }
  input, textarea { -webkit-user-select: text; user-select: text; }
  #root { display: flex; height: 100%; flex: 1; }
  #dvh-boot {
    margin: auto; font: 12px/1.6 Menlo, ui-monospace, monospace;
    color: var(--dim); letter-spacing: 0.12em; text-transform: uppercase;
  }
</style>
<div id="root"><div id="dvh-boot">Deep Value Hunter · loading</div></div>
<script>
  window.__DVH_HOST__ = 'claude-artifact';
  window.__DVH_PRELOAD__ = ${preloadJs};
  window.__DVH_UNAVAILABLE__ = ${unavailableJs};
  (function () {
    // iOS zooms the page into any focused input under 16px (the forecast
    // cells are smaller); capping the scale stops that, pinch still works.
    var vp = document.querySelector('meta[name="viewport"]');
    if (vp && !/maximum-scale/.test(vp.content)) vp.content += ', maximum-scale=1';
    // If the frame refuses URL changes, keep navigating in memory.
    ['pushState', 'replaceState'].forEach(function (k) {
      var orig = history[k].bind(history);
      history[k] = function (state, title, url) {
        try { return orig(state, title, url); } catch (e) { try { return orig(state, title); } catch (e2) {} }
      };
    });
    // Boot at the app root, or at a tab named in the link's #anchor.
    var tabs = { watchlist: '/', company: '/company', valuation: '/valuation', checklist: '/checklist', inspiration: '/inspiration' };
    var target = tabs[location.hash.slice(1)] || '/';
    if (location.pathname !== target) history.replaceState(null, '', target);
  })();
</script>
<script>
${js}
</script>
`;
writeFileSync(outFile, page);
const mb = (Buffer.byteLength(page) / 1e6).toFixed(2);
console.log(
  `\nwrote ${path.relative(root, outFile)} · ${mb} MB · ${items.length} bundled snapshots · ` +
    `${Object.keys(unavailable).length} unavailable · ${inlined} icons inlined`,
);
