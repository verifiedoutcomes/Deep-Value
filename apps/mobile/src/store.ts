/**
 * App state (zustand) + persistence (expo-sqlite kv-store).
 *
 * Per ticker the app persists: every pulled snapshot (timestamped, so a
 * frozen state can be pinned -- the sheet's Static mode), scenario
 * overrides, checklist answers. Global settings: capex treatment, pinned
 * snapshot per ticker.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import Storage from 'expo-sqlite/kv-store';
import * as SecureStore from 'expo-secure-store';
import type {
  CompanySnapshot,
  ScenarioOverrides,
} from '@dvh/engine';
import type { CapexTreatment, HorizonYears, ScenarioKind } from '@dvh/engine';
import { CHECKLIST_QUESTIONS, analyzeCompany } from '@dvh/engine';
import metaFixture from '@dvh/engine/fixtures/meta-2026-07-10.json';

export const BUNDLED_META = metaFixture as unknown as CompanySnapshot;

export interface ChecklistItem {
  question: string;
  answer: boolean;
}

/** A watchlist subcategory. Hard cap keeps lists scannable and fast. */
export interface WatchlistGroup {
  name: string;
  tickers: string[];
}

export const MAX_GROUP_SIZE = 50;

/**
 * A saved analysis: the complete, frozen state behind the Company AND
 * Valuation tabs at one moment. The engine is pure, so persisting
 * {data snapshot, scenario overrides, capex treatment} reproduces every
 * derived number exactly when revisited later — plus a digest of the
 * headline results captured at save time for the list view.
 */
export interface SavedAnalysis {
  id: string;
  ticker: string;
  name: string;
  savedAt: string; // ISO datetime
  snapshot: CompanySnapshot;
  overrides: ScenarioOverrides;
  capexTreatment: CapexTreatment;
  horizon: HorizonYears;
  scenarioTab: ScenarioKind;
  digest: {
    price: number;
    peLive: number | null;
    evEbit: number | null;
    fcfYield: number | null;
    fairValue5: number | null;
    irr5: number | null;
    priceDelta5: number | null;
  };
}

export const MAX_SAVED_ANALYSES = 200;

/** An Inspiration-page quote (Apple Notes-style block quote). */
export interface Quote {
  text: string;
  attribution: string;
}

const SEED_QUOTES: Quote[] = [
  {
    text:
      "Investors should remember that their scorecard is not computed using Olympic-diving methods: Degree-of-difficulty doesn't count. If you are right about a business whose value is largely dependent on a single key factor that is both easy to understand and enduring, the payoff is the same as if you had correctly analyzed an investment alternative characterized by many constantly shifting and complex variables.",
    attribution: 'Warren Buffett',
  },
  {
    text: 'The big money is not in the buying and selling, but in the waiting.',
    attribution: 'Charlie Munger',
  },
];

export interface TickerState {
  /** newest first; index 0 is the live view unless a pin is set */
  snapshots: CompanySnapshot[];
  pinnedSnapshotDate?: string;
  overrides: ScenarioOverrides;
  /** Seeded from the sheet's 14 questions; fully user-editable. */
  checklist: ChecklistItem[];
  horizon: 3 | 5;
  scenarioTab: 'bear' | 'base' | 'bull';
}

interface AppState {
  /** Subcategories, each capped at MAX_GROUP_SIZE names. */
  watchlistGroups: WatchlistGroup[];
  activeGroup: string;
  tickers: Record<string, TickerState>;
  selectedTicker: string;
  capexTreatment: CapexTreatment;
  proxyBaseUrl: string;
  /**
   * Dev convenience only: talks to FMP directly when no proxy is set.
   * SECURITY: held in memory here but persisted ONLY to the iOS
   * Keychain / Android Keystore via expo-secure-store -- `partialize`
   * below excludes it from the SQLite-persisted JSON. Production builds
   * should always use the proxy (key server-side).
   */
  devFmpApiKey: string;
  devMode: boolean;
  /**
   * Anonymous install id sent with proxy requests so the server can
   * enforce the daily ticker quota. Persisted in the Keychain so a
   * reinstall does NOT mint a fresh quota.
   */
  installId: string;
  /** Last successful live pull per ticker (ms epoch) — freshness gate. */
  lastFetchAt: Record<string, number>;
  markFetched: (ticker: string) => void;
  /** Server-reported quota remaining today (null until first pull). */
  quotaRemaining: number | null;
  setQuotaRemaining: (n: number | null) => void;
  /** Inspiration-page quotes, user-editable, seeded with two classics. */
  quotes: Quote[];
  addQuote: (text: string, attribution: string) => void;
  removeQuote: (idx: number) => void;
  /** Frozen analyses (Company + Valuation state), newest first. */
  savedAnalyses: SavedAnalysis[];
  /** When set, Company/Valuation render this frozen state read-only. */
  reviewingId: string | null;
  setProxyBaseUrl: (url: string) => string | null;
  setDevFmpApiKey: (key: string) => Promise<void>;
  /** Freeze the current ticker's full analysis. Returns the new id, or an error string. */
  saveAnalysis: () => { id: string } | { error: string };
  deleteAnalysis: (id: string) => void;
  startReview: (id: string) => void;
  exitReview: () => void;
  // actions
  selectTicker: (t: string) => void;
  addSnapshot: (t: string, snap: CompanySnapshot) => void;
  pinSnapshot: (t: string, date?: string) => void;
  setOverrides: (t: string, o: ScenarioOverrides) => void;
  setChecklist: (t: string, idx: number, value: boolean) => void;
  addChecklistItem: (t: string, question: string) => void;
  removeChecklistItem: (t: string, idx: number) => void;
  restoreChecklistBaseline: (t: string) => void;
  setHorizon: (t: string, h: 3 | 5) => void;
  setScenarioTab: (t: string, tab: 'bear' | 'base' | 'bull') => void;
  /** Returns an error message when the group is full, else null. */
  addToWatchlist: (t: string, group?: string) => string | null;
  removeFromWatchlist: (t: string) => void;
  moveToGroup: (t: string, group: string) => string | null;
  setActiveGroup: (name: string) => void;
  /** Returns an error message on duplicate/invalid name, else null. */
  addGroup: (name: string) => string | null;
  removeGroup: (name: string) => void;
  setCapexTreatment: (c: CapexTreatment) => void;
  setDevMode: (v: boolean) => void;
}

const baselineChecklist = (): ChecklistItem[] =>
  CHECKLIST_QUESTIONS.map((question) => ({ question, answer: false }));

const emptyTicker = (): TickerState => ({
  snapshots: [],
  overrides: {},
  checklist: baselineChecklist(),
  horizon: 5,
  scenarioTab: 'base',
});

const withChecklistEdit = (
  s: AppState,
  t: string,
  edit: (items: ChecklistItem[]) => ChecklistItem[],
): Partial<AppState> => {
  const cur = s.tickers[t] ?? emptyTicker();
  return { tickers: { ...s.tickers, [t]: { ...cur, checklist: edit(cur.checklist) } } };
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // First-run experience: META pre-loaded from the bundled snapshot.
      watchlistGroups: [{ name: 'Main', tickers: ['META'] }],
      activeGroup: 'Main',
      tickers: { META: { ...emptyTicker(), snapshots: [BUNDLED_META] } },
      selectedTicker: 'META',
      capexTreatment: 'sheet',
      proxyBaseUrl: '',
      devFmpApiKey: '',
      devMode: false,
      savedAnalyses: [],
      reviewingId: null,
      installId: '',
      lastFetchAt: {},
      quotaRemaining: null,
      markFetched: (ticker) =>
        set((s) => ({ lastFetchAt: { ...s.lastFetchAt, [ticker]: Date.now() } })),
      setQuotaRemaining: (quotaRemaining) => set({ quotaRemaining }),
      quotes: SEED_QUOTES,

      addQuote: (text, attribution) => {
        const t = text.trim();
        if (!t) return;
        set((s) => ({
          quotes: [...s.quotes, { text: t, attribution: attribution.trim() }],
        }));
      },
      removeQuote: (idx) =>
        set((s) => ({ quotes: s.quotes.filter((_, i) => i !== idx) })),

      saveAnalysis: () => {
        const s = get();
        const ticker = s.selectedTicker;
        const state = s.tickers[ticker];
        const snapshot = activeSnapshot(state);
        if (!state || !snapshot) return { error: `no data loaded for ${ticker}` };
        const analysis = analyzeCompany(snapshot, state.overrides, s.capexTreatment, {
          correct3yTerminal: true,
          seedBearBullFromBase: true,
        });
        const base5 = analysis.scenarios.base[5];
        const savedAt = new Date().toISOString();
        const entry: SavedAnalysis = {
          id: `${ticker}-${Date.now()}`,
          ticker,
          name: snapshot.name,
          savedAt,
          snapshot,
          overrides: JSON.parse(JSON.stringify(state.overrides)),
          capexTreatment: s.capexTreatment,
          horizon: state.horizon,
          scenarioTab: state.scenarioTab,
          digest: {
            price: snapshot.quote.price,
            peLive: analysis.header.peLiveCap,
            evEbit: analysis.header.evOverOperatingIncome,
            fcfYield: analysis.header.adjFcfYield,
            fairValue5: base5.status === 'ok' ? base5.fairValuePerShare : null,
            irr5: base5.status === 'ok' ? base5.irr : null,
            priceDelta5: base5.status === 'ok' ? base5.priceDelta : null,
          },
        };
        set({ savedAnalyses: [entry, ...s.savedAnalyses].slice(0, MAX_SAVED_ANALYSES) });
        return { id: entry.id };
      },
      deleteAnalysis: (id) =>
        set((s) => ({
          savedAnalyses: s.savedAnalyses.filter((a) => a.id !== id),
          reviewingId: s.reviewingId === id ? null : s.reviewingId,
        })),
      startReview: (id) => set({ reviewingId: id }),
      exitReview: () => set({ reviewingId: null }),

      setProxyBaseUrl: (url) => {
        const trimmed = url.trim();
        if (trimmed && !/^https:\/\/[a-z0-9.\-]+/i.test(trimmed)) {
          return 'Proxy URL must be https://';
        }
        set({ proxyBaseUrl: trimmed });
        return null;
      },
      setDevFmpApiKey: async (key) => {
        const trimmed = key.trim();
        set({ devFmpApiKey: trimmed });
        try {
          if (trimmed) {
            await SecureStore.setItemAsync(SECURE_KEY_NAME, trimmed, {
              keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
            });
          } else {
            await SecureStore.deleteItemAsync(SECURE_KEY_NAME);
          }
        } catch {
          // SecureStore unavailable (e.g. web preview): key stays in memory only
        }
      },

      selectTicker: (t) =>
        set((s) => ({
          selectedTicker: t,
          reviewingId: null, // switching tickers always leaves review mode
          tickers: s.tickers[t] ? s.tickers : { ...s.tickers, [t]: emptyTicker() },
        })),
      addSnapshot: (t, snap) =>
        set((s) => {
          const cur = s.tickers[t] ?? emptyTicker();
          return {
            tickers: {
              ...s.tickers,
              [t]: { ...cur, snapshots: [snap, ...cur.snapshots].slice(0, 25) },
            },
          };
        }),
      pinSnapshot: (t, date) =>
        set((s) => ({
          tickers: {
            ...s.tickers,
            [t]: { ...(s.tickers[t] ?? emptyTicker()), pinnedSnapshotDate: date },
          },
        })),
      setOverrides: (t, overrides) =>
        set((s) => ({
          tickers: { ...s.tickers, [t]: { ...(s.tickers[t] ?? emptyTicker()), overrides } },
        })),
      setChecklist: (t, idx, value) =>
        set((s) =>
          withChecklistEdit(s, t, (items) =>
            items.map((it, i) => (i === idx ? { ...it, answer: value } : it)),
          ),
        ),
      addChecklistItem: (t, question) =>
        set((s) => {
          const q = question.trim();
          if (!q) return {};
          return withChecklistEdit(s, t, (items) => [...items, { question: q, answer: false }]);
        }),
      removeChecklistItem: (t, idx) =>
        set((s) => withChecklistEdit(s, t, (items) => items.filter((_, i) => i !== idx))),
      restoreChecklistBaseline: (t) =>
        set((s) => withChecklistEdit(s, t, () => baselineChecklist())),
      setHorizon: (t, horizon) =>
        set((s) => ({
          tickers: { ...s.tickers, [t]: { ...(s.tickers[t] ?? emptyTicker()), horizon } },
        })),
      setScenarioTab: (t, scenarioTab) =>
        set((s) => ({
          tickers: { ...s.tickers, [t]: { ...(s.tickers[t] ?? emptyTicker()), scenarioTab } },
        })),
      addToWatchlist: (t, group) => {
        const s = get();
        const name = group ?? s.activeGroup;
        const g = s.watchlistGroups.find((x) => x.name === name);
        if (!g) return `no group "${name}"`;
        if (g.tickers.includes(t)) return null;
        if (s.watchlistGroups.some((x) => x.tickers.includes(t))) {
          return `${t} is already in another group — long-press it to move it`;
        }
        if (g.tickers.length >= MAX_GROUP_SIZE) {
          return `"${name}" is full (${MAX_GROUP_SIZE} max) — create a new group`;
        }
        set({
          watchlistGroups: s.watchlistGroups.map((x) =>
            x.name === name ? { ...x, tickers: [...x.tickers, t] } : x,
          ),
          tickers: s.tickers[t] ? s.tickers : { ...s.tickers, [t]: emptyTicker() },
        });
        return null;
      },
      removeFromWatchlist: (t) =>
        set((s) => ({
          watchlistGroups: s.watchlistGroups.map((g) => ({
            ...g,
            tickers: g.tickers.filter((x) => x !== t),
          })),
        })),
      moveToGroup: (t, group) => {
        const s = get();
        const target = s.watchlistGroups.find((x) => x.name === group);
        if (!target) return `no group "${group}"`;
        if (target.tickers.length >= MAX_GROUP_SIZE && !target.tickers.includes(t)) {
          return `"${group}" is full (${MAX_GROUP_SIZE} max)`;
        }
        set({
          watchlistGroups: s.watchlistGroups.map((g) => {
            const without = g.tickers.filter((x) => x !== t);
            return g.name === group
              ? { ...g, tickers: without.includes(t) ? without : [...without, t] }
              : { ...g, tickers: without };
          }),
        });
        return null;
      },
      setActiveGroup: (name) => set({ activeGroup: name }),
      addGroup: (name) => {
        const trimmed = name.trim().slice(0, 24);
        if (!trimmed) return 'group name is empty';
        const s = get();
        if (s.watchlistGroups.some((g) => g.name.toLowerCase() === trimmed.toLowerCase())) {
          return `"${trimmed}" already exists`;
        }
        set({
          watchlistGroups: [...s.watchlistGroups, { name: trimmed, tickers: [] }],
          activeGroup: trimmed,
        });
        return null;
      },
      removeGroup: (name) =>
        set((s) => {
          if (s.watchlistGroups.length <= 1) return {};
          const groups = s.watchlistGroups.filter((g) => g.name !== name);
          return {
            watchlistGroups: groups,
            activeGroup: s.activeGroup === name ? groups[0]!.name : s.activeGroup,
          };
        }),
      setCapexTreatment: (capexTreatment) => set({ capexTreatment }),
      setDevMode: (devMode) => set({ devMode }),
    }),
    {
      name: 'dvh-state-v1',
      version: 3,
      migrate: (persisted, version) => {
        const state = persisted as AppState & { watchlist?: string[] };
        if (version < 2) {
          // v1 stored checklist as boolean[14]; convert to editable items.
          for (const t of Object.values(state.tickers ?? {})) {
            const old = t.checklist as unknown;
            if (Array.isArray(old) && (old.length === 0 || typeof old[0] === 'boolean')) {
              t.checklist = CHECKLIST_QUESTIONS.map((question, i) => ({
                question,
                answer: Boolean((old as boolean[])[i]),
              }));
            }
          }
        }
        if (version < 3 && Array.isArray(state.watchlist)) {
          // v2 stored a flat watchlist; split into 50-name groups.
          const groups: WatchlistGroup[] = [];
          for (let i = 0; i < state.watchlist.length; i += MAX_GROUP_SIZE) {
            groups.push({
              name: groups.length === 0 ? 'Main' : `Main ${groups.length + 1}`,
              tickers: state.watchlist.slice(i, i + MAX_GROUP_SIZE),
            });
          }
          state.watchlistGroups = groups.length ? groups : [{ name: 'Main', tickers: [] }];
          state.activeGroup = state.watchlistGroups[0]!.name;
          delete state.watchlist;
        }
        return state;
      },
      storage: createJSONStorage(() => Storage),
      // The API key must never touch the SQLite-persisted JSON: it lives
      // in the Keychain and is re-hydrated by hydrateSecureState().
      // reviewingId is transient UI state.
      partialize: (s) =>
        Object.fromEntries(
          Object.entries(s).filter(([k]) => k !== 'devFmpApiKey' && k !== 'reviewingId'),
        ) as AppState,
    },
  ),
);

const SECURE_KEY_NAME = 'dvh.fmp.apikey';
const INSTALL_ID_NAME = 'dvh.install.id';

function randomId(): string {
  let out = '';
  for (let i = 0; i < 32; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

/** Load Keychain-held secrets into the in-memory store at app start. */
export async function hydrateSecureState(): Promise<void> {
  try {
    const key = await SecureStore.getItemAsync(SECURE_KEY_NAME);
    if (key) useAppStore.setState({ devFmpApiKey: key });
  } catch {
    // SecureStore unavailable: dev key simply stays unset
  }
  try {
    let id = await SecureStore.getItemAsync(INSTALL_ID_NAME);
    if (!id) {
      id = randomId();
      await SecureStore.setItemAsync(INSTALL_ID_NAME, id, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    }
    useAppStore.setState({ installId: id });
  } catch {
    // no Keychain (web preview): per-session id, quota falls back to IP
    useAppStore.setState({ installId: randomId() });
  }
}

/** The snapshot the UI should render for a ticker (pinned or newest). */
export function activeSnapshot(state: TickerState | undefined): CompanySnapshot | null {
  if (!state || state.snapshots.length === 0) return null;
  if (state.pinnedSnapshotDate) {
    const pinned = state.snapshots.find((s) => s.snapshotDate === state.pinnedSnapshotDate);
    if (pinned) return pinned;
  }
  return state.snapshots[0] ?? null;
}
