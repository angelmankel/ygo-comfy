import { ErrorBoundary } from '@/components/ErrorBoundary';
import { InfiniteCanvas } from '@/features/canvas/InfiniteCanvas';
import { StrippedCanvas } from '@/features/canvas/StrippedCanvas';
import { BrushCursor } from '@/features/canvas/BrushCursor';
import { CanvasToolbar } from '@/features/canvas/CanvasToolbar';
import { CollectionsView } from '@/features/collections';
import { ModelBrowserView } from '@/features/browser';
import { ComfyView } from '@/features/comfy/ComfyView';
import { AppSidePanels } from './AppSidePanels';
import { CanvasTopNav } from './CanvasTopNav';
import { GenerateTopNav } from './GenerateTopNav';
import { LEFT_W, NAV_HEIGHT, RIGHT_W, TOOLBAR_TRANSITION } from './constants';

interface Props {
  mainView: string;
  isDesktop: boolean;
  leftOpen: boolean;
  rightOpen: boolean;
  setLeftOpen: (open: boolean) => void;
  setRightOpen: (open: boolean) => void;
  desktopLeftInset: number;
  desktopRightInset: number;
}

export function MainView({
  mainView,
  isDesktop,
  leftOpen,
  rightOpen,
  setLeftOpen,
  setRightOpen,
  desktopLeftInset,
  desktopRightInset,
}: Props) {
  if (mainView === 'collections') {
    return (
      <ErrorBoundary label="Collections panel">
        <CollectionsView />
      </ErrorBoundary>
    );
  }
  if (mainView === 'browser') {
    return (
      <ErrorBoundary label="Model browser">
        <ModelBrowserView />
      </ErrorBoundary>
    );
  }
  if (mainView === 'comfy') {
    return (
      <ErrorBoundary label="ComfyUI">
        <ComfyView />
      </ErrorBoundary>
    );
  }

  const leftInset = isDesktop && leftOpen ? LEFT_W : 0;
  const rightInset = isDesktop && rightOpen ? RIGHT_W : 0;
  const panelProps = { isDesktop, leftOpen, rightOpen, setLeftOpen, setRightOpen };

  return (
    <>
      {mainView === 'canvas' ? (
        <InfiniteCanvas navOffset={NAV_HEIGHT} leftInset={leftInset} rightInset={rightInset} />
      ) : (
        <StrippedCanvas navOffset={NAV_HEIGHT} leftInset={leftInset} rightInset={rightInset} />
      )}

      <AppSidePanels {...panelProps} />

      {/* Top toolbar — same shell on both main views, but the right-slot
          content swaps to match what each view can actually act on. Canvas
          owns the compositor controls (grid snap, auto-frame); generate owns
          the history controls (recall the last params, peek at metadata). */}
      {mainView === 'canvas' && (
        <CanvasTopNav {...panelProps} leftInset={desktopLeftInset} rightInset={desktopRightInset} />
      )}
      {mainView === 'generate' && (
        <GenerateTopNav {...panelProps} leftInset={desktopLeftInset} rightInset={desktopRightInset} />
      )}

      {/* Floating canvas-tools palette — clears the LeftPanel overlay
          via `desktopLeftInset`. Hidden in generate mode by the
          component itself. */}
      <div
        className="pointer-events-none absolute z-10"
        style={{
          top: NAV_HEIGHT,
          left: desktopLeftInset + 12,
          transition: TOOLBAR_TRANSITION,
        }}
      >
        <CanvasToolbar />
      </div>
      <BrushCursor />
    </>
  );
}
