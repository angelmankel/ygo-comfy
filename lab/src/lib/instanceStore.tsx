import { createContext, useContext, useRef, type ReactNode } from 'react';
import { createStore, type StateCreator, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand/react';

/**
 * Per-instance zustand store for compound components.
 *
 * Each mount of the returned `<StoreProvider>` creates its own isolated store;
 * descendants read it with the returned `useInstance` hook. The provider is
 * meant to live *inside* the compound component's root element — so anyone
 * composing the component never sees or writes a context provider, but every
 * instance still gets its own state.
 *
 *   const { StoreProvider, useInstance } = createInstanceStore(
 *     (init: { value: number }) => (set) => ({
 *       value: init.value,
 *       setValue: (v: number) => set({ value: v }),
 *     }),
 *   );
 *
 *   // Root of the compound component — consumers never touch StoreProvider.
 *   function Root({ value, children }: { value: number; children: ReactNode }) {
 *     return <StoreProvider init={{ value }}>{children}</StoreProvider>;
 *   }
 *
 *   // Any sub-component, at any depth:
 *   function Child() {
 *     const value = useInstance(s => s.value);
 *   }
 */
export function createInstanceStore<T, Init = void>(
  build: (init: Init) => StateCreator<T>,
) {
  const Ctx = createContext<StoreApi<T> | null>(null);

  function StoreProvider({ init, children }: { init: Init; children: ReactNode }) {
    // Created exactly once per mount — never recreated, even if `init`'s
    // identity changes on a later render.
    const ref = useRef<StoreApi<T> | null>(null);
    if (!ref.current) ref.current = createStore(build(init));
    return <Ctx.Provider value={ref.current}>{children}</Ctx.Provider>;
  }

  /**
   * Select a slice of this instance's store. Select narrowly — returning a
   * fresh object literal causes excessive re-renders (same rule as store.ts).
   */
  function useInstance<U>(selector: (s: T) => U): U {
    const store = useContext(Ctx);
    if (!store) throw new Error('createInstanceStore: used outside its <StoreProvider>');
    return useStore(store, selector);
  }

  /** The raw store — for `.getState()` in event handlers and imperative writes. */
  function useInstanceApi(): StoreApi<T> {
    const store = useContext(Ctx);
    if (!store) throw new Error('createInstanceStore: used outside its <StoreProvider>');
    return store;
  }

  return { StoreProvider, useInstance, useInstanceApi };
}
