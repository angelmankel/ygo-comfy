import { create } from 'zustand';
import {
  searchCivitaiModels,
  type CivitaiSearchHit,
  type CivitaiSearchType,
  type CivitaiSearchSort,
  type CivitaiSearchPeriod,
} from '@/lib/civitai';
import { loadBrowserFilters, saveBrowserFilters } from '@/lib/storage';

/**
 * Feature store for the in-app model browser. Owns the filter state
 * (search query / chips / sort / period / NSFW) and the paginated result
 * list. Filters persist via localStorage; results live in memory and are
 * rebuilt on filter change.
 *
 * One AbortController is kept on the module level so a new filter set
 * cancels any in-flight page request instead of letting late results
 * pollute the list.
 */

export type BrowserFilters = {
  query: string;
  types: CivitaiSearchType[];
  baseModels: string[];
  sort: CivitaiSearchSort;
  period: CivitaiSearchPeriod;
  /** When false, the request omits NSFW. CivitAI doesn't support
   *  NSFW-only on /models, so this is a 2-state toggle, not a tri-state. */
  showNsfw: boolean;
  /** Which catalog to query — 'civitai' (civitai.com, SFW-first) or
   *  'red' (civitai.red, full adult catalog). Same API, different host;
   *  some adult-rated models only appear under 'red'. */
  catalog: 'civitai' | 'red';
  /** Bitfield of CivitAI browsing levels to include in results
   *  (1=G, 2=PG, 4=PG13, 8=R, 16=X, 32=XXX). Default = all (63). */
  browsingLevels: number;
};

/** Bit values for the CivitAI rating ladder. Stable; do not renumber. */
export const BROWSING_LEVEL_BITS = {
  G:    1,
  PG:   2,
  PG13: 4,
  R:    8,
  X:    16,
  XXX:  32,
} as const;
export const ALL_BROWSING_LEVELS = 63;

export const DEFAULT_FILTERS: BrowserFilters = {
  query: '',
  types: ['Checkpoint'],
  baseModels: [],
  sort: 'Highest Rated',
  period: 'AllTime',
  showNsfw: true,
  catalog: 'civitai',
  browsingLevels: ALL_BROWSING_LEVELS,
};

type BrowserState = {
  filters: BrowserFilters;
  items: CivitaiSearchHit[];
  /** True for the initial-page load that follows a filter change. */
  loading: boolean;
  /** True while a "load more" page is in flight. */
  loadingMore: boolean;
  /** Null when the next page is unknown / not yet fetched; "" means end-of-list. */
  nextCursor: string | null;
  /** Set when a fetch fails — the UI shows it inline and offers a retry. */
  error: string | null;
  setFilters: (patch: Partial<BrowserFilters>) => void;
  /** Re-runs the initial page fetch with the current filters. */
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
};

let _ctrl: AbortController | null = null;

/** CivitAI caps the page at 100; 60 is a sweet spot — a single round-trip
 *  fills several screens worth of tiles, so fast-scroll has runway without
 *  blowing the payload size on tiles the user may never see. */
const PAGE_SIZE = 60;

export const useBrowserStore = create<BrowserState>((set, get) => ({
  filters: { ...DEFAULT_FILTERS, ...(loadBrowserFilters<Partial<BrowserFilters>>() ?? {}) },
  items: [],
  loading: false,
  loadingMore: false,
  nextCursor: null,
  error: null,

  setFilters: (patch) => {
    const next = { ...get().filters, ...patch };
    saveBrowserFilters(next);
    set({ filters: next });
    // Filter change always re-fetches from the top.
    void get().refresh();
  },

  refresh: async () => {
    _ctrl?.abort();
    const ctrl = new AbortController();
    _ctrl = ctrl;
    set({ loading: true, error: null, items: [], nextCursor: null });
    const { filters } = get();
    const page = await searchCivitaiModels({
      query: filters.query || undefined,
      types: filters.types,
      baseModels: filters.baseModels.length ? filters.baseModels : undefined,
      sort: filters.sort,
      period: filters.period,
      // Civitai Red is an adult catalog; force nsfw=true on the request so
      // the per-model preview galleries include NSFW samples (without it,
      // the API strips them and Red tiles render with no hero image).
      nsfw: filters.catalog === 'red' ? true : filters.showNsfw,
      catalog: filters.catalog,
      browsingLevels: filters.browsingLevels,
      limit: PAGE_SIZE,
    }, ctrl.signal);
    if (ctrl.signal.aborted) return;
    if (!page) {
      set({ loading: false, error: 'CivitAI search failed — try again' });
      return;
    }
    set({ loading: false, items: page.items, nextCursor: page.nextCursor });
  },

  loadMore: async () => {
    const { nextCursor, items, filters, loadingMore } = get();
    if (loadingMore || !nextCursor) return;
    set({ loadingMore: true });
    const page = await searchCivitaiModels({
      query: filters.query || undefined,
      types: filters.types,
      baseModels: filters.baseModels.length ? filters.baseModels : undefined,
      sort: filters.sort,
      period: filters.period,
      // Civitai Red is an adult catalog; force nsfw=true on the request so
      // the per-model preview galleries include NSFW samples (without it,
      // the API strips them and Red tiles render with no hero image).
      nsfw: filters.catalog === 'red' ? true : filters.showNsfw,
      catalog: filters.catalog,
      browsingLevels: filters.browsingLevels,
      cursor: nextCursor,
      limit: PAGE_SIZE,
    });
    if (!page) {
      set({ loadingMore: false, error: 'Failed to load more results' });
      return;
    }
    set({ loadingMore: false, items: [...items, ...page.items], nextCursor: page.nextCursor });
  },
}));
