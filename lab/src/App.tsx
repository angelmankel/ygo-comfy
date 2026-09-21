import { useState } from 'react';
import { Sidebar } from '@/features/layout/Sidebar';
import { SettingsModal } from '@/features/settings/SettingsModal';
import { ModelMetadataModal } from '@/features/model-metadata';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { ConfirmProvider } from '@/components/ui/ConfirmDialog';
import { CanvasContext } from '@/lib/canvasContext';
import { MainView } from '@/features/layout/MainView';
import { ComfyLayer } from '@/features/comfy/ComfyLayer';
import { LEFT_W, RIGHT_W } from '@/features/layout/constants';
import { useStore } from '@/lib/store';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useMobilePanels } from '@/hooks/useMobilePanels';
import { useComfyConnection } from '@/hooks/useComfyConnection';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import { useModelHashes } from '@/hooks/useModelHashes';
import { useDownloads } from '@/hooks/useDownloads';
import { useServerFavorites } from '@/hooks/useServerFavorites';
import { useThemeEffect } from '@/hooks/useThemeEffect';
import { useViewSwitching } from '@/hooks/useViewSwitching';
import { useCanvasControllerProvider } from '@/hooks/useCanvasControllerProvider';

export default function App() {
  const canvas = useCanvasControllerProvider();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const servers = useStore(s => s.servers);

  const isDesktop = useIsDesktop();
  const { leftOpen, rightOpen, setLeftOpen, setRightOpen } = useMobilePanels(isDesktop);

  // Connection + global keyboard shortcuts + theme application all live in hooks.
  useComfyConnection();
  useGlobalShortcuts();
  useModelHashes();
  useDownloads();
  useServerFavorites();
  useThemeEffect();

  const { mainView, viewKey, isSwitching } = useViewSwitching();

  // Insets for the TopNav so it always sits in the visible area between the
  // two floating side panels, never beneath an open overlay. The +8 accounts
  // for the panel's 8px outer gutter (matches the TopNav's own p-2) so the
  // bar lines up with the panel's outer edge rather than sliding under it.
  const desktopLeftInset = isDesktop && leftOpen ? LEFT_W + 8 : 0;
  const desktopRightInset = isDesktop && rightOpen ? RIGHT_W + 8 : 0;

  return (
    <CanvasContext.Provider value={canvas.value}>
      <ConfirmProvider>
      <TooltipProvider>
        <div
          className="relative flex h-[100dvh] w-screen overflow-hidden bg-bg-base text-fg-secondary touch-pan-y"
          style={{ overscrollBehavior: 'none' }}
        >
          <Sidebar servers={servers} onOpenSettings={() => setSettingsOpen(true)} />

          {/* CENTER — canvas fills all remaining width. Side panels are
              absolutely-positioned overlays inside this <main>, so toggling
              them never resizes the canvas. */}
          <main className="relative h-[100dvh] flex-1 overflow-hidden bg-bg-base">
            {/* Indeterminate progress sweep — only visible briefly after a
                view switch. Sits above the fading content so the user gets
                feedback that something is in motion even before the new
                view paints. */}
            {isSwitching && (
              <div className="pointer-events-none absolute inset-x-0 top-0 z-40 h-0.5 overflow-hidden bg-accent/10">
                <div className="animate-view-loading h-full w-1/3 bg-gradient-to-r from-transparent via-accent to-transparent" />
              </div>
            )}
            {/* Outside the keyed wrapper on purpose: anything inside it is rebuilt on every
                view switch, and rebuilding ComfyUI is the thing this exists to stop. */}
            <ComfyLayer />
            <div key={viewKey} className="animate-view-in absolute inset-0">
              <MainView
                mainView={mainView}
                isDesktop={isDesktop}
                leftOpen={leftOpen}
                rightOpen={rightOpen}
                setLeftOpen={setLeftOpen}
                setRightOpen={setRightOpen}
                desktopLeftInset={desktopLeftInset}
                desktopRightInset={desktopRightInset}
              />
            </div>
          </main>

          {/* The mobile backdrop used to live here, outside <main>. It could never work from
              here: the panels render inside MainView's `animate-view-in` wrapper, whose
              animation creates a stacking context, so their z-30 is trapped inside it and a
              z-20 sibling of <main> paints above the whole subtree. The backdrop covered the
              open drawer, and every tap on a control closed the drawer instead. It now lives
              in AppSidePanels, next to the panels it belongs to, where the z-order is real. */}
        </div>
        <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
        <ErrorBoundary label="Model metadata">
          <ModelMetadataModal />
        </ErrorBoundary>
      </TooltipProvider>
      </ConfirmProvider>
    </CanvasContext.Provider>
  );
}
