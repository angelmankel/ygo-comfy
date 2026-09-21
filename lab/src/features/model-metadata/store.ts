import { create } from 'zustand';
import { useStore } from '@/lib/store';
import { resolveCivitai, type CivitaiCacheEntry, type CivitaiVersionByHash } from '@/lib/civitai';
import { findModelHash } from '@/lib/modelHash';
import {
  type CivitaiModel,
  type CivitaiModelVersion,
  type CivitaiImage,
  type NsfwFilter,
  fetchCivitaiModel,
  fetchCivitaiImages,
} from './civitai';
import { loadNsfwFilter, saveNsfwFilter } from '@/lib/storage';

/**
 * Feature-scoped store for the model-metadata modal — its own slice, separate
 * from both the global app store and the model-slot store. Holds which entry's
 * metadata is open, the fetched Civitai payload, the in-modal selection (which
 * version / which gallery image), the gallery NSFW filter, and a paginated
 * per-version gallery cache.
 */

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

/** A version's gallery: images fetched so far + pagination state. */
type VersionGallery = {
  items: CivitaiImage[];
  /** Cursor for the next page, or null once fully loaded. */
  nextCursor: string | null;
  /** True while a "load more" page is in flight. */
  loading: boolean;
};

/** Which set of images the left column shows. 'civitai' is the network gallery
 *  off the model's CivitAI page; 'imagelab' is the user's own local history
 *  filtered to entries that used this model. */
export type GallerySource = 'civitai' | 'imagelab';

type ModelMetadataState = {
  /** The model-slot entry id whose metadata is open; null when the modal is closed. */
  openEntryId: string | null;
  /** The local file name the modal was opened for (via openForFile); null otherwise. */
  openFileName: string | null;
  /** The CivitAI model id the current open is targeting (when known). Set by
   *  both `open` and the openForFile resolver once the hash→id lookup
   *  completes. Used by the error state to offer a "Retry" + an "Open on
   *  Civitai" escape hatch when metadata fails to load. */
  openModelId: number | null;
  load: LoadState;
  model: CivitaiModel | null;
  error: string | null;
  selectedVersionId: number | null;
  selectedImageIndex: number;
  /** Which gallery source the left column is showing. Session-scoped. */
  gallerySource: GallerySource;
  /** Gallery content filter — persists across opens (a user preference). */
  nsfwFilter: NsfwFilter;
  /** Whether the generation-settings panel is expanded — persists across opens. */
  genParamsOpen: boolean;
  /** Whether the fullscreen image overlay (over the metadata modal) is open. */
  fullscreenOpen: boolean;
  /**
   * Gallery images per version id, paginated from the Images API (which keeps
   * each image's generation `meta` — the `models/:id` payload strips it).
   * Session-scoped; cleared when `nsfwFilter` changes (galleries are
   * filter-specific) but not by RESET.
   */
  versionGalleries: Record<number, VersionGallery>;

  /** Open the modal for a model-slot entry, given its CivitAI modelId directly. */
  /** Open by CivitAI model id. `preferVersionId` pre-selects a specific
   *  version once the metadata payload lands — useful when the caller knows
   *  which version they want (e.g. parsed out of an AIR urn or a URL query
   *  param). Falls back to the newest version if absent or unmatched. */
  open: (entryId: string, civitaiModelId: number, preferVersionId?: number) => void;
  /**
   * Open the modal for a model *file*: resolves filename → hash → CivitAI
   * identity → full model. This is what model cards call from `onOpen`.
   */
  openForFile: (entryId: string, fileName: string) => void;
  close: () => void;
  selectVersion: (versionId: number) => void;
  selectImage: (index: number) => void;
  /** Fetch the next page of gallery images for the selected version. */
  loadMore: () => void;
  /** Re-fire the metadata fetch — used by the error-state "Retry" button. */
  retry: () => void;
  /** Switch the gallery NSFW filter and re-fetch the open version's gallery. */
  setNsfwFilter: (filter: NsfwFilter) => void;
  /** Switch between the Civit.ai gallery and the user's local history. Resets
   *  the selected image to 0 so the new source isn't viewed at a stale index. */
  setGallerySource: (source: GallerySource) => void;
  /** Expand / collapse the generation-settings panel. */
  setGenParamsOpen: (open: boolean) => void;
  /** Open / close the fullscreen overlay over the metadata modal. */
  setFullscreenOpen: (open: boolean) => void;
};

const RESET = {
  load: 'loading' as LoadState,
  model: null,
  error: null,
  selectedVersionId: null,
  selectedImageIndex: 0,
};

export const useModelMetadataStore = create<ModelMetadataState>((set, get) => {
  /** Fetch the first page of a version's gallery into the session cache, once. */
  const loadImages = async (versionId: number) => {
    if (get().versionGalleries[versionId]) return; // already loaded
    const page = await fetchCivitaiImages(versionId, undefined, get().nsfwFilter);
    if (!page) return; // request failed → keep the meta-less fallback (empty is cached)
    set((s) => ({
      versionGalleries: {
        ...s.versionGalleries,
        [versionId]: { items: page.items, nextCursor: page.nextCursor, loading: false },
      },
    }));
  };

  /** Append the next page of a version's gallery. */
  const loadMoreImages = async (versionId: number) => {
    const g = get().versionGalleries[versionId];
    if (!g || g.loading || g.nextCursor == null) return;
    set((s) => ({
      versionGalleries: { ...s.versionGalleries, [versionId]: { ...g, loading: true } },
    }));
    const page = await fetchCivitaiImages(versionId, g.nextCursor, get().nsfwFilter);
    set((s) => {
      const cur = s.versionGalleries[versionId];
      if (!cur) return s;
      return {
        versionGalleries: {
          ...s.versionGalleries,
          [versionId]: {
            // On failure keep what we have and leave the cursor so a retry works.
            items: page ? [...cur.items, ...page.items] : cur.items,
            nextCursor: page ? page.nextCursor : cur.nextCursor,
            loading: false,
          },
        },
      };
    });
  };

  /** Fetch a model by id into the modal, guarding against close/reopen races. */
  const loadModel = async (entryId: string, modelId: number, preferVersionId?: number) => {
    try {
      const model = await fetchCivitaiModel(modelId);
      if (get().openEntryId !== entryId) return; // closed or reopened mid-flight
      // Default the selection to the version the user actually opened (matched
      // by file hash in openForFile); otherwise fall back to the newest.
      const versions = model.modelVersions;
      const selectedVersionId =
        preferVersionId != null && versions.some((v) => v.id === preferVersionId)
          ? preferVersionId
          : versions[0]?.id ?? null;
      set({ load: 'loaded', model, selectedVersionId });
      if (selectedVersionId != null) void loadImages(selectedVersionId);
    } catch (e: unknown) {
      if (get().openEntryId !== entryId) return;
      set({ load: 'error', error: e instanceof Error ? e.message : 'Failed to load metadata' });
    }
  };

  return {
    openEntryId: null,
    openFileName: null,
    openModelId: null,
    load: 'idle',
    model: null,
    error: null,
    selectedVersionId: null,
    selectedImageIndex: 0,
    nsfwFilter: loadNsfwFilter(),
    gallerySource: 'civitai',
    genParamsOpen: false,
    fullscreenOpen: false,
    versionGalleries: {},

    open: (entryId, civitaiModelId, preferVersionId) => {
      set({ openEntryId: entryId, openFileName: null, openModelId: civitaiModelId, ...RESET });
      void loadModel(entryId, civitaiModelId, preferVersionId);
    },

    openForFile: (entryId, fileName) => {
      set({ openEntryId: entryId, openFileName: fileName, openModelId: null, ...RESET });
      void (async () => {
        // filename → hash (from the per-server hash cache)
        const match = findModelHash(useStore.getState().modelHashes, fileName);
        if (!match) {
          if (get().openEntryId !== entryId) return;
          set({
            load: 'error',
            error: 'This model has no hash yet — is the ImageLab node running on this server?',
          });
          return;
        }

        // hash → CivitAI identity. The eager pass in useModelHashes usually has
        // this cached in the global store already; fall back to a direct lookup.
        let entry: CivitaiCacheEntry | undefined = useStore.getState().civitaiByHash[match.hash];
        if (!entry || entry.status === 'error') {
          entry = (await resolveCivitai([match.hash])).get(match.hash);
        }
        if (get().openEntryId !== entryId) return;

        if (!entry || entry.status === 'error') {
          set({ load: 'error', error: 'Could not reach CivitAI.' });
          return;
        }
        if (entry.status === 'not-found') {
          set({ load: 'error', error: 'This model isn’t on CivitAI.' });
          return;
        }

        // `entry.data` is the exact version on disk — open the modal *on* it.
        const byHash = entry.data as CivitaiVersionByHash;
        set({ openModelId: byHash.modelId });
        await loadModel(entryId, byHash.modelId, byHash.id);
      })();
    },

    retry: () => {
      const { openEntryId, openFileName, openModelId } = get();
      if (!openEntryId) return;
      set({ ...RESET });
      if (openModelId != null) {
        void loadModel(openEntryId, openModelId);
      } else if (openFileName) {
        // Re-run the file resolver path. Pulled out so retry() doesn't have
        // to know about the hash lookup.
        get().openForFile(openEntryId, openFileName);
      }
    },

    // When closing, also reset the gallery source so the next opened model
    // starts on the default (Civit.ai) — feels less surprising than carrying
    // a stale 'imagelab' selection over from an unrelated model.
    close: () => set({
      openEntryId: null, openFileName: null, openModelId: null, fullscreenOpen: false,
      gallerySource: 'civitai', ...RESET, load: 'idle',
    }),

    selectVersion: (versionId) => {
      set({ selectedVersionId: versionId, selectedImageIndex: 0 });
      void loadImages(versionId);
    },
    selectImage: (index) => set({ selectedImageIndex: index }),
    loadMore: () => {
      const versionId = get().selectedVersionId;
      if (versionId != null) void loadMoreImages(versionId);
    },
    setNsfwFilter: (filter) => {
      if (get().nsfwFilter === filter) return;
      saveNsfwFilter(filter);
      // Galleries are filter-specific — drop the cache and refetch the open version.
      set({ nsfwFilter: filter, versionGalleries: {}, selectedImageIndex: 0 });
      const versionId = get().selectedVersionId;
      if (versionId != null) void loadImages(versionId);
    },
    setGallerySource: (source) => {
      if (get().gallerySource === source) return;
      set({ gallerySource: source, selectedImageIndex: 0 });
    },
    setGenParamsOpen: (open) => set({ genParamsOpen: open }),
    setFullscreenOpen: (open) => set({ fullscreenOpen: open }),
  };
});

/** The currently-selected version (falls back to the first), derived from store state. */
export function useSelectedVersion(): CivitaiModelVersion | null {
  return useModelMetadataStore((s) => {
    if (!s.model) return null;
    return (
      s.model.modelVersions.find((v) => v.id === s.selectedVersionId) ??
      s.model.modelVersions[0] ??
      null
    );
  });
}

const NO_IMAGES: CivitaiImage[] = [];

/**
 * Gallery images for the selected version — the meta-rich Images-API set once
 * it's fetched, falling back to the model payload's (meta-less) images while
 * that's in flight or if it failed.
 */
export function useVersionImages(): CivitaiImage[] {
  const version = useSelectedVersion();
  return useModelMetadataStore((s) =>
    version
      ? s.versionGalleries[version.id]?.items ?? version.images ?? NO_IMAGES
      : NO_IMAGES,
  );
}
