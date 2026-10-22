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
 *  - network calls are blocked, so fresh snapshots are baked in as
 *    window.__DVH_PRELOAD__ and the app runs as host "claude-artifact";
 *  - alert()/confirm() never show, which the app's in-app dialogs handle.
 *
 * Usage (from the repo root):
 *   node scripts/build-artifact.mjs            # reuse .artifact/preload.json if present
 *   DVH_FMP_API_KEY=… node scripts/build-artifact.mjs --fetch   # refresh it first
 * Output: .artifact/deep-value-hunter.html (gitignored).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, '.artifact');
const webDir = path.join(outDir, 'web');
const preloadPath = path.join(outDir, 'preload.json');
const outFile = path.join(outDir, 'deep-value-hunter.html');
mkdirSync(outDir, { recursive: true });

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts });

// 1. Optional: refresh the bundled snapshots from FMP.
if (process.argv.includes('--fetch')) {
  const bundled = path.join(outDir, 'fetch-preload.mjs');
  run('npx', [
    'esbuild', 'scripts/fetch-preload.ts', '--bundle', '--platform=node',
    '--format=esm', '--log-level=warning', `--outfile=${bundled}`,
  ]);
  run('node', [bundled, preloadPath]);
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

// 4. Bundled snapshots (JSON is valid JS; escape "<" for the same reason).
const preload = existsSync(preloadPath) ? JSON.parse(readFileSync(preloadPath, 'utf8')) : [];
const preloadJs = JSON.stringify(preload).replace(/</g, '\\u003c');

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
  `\nwrote ${path.relative(root, outFile)} · ${mb} MB · ${preload.length} bundled snapshots · ${inlined} icons inlined`,
);
