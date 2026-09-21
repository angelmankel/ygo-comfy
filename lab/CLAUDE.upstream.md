# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A self-hosted frontend for ComfyUI image generation. The browser app talks directly to ComfyUI's REST + WebSocket API (no app backend). A small Python static server (`serve.py`) serves the built React bundle and adds an SSE-based hot reload that watches the project tree.

## Repo shape

This repo stacks two distinct things in one directory:

| Path | Role |
|---|---|
| `web/` | React + Vite + TypeScript **source** |
| `index.html`, `assets/` | **Built artifacts** — what `serve.py` actually serves |
| `serve.py` | Python static server with SSE hot-reload |
| `docker-compose.yml` | Container that runs `serve.py` behind Traefik on `ilgpu.dev.blueoceanswim.com` |
| `index.html.bak` | Original single-file vanilla-JS app, pre-rewrite. Reference only — do not edit |

`web/vite.config.ts` writes its build output to the project root (`outDir: '..'`, `emptyOutDir: false`) so the new `index.html` and `assets/` slot directly into where `serve.py` looks. `npm run build` `rm -rf`'s `../assets/` first so stale chunks don't accumulate.

## Commands

All commands run from `web/`:

```bash
cd web
npm run dev      # Vite dev server with HMR (port 5173). Talks to ComfyUI over HTTP.
npm run build    # tsc -b && rm -rf ../assets && vite build → writes ../index.html + ../assets/
npm run preview  # preview the production build locally
```

**Always run `npm run build` after editing anything under `web/src/`** — `serve.py` serves the *built* bundle, not the source. The container picks up new build output automatically (no compose restart); `serve.py`'s SSE hot-reload pushes a `reload` event to open tabs on any file change. There is no test suite or linter beyond `tsc -b`.

```bash
docker compose up -d              # bring the static server up
docker logs -f imagelab-gpu       # tail server logs
```

## Architecture

### Stack

React 18 · TypeScript · Vite 5 · Tailwind CSS v4 (CSS-first `@theme` in `src/styles/index.css`) · Radix primitives · @dnd-kit (sortable layers) · Zustand (state). The canvas renderer is a **hand-rolled 2D-canvas controller** (`lib/canvasController.ts`).

### Project layout

```
src/
  App.tsx · main.tsx        # entry + app shell (thin — wires hooks + layout)
  components/               # generic, reusable presentational components
    ErrorBoundary.tsx · Logo.tsx · modal/ · FullscreenImage.tsx
    ui/                     # design-system primitives (Dialog, Slider, Switch, icons, …)
  features/                 # feature modules, one folder per domain
    canvas/ collections/ comfy/ controls/ downloads/ generate/ history/
    inputImage/ layers/ layout/ model-metadata/ models/ workspaces/
  hooks/                    # useCanvasSync · useCollapsed · useComfyConnection ·
                            #   useDownloads · useGlobalShortcuts · useIsDesktop ·
                            #   useMobilePanels · useModelHashes · usePanZoom ·
                            #   useResourceAvailability
  lib/                      # non-UI core (state, API clients, storage, controllers)
  styles/
```

Imports use the `@/` alias (→ `src/`); relative imports only between files in the same folder. Feature folders may import from `components/`, `hooks/`, and `lib/`, but should not reach into each other. (`features/workspaces/` is the historical home of `SettingsModal.tsx` — the folder name is a vestige of an earlier model; the modal today is the **server** manager.)

### Servers + global state — the central concept

There is **no per-workspace isolation anymore**. A **server** is just one ComfyUI endpoint (`{ id, name, host }`); every other piece of state — workflow params, prompt layers, snippet library, history — is **global** and shared across every server. Jobs are spread across servers by an independent routing mechanism (round-robin or pinned).

- Registry: `imagelab.servers.v1` (`Server[]`). Seeded on first run from `SEED_SERVERS` in `storage.ts` (the two LAN ComfyUI boxes).
- Routing: `imagelab.routing.v1` (`{ mode, rrIndex }`). `mode` is `'round-robin'` or a pinned server id; `rrIndex` is the rotating cursor (across *online* servers only).
- Each `HistoryEntry` and `Job` carries its own `serverId` so the History panel can show per-server tabs and the canvas/queue can attribute work back to the originating box. Loaders accept the legacy `workspaceId` field for entries written before the rename.
- One-time migration from the per-workspace era: `initServers()` reads `LEGACY_WORKSPACES_KEY` if present and promotes the previously-active workspace's workflow + snippets to the new global keys, then merges every workspace's history into one server-tagged list. `LEGACY_PROMPT_KEY` is similarly promoted to the shared prompt key by `initSharedPrompt()`. Both run at module import time in `storage.ts`.
- The user can't "switch" any state — the only thing a server selection controls is *where the next job runs*. Resource availability (does this checkpoint exist on the round-robin target?) is surfaced as disabled options in the model pickers via `useResourceAvailability` + `lib/routing.ts`, and at queue time `queuePrompt` errors with `"Pick a checkpoint first"`-style messages if the workflow can't run on the chosen target.

### The ImageLab custom node — `/imagelab/*` endpoints

The app's non-generation features (model hashing, CivitAI lookups + downloads, local model deletion) are served by a ComfyUI custom node: **`donny/imagelab_v3_extension`** on the LAN Gitea. Install it on every ComfyUI server you point the app at — without it, those features degrade gracefully (model cards show no preview, the metadata modal can't open, the Sync action sees no online servers). The frontend talks to it host-scoped exactly like ComfyUI's own API — every call is parameterized by server host, and hashes/availability are merged across all servers (`useModelHashes`).

Endpoints:

- `GET /imagelab/hashes` → `{ version, models: { key, filename, hash, hashed_at }[] }` (ETag'd). Built at startup by walking the model folders and cached on disk under `model_index/<relpath>.index`. `lib/civitai.ts` resolves those hashes to CivitAI metadata; `serversWithModel` + `useResourceAvailability` check per-server presence.
- `POST /imagelab/downloads` → `{ version_id, folder?, filename? }`. Folder auto-derives from CivitAI's model type when omitted. The node streams the file into the right ComfyUI folder, then hashes it into the index so it shows in `/imagelab/hashes` immediately.
- `GET /imagelab/downloads` → all tracked downloads (active + finished). Polled by `useDownloads` — fast cadence while anything is active, slow otherwise.
- `DELETE /imagelab/downloads/{version_id}` — cancel an active download, or dismiss a finished/failed row.
- `DELETE /imagelab/models/{folder}/{filename}` — delete a local model + its hash sidecar.

**Startup auto-download (RunPod)** — the node optionally reads `IMAGELAB_AUTO_DOWNLOAD` (comma/newline list of CivitAI version ids, model ids, full URLs, or `<folder>::<entry>` overrides) and queues every entry on boot. CivitAI auth uses `CIVITAI_TOKEN` from the ComfyUI process environment (required for gated models).

**Sync semantics** — `<DownloadAction>` in the metadata modal computes which online servers are missing the selected version's primary file (via `serversWithModel(serverInfo, fileName)`) and renders one of: **Download** (no server has it → fires at every online server), **Sync to N server(s)** (some servers have it → fires at just the missing ones), or **On disk** (every server has it). When a download transitions `downloading → completed`, `features/downloads/store.ts` re-fetches that server's `serverInfo` so the action flips to "On disk" without a manual reload.

### `src/lib/` — non-UI core

- `types.ts` — `Layer`, `Snippet`, `SnippetCategory`, `HistoryEntry` (`serverId`, optional Venice AI cache: `tags?`/`description?`/`aiPrompt?`), `Job` (queue entry), `WorkflowState` (incl. `inputImage`, `checkpoints[]`, `vae`, WD14 `tag*` fields, `canvasSize`, `upscale*`, `removeBg`), `ServerInfo`, `Status`, plus the Collections types `Collection` and `ImportedImage`.
- `storage.ts` — every `localStorage` key + load/save helpers. Servers registry, routing, layers (shared key `SHARED_PROMPT_KEY`), snippets + categories, history, workflow (+ `INPUT_IMAGE_KEY` held separately because of dataURL weight), Venice settings, theme state, collapse cache, panel-tab persistence, slideshow play state, model-picker filters, model-preview source, `AUTO_FRAME_KEY` (auto-frame-on-complete toggle), plus the new `COLLECTIONS_KEY` and `IMPORTED_IMAGES_KEY`. Also: constants (`HIRES_TARGETS`, `CANVAS_SIZES`, `RESOLUTION_PRESETS`, `FALLBACKS`, `SEED_SERVERS`, `DEFAULT_COMFY_HOST`), the `uid()` generator, and the legacy-data migration helpers. **Persistence is synchronous** — store actions save on every mutation.
- `prompt.ts` — `compileLayers(layers, kind)` flattens enabled layers into ComfyUI's `(text:weight)` comma-joined syntax. Non-1.0 weights wrap in parens; 1.0 weights pass through bare.
- `comfy.ts` — REST + WS client. `buildGraph()` (see below), `viewUrl(entry, hostOverride?)` (the override lets the History panel resolve images from any server), `comfyHttpFor/comfyWsFor` (HTTP↔HTTPS + WS↔WSS by `location.protocol`), `fetchServerInfo`, `queuePrompt`, `fetchPromptResult`, `interruptPrompt`, `deleteQueuedPrompt`, `fetchLastWorkflow` (pulls the last-run API graph back out for "copy workflow"), `uploadImage` / `loadImageRef`, `connectComfyWs` (per-server, auto-reconnect every 2s), `clientId`.
- `imageJobs.ts` — independent runner for small one-off image-tool graphs (e.g. Remove BG inside the input-image editor). Uploads an image, queues a `ToolGraphBuilder`-produced graph, polls `/history/{id}`, returns the result as a Blob. Doesn't touch the main generation queue.
- `routing.ts` — `useResourceAvailability(kind)` + helpers that compare the active workflow against each server's `ServerInfo` so the pickers can show every option but disable the ones that won't run on the currently-targeted server.
- `store.ts` — the Zustand store. State slices: `workflow`, `layers`, `snippets`, `snippetCategories`, `venice`, `modelPreviewSource`, `modelPickerFilters`, `autoFrameOnComplete`, `history`, `selectedEntry`, `server` (union of all reporting servers' capabilities), `serverInfo` (per-server), `status`, `jobs`, `canvasMode`, `previewSource`, `modelHashes`, `civitaiByHash`, `servers`, `routing` / `roundRobinIndex`, `viewerOpen` / `viewerClosedAt` / `viewerInfoOpen`, `themeId` / `customThemes`, `collections`, `importedImages`. Actions follow naming conventions: `pushHistory`, `recallSelected`, `toggleHistoryLiked`, `selectHistoryEntry`, `peekNextServer` / `advanceRoundRobin`, `addJob` / `updateJob` / `cancelJob`, `setItemAi` (writes AI metadata to whichever list — history or imported — owns the id), etc.
- `civitai.ts` + `civitaiCache.ts` — CivitAI by-hash + by-modelId lookups, with IndexedDB caching (separate DB-version coupling: see Gotchas).
- `modelHash.ts` — derives `model file → CivitAI hash → cached metadata` so the model pickers and metadata modal can render previews + names from a local file alone.
- `themes.ts` — palette + font + icon-weight definitions for built-in + custom themes; `applyTheme` writes the active theme to `:root` CSS variables.
- `venice.ts` — Venice AI client. Text helpers (`veniceChat`, `expandPromptFragment`, `brainstormSnippets`) and vision helpers (`tagImage`, `describeImage`, `promptFromImage`, plus `blobToDataUrl` / `httpUrlToDataUrl`). See the **Venice AI integration** section below.
- `importedDb.ts` — IndexedDB blob store for Collections imports (`imagelab-imports` DB, see Collections panel).
- `jobsDb.ts` — IndexedDB for the in-flight generation queue (`imagelab` DB, `jobs` store). Each `Job` survives a refresh and is removed on completion (the finished image lives in history instead).
- `canvasContext.ts` — React context exposing the live `CanvasController`; set by `<InfiniteCanvas>` on mount.
- `canvasController.ts` — `CanvasController` type + `createCanvasController()`: imperative 2D-canvas controller (view state, render loop, multi-pointer gestures, pan momentum).
- `momentum.ts` — drag-"throw" primitives: velocity tracker + inertia runner. Used by `canvasController.ts` and the `usePanZoom` hook.
- `instanceStore.tsx` — `createInstanceStore(creator)` — factory for per-mount Zustand stores wrapped in a `<StoreProvider>` so each instance of a compound component gets its own isolated state.
- `keys.ts` — `isTypingTarget()`; every global keyboard shortcut must call it first so shortcuts don't fire while typing in inputs/textareas.
- `cn.ts` — classnames helper.

### The ComfyUI graph — `buildGraph(workflow, layers, inputImageRef?)`

Produces the prompt graph POSTed to ComfyUI. Node ids are arbitrary internal strings:

- Base: `3` KSampler, `4` CheckpointLoaderSimple, `5` EmptyLatentImage, `6`/`7` CLIPTextEncode (positive/negative from `compileLayers`).
- VAE: `4v` VAELoader when `workflow.vae` is set; otherwise the VAEDecode uses the checkpoint's built-in VAE (`["4", 2]`).
- **img2img** (`inputImageRef` non-null — `queuePrompt` populates this after uploading `workflow.inputImage` to the target server): `i0` LoadImage + `i1` VAEEncode replace `5` (which is deleted). The base sampler's `latent_image` is rewired to `i1`, and its `denoise` is overridden with `workflow.inputDenoise` so the txt2img `denoise` default is preserved for non-img2img runs.
- Hi-Res Fix (`hiresTarget !== 'Off'`): `5b` LatentUpscale + `3b` KSampler. Stacks on top of img2img unchanged.
- Auto-Tag Refine (`autoTag` **and** Hi-Res on): `8t` VAEDecode of the upscaled latent → `tag` `WD14Tagger|pysssss` → `6t` CLIPTextEncode — and `3b` uses `6t` as its positive instead of `6` (the hi-res pass is re-prompted from auto-tags).
- `8` VAEDecode (final). Optional post chain: `10a`/`10` UpscaleModel, `11a`/`11` BRIA RMBG.
- `9` SaveImage — **saves at native resolution**. There is no ImageScale node; "canvas size" is a display-only setting (see below).

### Data flow

```
boot       App.tsx → useComfyConnection(controllerRef)         [hook owns per-server WS/REST loops]
            ├─ for each server:
            │   ├─ fetchServerInfo()      → store.setServerInfo(serverId, info)
            │   └─ connectComfyWs(host, { onEvent })   (auto-reconnect every 2s)
            │       ├─ binary frame  → controller.loadBlobUrl()    (live preview)
            │       ├─ progress      → store.updateJob(promptId, { progress })
            │       └─ executing(node=null, matching prompt_id)
            │            → fetchPromptResult() → controller.loadHttpUrl
            │                                  + store.pushHistory({ … serverId })
            │                                  + store.removeJob(promptId)
            └─ useDownloads + useModelHashes hydrate cross-server state in the background.

generate   <GenerateButton/Widget> → store.peekNextServer()
                                  → queuePrompt(host, workflow, layers)
                                  → store.addJob({ serverId, … }) + advanceRoundRobin()
```

There is **no `setServer` reconciliation** anymore. The workflow is global and may legitimately reference resources that exist on only some servers — `setServerInfo` updates the per-server `serverInfo` map and the merged `server` union (which populates dropdown option lists), but does not mutate `workflow`. Invalid-for-the-target selections appear as disabled options in the pickers (via `useResourceAvailability`) and block generation with a clear status message instead.

### UI composition

`App.tsx` is `<Sidebar>` (52px rail) / `<LeftPanel>` (380px, collapsible) / center canvas `<InfiniteCanvas>` (flex) / `<HistoryPanel>` (340px, collapsible). Both side panels collapse on desktop and become swipe drawers on mobile (see `useMobilePanels` + `useIsDesktop`).

- `<Sidebar>` — slim left rail, always visible above every overlay. Pinned-top: logo. Middle clusters: one ComfyUI button per configured server (badged with an index), then the **Collections** button. Pinned-bottom: Settings.
- `<LeftPanel>` — Parameters tabs (**Prompt / Parameters / Post**) plus an Input-Image section at the top of **Parameters** (`features/inputImage/`) and a sticky `<GenerateButton>` footer. The active tab persists across reloads via `imagelab.panelTab.v1`.
  - **Prompt** — pinned `<FinalPromptArea>` at the top (compiled positive + negative as two read-only auto-growing textareas with copy buttons), a divider, then two collapsible `<LayersSection>` (positive defaults open, negative defaults closed; section-collapse persists via `useCollapsed("layers.positive" / "layers.negative", …)`). Each section's header carries a `+ Add` button and a 📚 **Library** button. Each `<LayerCard>` is a full card (drag-handle, **`<ToggleButton>`** on/off chip — replaces the old slider switch, tag chip, auto-grow textarea, weight slider) with a ★ "save to library" action. `<AddLayerMenu>` ("+ Add") is a popover with a **pinned "Empty snippet" tile** at the top (sits above the search/filter cluster in its own `border-b` band so it never scrolls off), a search input, base-model category filter chips, and a scrollable saved-library list. DnD reordering is constrained within the same kind — see `LayersSection.onDragEnd` + `store.reorderLayers`. Per-layer collapse state persists via `useCollapsed(\`layer:${id}\`, false)`. **Mount-rule note:** `LayersSection` unmounts (not just hides) its body when collapsed — the cards' textareas auto-grow off `scrollHeight`, which reads 0 while the parent is `display:none` and leaves the textarea clipped on first expand.
  - The 📚 **Library** button opens `<SnippetLibraryModal>` (`features/layers/SnippetLibraryModal.tsx`): two columns — a categories sidebar (Lighting / Color / Style / Composition / Mood / Quality / Subject / Camera / Negative variants, user-editable, persisted under `imagelab.snippetCategories.v1`) and a snippet grid. Each card has an "add as layer" toggle (tracked via `layer.originSnippetId` so toggling off removes the matching layer), inline edit fields, and Venice actions: **improve / expand / shorten** per snippet plus a category-wide **brainstorm** that batches new snippets from a theme.
  - **Parameters** — `ModelStack` (checkpoint list with optional merge ratios, VAE override, LoRA list — all in `features/models/`), `GenerationSection`, `OutputSection` (size as a `RESOLUTION_PRESETS` dropdown).
  - **Post** — `HiResFixSection`, `AutoTagSection`, `UpscaleModelSection`, `RemoveBgSection` (all in `ControlsSections.tsx`).
- Center — `<InfiniteCanvas>` (2D canvas with momentum pan/zoom) + a floating top toolbar:
  - **Left:** when the left panel is collapsed on desktop, an inline `<GenerateWidget>` slides in so the user can still generate. (Fit-to-view used to live here; it's a floating bottom-left circle now — see below.)
  - **Center:** `<StatusPill>` · `<QueueButton>` · `<DownloadsButton>` — CivitAI model downloads tracked across every server, polled via each server's `/imagelab/downloads` (see "The ImageLab custom node").
  - **Right:** `<RecallButton>` · `<CanvasModeToggle>` (preview vs. selected image) · `<AutoFrameToggle>` sparkle button (driven by `autoFrameOnComplete` — when on, a completed job runs `selectHistoryEntry` + `setCanvasMode('image')` + `controller.loadHttpUrl` (which auto-fits via the controller's built-in fit-on-load); sits beside the canvas-mode toggle because one decides what's on the canvas *now* and the other decides whether a new job overrides it) · Info button (opens viewer with metadata panel) · canvas-size select.
  - **Toggle-button styling note:** `<AutoFrameToggle>` is declared inline in `App.tsx` rather than using the shared `<IconButton>`. The shared button's default `bg-bg-elev` / `text-fg-muted` utilities are the same Tailwind specificity as override props, and `cn` (clsx) doesn't deconflict — so the on-state contrast was getting silently clobbered by stylesheet ordering. Future on/off icon toggles that need a hard visual contrast should either own their shell directly or use `!important` modifiers.
  - Floating button **pair** — `bottom-left` fit-to-view + `bottom-right` fullscreen, both `h-12 w-12 rounded-full` circles with backdrop blur so they read as siblings.
- `<HistoryPanel>` — All + per-server filter tabs, a favorites filter, history grid with cross-server like/delete. Per-tile hover actions; click once to select, click selected tile again to open `<FullscreenViewer>` (which is mounted globally and driven by `viewerOpen`).
- Overlays: `<SettingsModal>` (tabs: **Servers** · **AI / Venice** · **Previews** · **Theme** — add/edit/remove ComfyUI endpoints, Venice key + model + base URL, model-preview-source selector, palette picker), `<ComfyOverlay>` (full-screen ComfyUI iframe + "copy last workflow" — its left edge is offset by 52px so `<Sidebar>` stays visible behind it; clicking a ComfyUI sidebar button while it's open just switches the embedded server), `<WorkflowModal>` (shows the copied graph JSON), `<FullscreenViewer>` (history-flavored — adapts `HistoryEntry[] → FullscreenItem[]` and renders `<FullscreenImage>` with an entry-metadata info sidebar), `<CollectionsOverlay>` (see below), `<ModelMetadataModal>` (CivitAI metadata + version picker; the gallery's left column has a **Civit.ai / ImageLab** segmented control — Civit.ai is the paginated `/images` API set with the NSFW filter; ImageLab is the user's local history filtered to entries that used this model file (checkpoint via `entry.model`, LoRA via `workflow.loras`, VAE via `workflow.vae`), newest first. In ImageLab mode the hero gains a top-right overlay with **favorite** and **delete** buttons that act on the underlying `HistoryEntry`; slideshow auto-advance with globally-persisted play state (`imagelab.slideshowPlaying.v1`), `←/→` arrow nav, `Space` or click hero to enter fullscreen, **Use as input** / **Use & close** buttons in the header that fetch the current image and write it to `workflow.inputImage`, and a footer `<DownloadAction>` that flips between Download / Sync to N / On disk based on per-server presence — see "The ImageLab custom node").

`<FullscreenImage>` (in `components/`) is the generic, reusable fullscreen viewer used by both `<FullscreenViewer>` (history) and the model-metadata modal's gallery. Owns chrome (close, prev/next, page counter, slideshow toggle, optional info side panel), gestures (pan/pinch/wheel/momentum via `usePanZoom`), and keyboard nav (`←/→`, `S`, `Esc`). Caller-supplied `infoSlot` decides the side-panel content; controlled `playing` / `onPlayingChange` lets multiple viewers share one play state.

### Input-image editor — `features/inputImage/`

A dropzone in the Parameters tab + an `<EditImageModal>` that lets the user prep a source image before queueing img2img. Two execution lanes:

- **Client-side, instant** (`imageOps.ts`) — rotate, flip H/V, invert, crop (interactive `<CropOverlay>` with pixel-accurate image-coord state), brightness/contrast/saturation/blur. Adjustments preview through CSS `filter` for immediate feedback, then bake onto a fresh Canvas on Apply.
- **Server-side, via the decoupled tool runner** (`lib/imageJobs.ts`) — `runImageTool(host, blob, name, buildGraph)` uploads the blob, queues a `ToolGraphBuilder`-produced graph as a *separate* prompt, polls `/history/{id}` until done, and returns the result Blob. Remove BG is today's only tool (graph: `LoadImage → BRIA_RMBG_ModelLoader_Zho → BRIA_RMBG_Zho → SaveImage`); the pattern is reusable for any single-input/single-output preprocessor.

Every successful op (client or server) calls `commit(next, label)` which both pushes the image up to the workflow store **and** appends a `{ state, label, at }` step onto the modal's session-local history stack. The bottom "Reset to original" button is a split control: the left half jumps to step 0, the right chevron opens a Radix popover with the full version history (thumbnails + labels), letting the user revert to any earlier step. Committing from a non-tip cursor truncates the tail (standard undo). The original is captured via lazy `useState` initialiser so it's stable across re-renders — important because the modal's `image` prop comes from `useStore(s => s.workflow.inputImage)` and changes on every commit.

`queuePrompt` does the upload-before-each-server work automatically: when `workflow.inputImage` is set, it resizes client-side to `inputMaxSize` via Canvas, calls `uploadImage(host, blob, name)` once per queue (round-robin sends to a new server → fresh upload), and passes the returned `loadImageRef(uploaded)` into `buildGraph` as its third argument. The `inputImage` dataURL lives under its own `imagelab.inputImage.v1` key (separate from the workflow JSON) so unrelated workflow tweaks don't repeatedly re-serialize a multi-MB payload; a reference-identity cache short-circuits no-op saves.

### Collections panel — `features/collections/`

A full-canvas overlay (same layer as `<ComfyOverlay>`: `fixed inset-y-0 right-0 left-[52px] z-[60]`) opened from the new **Collections** sidebar button. Three columns:

- **Left rail** (`CollectionsRail.tsx`) — virtual buckets (`All`, `Imports`, `Favorites`) plus user-created collections, with rename / delete on hover and "+ New collection" at the bottom.
- **Center grid** (`CollectionsGrid.tsx`) — square thumbnails (3–6 cols responsive), top toolbar with search (prefix `#` for tags-only), sort (newest/oldest/name), source filter (all/generated/imports), and **Import** button. Drag-and-drop file import lights up a full-bleed drop zone; multiple files are accepted at once. Tiles have hover actions: favorite, **+ to collection** popover (toggle membership across collections), delete.
- **Right detail drawer** (`CollectionDetail.tsx`) — opens when a tile is clicked. Shows the full-size preview, source metadata, and Venice AI actions (see below). Width fixed at 360px; click ✕ or hit **Esc** to dismiss.

Unified `Tile` shape lives in `useCollectionTiles.ts` — merges `HistoryEntry[]` and `ImportedImage[]` into one filterable/sortable list. The hook also owns a module-level `Map<id, ObjectURL>` cache for imported-image thumbnails (created on first sight from the IDB blob, revoked when the image is removed); this survives the overlay's open/close cycle so flipping back and forth is cheap.

**Imported-image storage** is split:
- Metadata (id, name, dimensions, AI cache fields) → `localStorage` key `imagelab.imported.v1` (loaded synchronously so the grid renders without an IDB round-trip).
- Blob bytes → IndexedDB (`importedDb.ts`, DB `imagelab-imports`, store `blobs`, keyed by image id). Lives in **its own database**, not the shared `imagelab` DB used by `jobsDb` / `civitaiCache`, to avoid version coupling between unrelated stores.

**Collections themselves** are just `{ id, name, icon?, color?, itemIds[], createdAt }` records in `localStorage` (`imagelab.collections.v1`). An item id may resolve to either a `HistoryEntry` or an `ImportedImage` — both come from the same `uid()` namespace. Items are referenced, not owned: deleting a collection doesn't delete its images, and deleting an image cleans it from every collection via `removeItemFromAllCollections`.

### Model pickers — `features/models/ModelPicker.tsx` + `primitives/ModelPreviewTooltip.tsx`

The "+ Add / Change / Set" popovers used by checkpoint, VAE, and LoRA rows are one generic `<ModelPicker>`. Each row shows a 2× preview thumb (`PreviewThumb` with a `srcs[]` fallback chain — first non-404 URL wins; cached failures still fire `onError` thanks to a `key={url}` per `<img>`), the file name (two-line clamp), a kind chip, and a base-model bucket chip. Hovering any row mounts `<ModelPreviewTooltip>` — a 260×340 cross-fading slideshow of the model's CivitAI images.

- **Hover slideshow.** Two overlapping `<img>` layers swap opacity every 1.8s with a 600ms transition; failed URLs drop out of the play-list. The tooltip Content has `animate-tooltip-in` (CSS keyframe in `index.css`) so it fades + scales from the trigger edge rather than popping in flat. Each `ModelPreviewTooltip` wraps itself in its **own** `RTooltip.Provider` with `skipDelayDuration={0}` and `delayDuration={350}` — because each provider has only one Root child, the "skip" window can never apply across rows, so scrolling quickly through a long checkpoint list never bypasses the 350ms dwell and never flashes a tooltip per row. The global `TooltipProvider` in `App.tsx` (used by everything else) stays at its snappier defaults.
- **Touch long-press = hover.** The Trigger carries pointer handlers (filtered to `pointerType === 'touch'`) that start a 450ms timer on press; if the finger drifts > 8px it cancels (so scrolling doesn't open tooltips), if the timer fires it opens the tooltip and stays open until release. After a successful long-press, `onClickCapture` swallows the synthetic click once so tap-and-hold never accidentally selects the model. `onContextMenu` is also suppressed during the long-press so the OS's own press-and-hold menu doesn't fight ours.
- **Preview source** — driven by `modelPreviewSource` (`'first' | 'popular' | 'random' | 'history'`, key `imagelab.previewSource.v1`, selectable in **Settings → Previews**). The picker resolves the play-list afresh on every hover-open via `orderForPreview(urls, historyUrls, source)` in `lib/modelHash.ts`, so `'random'` really does shuffle each time. `'history'` interleaves local generations that used this model (resolved per-server via `viewUrl`, newest first) in front of CivitAI's images. `'popular'` returns CivitAI's curated order for now (the `/by-hash` endpoint we use doesn't expose per-image stats); the setting is reserved so a future upgrade that fetches richer stats doesn't break compatibility.
- **Base-model filter chips.** A row of chips under the search input (SD 1.5 / SD 2.x / SD 3.x / SDXL / Pony / Illustrious / NoobAI / Flux / Cascade / PixArt / AuraFlow / Other / Unknown), only rendered when more than one bucket is actually present in the option list. Buckets come from `bucketForBaseModel(raw)` — matching Pony / Illustrious / NoobAI before SDXL because they're SDXL-derived but get their own buckets on CivitAI. Selection persists per kind under `imagelab.modelPickerFilter.v1` (`{checkpoint, lora, vae}` → bucket id) so the popover reopens where the user left it.
- **Availability lives in the tooltip footer**, not the native `title` attribute — `availabilityHint(av)` produces "Available on: 3090" / "Only available on: 3090, 4090" / "Not installed on any server", paired with an ok / warn / err coloured dot. The old `title=` was removed so it doesn't race the styled tooltip.

### Venice AI integration — `lib/venice.ts`

OpenAI-compatible chat client for Venice (also works against any compatible provider; `baseUrl` is configurable in Settings → AI). Two surfaces:

- **Text** — `veniceChat`, `expandPromptFragment`, `brainstormSnippets`. Used by the Snippet Library's "improve / expand / brainstorm" actions.
- **Vision (added with Collections)** — `tagImage(blob, style, settings)` (Danbooru / natural / SDXL styles), `describeImage(blob, length, settings)` (short / detailed), `promptFromImage(blob, settings)`. All three send the image as a base64 data URL (`blobToDataUrl` for imports; `httpUrlToDataUrl` to re-encode a ComfyUI `/view?…` URL through the browser, since Venice can't reach the LAN). They stack `disable_thinking: true` + `strip_thinking_response: true` on the standard `venice_parameters` block so reasoning-capable models emit clean tag lists rather than `<think>...</think>` traces, and `include_venice_system_prompt: false` to avoid refusal nudges on NSFW content.

The detail drawer's "Vision model" dropdown is local to the drawer — Settings → AI controls the global default (used by text-only actions), but the Collections panel lets the user pick per-request from `VENICE_VISION_MODELS` (`venice-uncensored-1-2`, `qwen3-vl-235b-a22b`, `mistral-small-2603`, `google-gemma-4-26b-a4b-it`). Results are cached on the underlying `HistoryEntry` or `ImportedImage` via `setItemAi` and persist across reloads. "Add as layers" pipes a tag list into the existing `Layer` system as one positive layer per tag.

CORS: `api.venice.ai` returns `access-control-allow-origin: *`, so all calls go direct from the browser — no proxy, no mixed-content workaround (the API is HTTPS, matching the Traefik-served frontend).

### Keyboard shortcuts

Wired in `hooks/useGlobalShortcuts.ts`, `HistoryPanel`, `FullscreenViewer`, `GenerateButton` — all gated by `isTypingTarget()`:

- `⌘/Ctrl+↵` — generate (`GenerateButton`/`GenerateWidget`, reads `useStore.getState()` in the handler to dodge stale closures)
- `Space` — toggle the fullscreen viewer · `F` — browser fullscreen · `Tab` — cycle the job-routing target (All / each server)
- `←/→` — step the selected history image (and, in the viewer, navigate) · `S` — slideshow toggle (viewer only)
- `Esc` — close the topmost overlay (Collections detail drawer first, then the overlay itself; ComfyOverlay; etc.)

### Canvas size is non-destructive

`InfiniteCanvas` draws the image at its native aspect ratio scaled so its longest edge maps to `workflow.canvasSize` (see `getFootprint()`). Canvas size is purely a display control — it is **not** in the graph, and the saved file keeps its native generation resolution.

### Networking — HTTPS / mixed content

When the page loads over HTTPS (Traefik), `comfyHttpFor/comfyWsFor` switch to `https`/`wss`. ComfyUI only speaks plain HTTP, so Traefik routes (`~/Docker/infra/traefik/data/config.yml`) proxy `comfy*.dev.blueoceanswim.com` → the LAN ComfyUI servers. Server hosts are seeded with those hostnames for that reason — a raw `192.168.0.x:8188` host only works when dev'ing over plain HTTP at `localhost:5173`.

## Gotchas

- **Always rebuild after editing `web/src/`** — `serve.py` serves `index.html` + `assets/`, not the source.
- **`three` is an unused dependency** — the old Three.js renderer was deleted; the canvas is a plain 2D-context controller (`lib/canvasController.ts`). `three` can be dropped from `package.json` whenever convenient.
- **Zustand v5 selector rule**: returning a fresh object literal from a selector (`useStore(s => ({ a, b }))`) creates a new reference every render → excessive re-renders, and combined with derived state in children can trigger React error #185. Select individual properties, or `useShallow`. Derive in `useMemo` over a stable selector.
- **localStorage key versioning**: keys are versioned (`imagelab.workflow.v4`, `imagelab.snippets.v3`, …). State is **global, not per-server** — the old `<base>::<workspaceId>` namespacing scheme is gone, kept only by `migrateLegacyData` for one-time imports of pre-rename data. Bumping a version (e.g. `WORKFLOW_KEY`) is the deliberate mechanism to re-baseline defaults for everyone — old persisted state would otherwise override the new `default…()` values.
- **The build writes into the project root**, not a `dist/` subdir. `emptyOutDir: false` keeps it from deleting `serve.py`, `docker-compose.yml`, etc.; the `build` script clears `../assets/` first.
- **Strict mode double-invokes effects in dev**. The websocket effects inside `useComfyConnection` are idempotent (cleanup closes the WS + sets a stop flag) — preserve that when adding effects.
- **ComfyUI custom-node dependencies**: Auto-Tag Refine needs `WD14Tagger|pysssss`; Remove Background needs `BRIA_RMBG_*`. These only work on servers that have those nodes installed; `setServerInfo` records what each server reports but doesn't fully gate availability, so a misconfigured target will fail at generation time.
- **IndexedDB databases**: three separate DBs are in use — `imagelab` (`jobs` store at v1 in `jobsDb.ts`, plus `civitai-hashes` / `civitai-models` stores at v2 in `civitaiCache.ts`), and `imagelab-imports` (`blobs` store at v1 in `importedDb.ts`). The `imagelab` DB is shared between `jobsDb` and `civitaiCache` — both `openDB` it at their own version. Adding a fourth store there means coordinating the SCHEMA_VERSION + `upgrade` callback across both files, so for fresh stores prefer a new DB name (which is what `importedDb.ts` does).
