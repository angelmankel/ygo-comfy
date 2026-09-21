# Ticket #19 — PixiJS render-loop spike report

Throw-away prototype. Do not merge. See "Cleanup checklist" at the bottom.

## What was built

| File | Purpose | LOC |
|---|---|---|
| `web/src/spike/PixiSpike.tsx` | Standalone spike (UI + both renderers + shared input wiring) | ~390 |
| `web/src/main.tsx` | +3 lines to mount `<PixiSpike />` when `?spike=pixi` is present | +3 |

No new runtime dependencies (Pixi was already installed). URL: `http://localhost:5173/?spike=pixi`.

Features:
- Renderer toggle (full unmount/remount between Pixi and 2D canvas).
- Sprite count slider 1–100.
- Procedural 2048×2048 source bitmap (no network dependency).
- Pan / wheel-zoom-toward-cursor / pinch / release-momentum (reuses `runInertia` from `lib/momentum.ts`).
- HUD: smoothed 30-frame FPS @ 200ms cadence, sprite count, current renderer, zoom level.
- Throw button: imparts strong random-direction velocity for quick momentum stress-test.

Both renderers share `attachInput()` + the same `viewRef`, so any FPS gap is attributable to the renderer alone.

## PixiJS v8 gotchas

1. `Texture.from(canvas)` is fine for already-loaded sources; only URLs require `Assets.load`.
2. `new Application()` takes **no args**; all config goes to async `app.init({...})`. Touch `app.canvas` only after init resolves.
3. `app.view` → `app.canvas`.
4. `app.destroy(rendererOpts, stageOpts)` — two args. For repeat mount/unmount in the same tab, pass `releaseGlobalResources: true` or you get flicker.
5. Don't destroy a `Texture` you plan to reuse across re-mounts (set `texture: false, textureSource: false` on stage destroy).
6. **Top-level `await` broke the Vite build** — esbuild target includes `chrome87`/`firefox78`/`safari14`. Switched the spike mount from `await import` to a static import.
7. `SpriteOptions.scale` accepts a uniform number directly; same for `anchor`. No need for `.set()` after construction.
8. HiDPI is handled by `resolution: devicePixelRatio` + `autoDensity: true`. CSS px stays correct.
9. React StrictMode double-mount: guard `mountPixi().then(teardown)` with a `cancelled` flag so a late resolution calls `teardown()` instead of leaking.

## Measurement protocol

1. `cd web && npm run dev`, open `http://localhost:5173/?spike=pixi` in Chromium.
2. DevTools → More tools → Performance monitor (track JS heap + CPU). Optional: Rendering → Frame Rendering Stats.
3. For each N in {20, 50, 100} × each renderer, record:
   - **Idle** (no input, 5s): HUD FPS.
   - **Slow pan** (drag in circles 5s): sustained FPS.
   - **Throw** (click Throw button, watch momentum): minimum FPS during decay.
   - **Zoom** (wheel in to ~4× and back): any judder.
   - **Memory** (after 30s activity): JS heap MB.
4. Toggle renderer 5× and take a heap snapshot before/after to verify Pixi isn't leaking.

Suggested grid:

```
N=20   PixiJS: idle ?, pan ?, throw-min ?, heap ?     Canvas: ...
N=50   ...
N=100  ...
```

## Concerns surfaced

- **Text rendering** — Pixi `Text` snapshots are cheap to draw but expensive to mutate. For real migration, use DOM for HUDs that change every frame; `BitmapText` for dynamic labels in-canvas.
- **devicePixelRatio changes** — neither this spike nor the current controller re-handles DPR changes (e.g. external monitor plug). Easy to wire (`renderer.resolution = ...; app.queueResize()`).
- **Real workload is decode/upload, not draw calls** — ComfyUI returns multi-MB PNGs; the spike's shared 2048² source doesn't exercise texture uploads. Before committing fully, redo measurements with distinct multi-MB images per sprite.
- **Bundle cost** — Pixi adds ~250 KB gz to the main chunk (full build went from ~204 KB gz → ~245 KB gz). Code-split when proceeding.
- **API fit is clean** — v8 maps well onto the current canvas controller's structure (one world container, view ref, per-frame draw). Mechanical migration.

## Cleanup checklist

1. `rm -rf web/src/spike/`
2. Revert `web/src/main.tsx` to:

   ```tsx
   import { StrictMode } from 'react';
   import { createRoot } from 'react-dom/client';
   import App from './App';
   import './styles/index.css';

   createRoot(document.getElementById('root')!).render(
     <StrictMode>
       <App />
     </StrictMode>,
   );
   ```

3. `cd web && npm run build` to verify nothing else references the spike.
4. If not proceeding with the migration: `npm uninstall pixi.js`.

No other files were touched.
