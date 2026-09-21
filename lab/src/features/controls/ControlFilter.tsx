/**
 * Type a name, get the parameter.
 *
 * Every control is still on the page — the complaint was never that things were missing, it was
 * that finding one meant scrolling past thirty others with a thumb. A filter is the opposite of
 * hiding: it is the fastest possible path to a parameter, and clearing it puts everything back.
 *
 * Sections decide for themselves whether they match, so a section with no matching control folds
 * away while a matching one is forced open regardless of how it was left.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { SearchIcon, CloseIcon } from '@/components/ui/icons';

interface FilterValue {
  /** Lower-cased query, or '' when nothing is being searched. */
  query: string;
  /** True when any of these words matches the query. Always true with no query. */
  matches: (...words: (string | undefined)[]) => boolean;
  active: boolean;
}

const Ctx = createContext<FilterValue>({ query: '', matches: () => true, active: false });

export const useControlFilter = () => useContext(Ctx);

export function ControlFilterProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const value = useMemo<FilterValue>(() => ({
    query: q,
    active: q.length > 0,
    matches: (...words) => !q || words.some(w => (w ?? '').toLowerCase().includes(q)),
  }), [q]);

  return (
    <Ctx.Provider value={value}>
      <div className="relative">
        <SearchIcon size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Find a control…"
          aria-label="Find a control"
          className="h-11 w-full rounded-lg border border-border-default bg-bg-input pl-9 pr-9 text-[13px] text-fg-primary outline-none placeholder:text-fg-muted focus:border-accent"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear the search"
            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-fg-muted hover:text-fg-secondary"
          >
            <CloseIcon size={12} />
          </button>
        )}
      </div>
      {children}
    </Ctx.Provider>
  );
}

/** Nothing matched — say so, rather than leaving an empty panel that looks broken. */
export function NoMatches({ query }: { query: string }) {
  return (
    <p className="px-1 py-8 text-center text-[12.5px] text-fg-muted">
      No control matches “{query}”.
    </p>
  );
}
