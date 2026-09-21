import { useState } from 'react';
import { PromptStudio } from '@/features/layers/PromptStudio';
import { LibraryDrawer } from '@/features/layers/LibraryDrawer';
import type { LayerKind } from '@/lib/types';
import {
  SamplingSection, GenerationSection, OutputSection,
  PassesSection, UpscaleModelSection, ResizeSection, RemoveBgSection,
} from '@/features/controls/ControlsSections';
import { GenerateButton } from '@/features/generate/GenerateButton';
import { DenoiseField } from '@/features/controls/DenoiseField';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { loadPanelTab, savePanelTab, type PanelTab } from '@/lib/storage';
import { ControlFilterProvider } from '@/features/controls/ControlFilter';
import { InputImageControlSection, ModelsSection } from '@/features/controls/ModelSections';
import { useCanvasStore } from '@/lib/canvasStore';
import { cn } from '@/lib/cn';

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'prompt',     label: 'Prompt' },
  { id: 'parameters', label: 'Parameters' },
  { id: 'post',       label: 'Post' },
];

/**
 * The left params panel. Its body branches on (mainView, activeLayerId):
 *
 *   - mainView='generate'         → global params (no layer concept here)
 *   - mainView='canvas' + layer   → that layer's params (mirrored via the
 *                                   scope-sync subscriber)
 *   - mainView='canvas' + none    → empty state ("select a layer")
 *
 * The pinToGlobal middle state from the previous panel-set system is gone
 * (#41) — in canvas mode, you're either editing the active layer or looking
 * at an empty state; in generate mode, you're editing global.
 */
export function LeftPanel() {
  const [tab, setTabState] = useState<PanelTab>(() => loadPanelTab('prompt'));
  const setTab = (next: PanelTab) => {
    setTabState(next);
    savePanelTab(next);
  };
  const mainView = useCanvasStore(s => s.mainView);
  const activeLayerId = useCanvasStore(s => s.activeLayerId);
  const isLayerScope = mainView === 'canvas' && activeLayerId !== null;
  const isEmptyState = mainView === 'canvas' && activeLayerId === null;
  // Active layer's fillMode drives where the Denoise control surfaces:
  //   - inpaint mode → in the right-panel SelectedLayerSection's inpaint block
  //   - txt2img / img2img → here in the left Parameters panel
  // Eventually this control may also move to a floating widget under the
  // selected layer's bounds on the canvas; DenoiseField is standalone so
  // that's a render-site swap, not a rewrite.
  const layerFillMode = useCanvasStore(s =>
    s.activeLayerId ? s.canvasLayers.find(l => l.id === s.activeLayerId)?.fillMode ?? 'inpaint' : 'inpaint');
  const showDenoiseInPanel = isLayerScope && layerFillMode !== 'inpaint';

  const [libraryOpen, setLibraryOpen] = useState(false);
  // Which side the user pressed "Library" from — primes the modal's default
  // kind toggle so they don't have to switch after opening it.
  const [libraryKind, setLibraryKind] = useState<LayerKind>('positive');

  const openLibrary = (kind: LayerKind) => {
    setLibraryKind(kind);
    setLibraryOpen(true);
  };

  return (
    <div className="relative flex h-full flex-col">
      {/* Generate — pinned to the top of the panel */}
      <div className="shrink-0 border-b border-border-subtle bg-bg-panel px-3.5 py-3.5">
        <GenerateButton />
      </div>
      {isLayerScope && <ActiveLayerBar />}

      {isEmptyState ? (
        <EmptyState />
      ) : (
        <>
          <div role="tablist" className="flex shrink-0 items-stretch border-b border-border-subtle bg-bg-panel">
            {TABS.map(t => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'relative flex-1 px-3 py-3 text-[12px] font-medium transition-colors',
                  'min-h-[44px]', // touch target
                  tab === t.id
                    ? 'text-fg-primary'
                    : 'text-fg-muted hover:text-fg-secondary',
                )}
              >
                {t.label}
                {tab === t.id && (
                  <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-t-full bg-accent" />
                )}
              </button>
            ))}
          </div>
          <div className="scroll-y min-h-0 flex-1 overflow-x-hidden px-3.5 py-3.5 flex flex-col gap-[18px]">
            {tab === 'prompt' && (
              <PromptStudio onOpenLibrary={openLibrary} />
            )}
            {tab === 'parameters' && (
              <ControlFilterProvider>
                {/* InputImageSection is a global img2img upload — meaningless in
                    layer scope, where attached pixels on the layer itself are
                    the source. Hide it there to keep the panel focused. */}
                {!isLayerScope && <InputImageControlSection />}
                {/* Inpaint controls moved to the right-panel "Selected layer"
                    section, conditionally rendered when fillMode === 'inpaint'. */}
                <ModelsSection />
                <SamplingSection />
                {/* In layer scope the standalone DenoiseField below owns
                    the user-facing denoise; hide GenerationSection's own
                    Denoise to avoid two controls fighting for attention. */}
                <GenerationSection showDenoise={!isLayerScope} />
                {showDenoiseInPanel && <DenoiseField />}
                {/* OutputSection only shown out of layer scope. In layer scope
                    the layer's bounds drive output size and there's nothing to
                    show here. */}
                {!isLayerScope && <OutputSection />}
              </ControlFilterProvider>
            )}
            {tab === 'post' && (
              <ControlFilterProvider>
                {/* Passes are skipped by the inpaint pipeline (the stitch
                    step is gated off when any extra pass exists), so hide
                    in layer mode to avoid silently breaking the wash-out
                    fix. Upscale + Remove BG are independent and stay. */}
                {!isLayerScope && <ErrorBoundary label="Passes"><PassesSection /></ErrorBoundary>}
                <ErrorBoundary label="Upscale Model"><UpscaleModelSection /></ErrorBoundary>
                <ErrorBoundary label="Resize"><ResizeSection /></ErrorBoundary>
                <ErrorBoundary label="Remove Background"><RemoveBgSection /></ErrorBoundary>
              </ControlFilterProvider>
            )}
          </div>
        </>
      )}

      <LibraryDrawer
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        initialKind={libraryKind}
      />
    </div>
  );
}

/** Thin status strip between the Generate button and the tabs. Shows the
 *  active layer's name as a "you are editing this" reminder. The previous
 *  pin-to-global toggle is gone (#41); in infinite mode you're always
 *  editing the selected layer. */
function ActiveLayerBar() {
  const activeLayerName = useCanvasStore(s =>
    s.activeLayerId ? s.canvasLayers.find(l => l.id === s.activeLayerId)?.name : null);
  if (!activeLayerName) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-bg-panel/60 px-3.5 py-1.5 text-[10.5px]">
      <span className="truncate font-medium text-accent">
        Editing: {activeLayerName}
      </span>
    </div>
  );
}

/** Shown in infinite mode when no layer is selected — the panel has no
 *  workflow to edit. Generates is disabled by GenerateButton in this state. */
function EmptyState() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 py-12 text-center text-[12px] text-fg-muted">
      <div className="text-[13px] font-medium text-fg-secondary">No layer selected</div>
      <div>Click a layer on the canvas or in the Layers panel to edit its params.</div>
    </div>
  );
}
