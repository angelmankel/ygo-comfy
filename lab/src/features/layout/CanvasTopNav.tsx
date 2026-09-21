import { useCanvas } from '@/lib/canvasContext';
import { useCanvasStore } from '@/lib/canvasStore';
import { IconButton } from '@/components/ui/IconButton';
import { FitViewIcon } from '@/components/ui/icons';
import { GenerateWidget } from '@/features/generate/GenerateWidget';
import { CanvasToolsMenu } from '@/features/canvasLayers/CanvasToolsMenu';
import { TopNav } from './TopNav';
import { SidePanelTrigger, BothPanelsTrigger } from './SidePanel';
import {
  AutoFrameToggle,
  CanvasDeleteShortcut,
  ClearCanvasButton,
  GridSnapToggle,
  MaskVisibilityToggle,
  SelectionInfo,
} from '@/features/canvas/CanvasTopNavControls';
import { NAV_HEIGHT, TOOLBAR_TRANSITION } from './constants';

interface Props {
  isDesktop: boolean;
  leftOpen: boolean;
  rightOpen: boolean;
  setLeftOpen: (open: boolean) => void;
  setRightOpen: (open: boolean) => void;
  leftInset: number;
  rightInset: number;
}

export function CanvasTopNav({ isDesktop, leftOpen, rightOpen, setLeftOpen, setRightOpen, leftInset, rightInset }: Props) {
  const { controller } = useCanvas();
  return (
    <TopNav
      leftInset={leftInset}
      rightInset={rightInset}
      insetTransition={TOOLBAR_TRANSITION}
      left={
        <>
          <CanvasDeleteShortcut />
          {!leftOpen && (
            <SidePanelTrigger side="left" open={leftOpen} onClick={() => setLeftOpen(true)} />
          )}
          {isDesktop && !leftOpen && <GenerateWidget />}
          <IconButton
            aria-label="Fit to view"
            title="Fit to view (active layer if selected, else all)"
            onClick={() => {
              const activeId = useCanvasStore.getState().activeLayerId;
              if (activeId) controller?.fitLayerToViewport(activeId, NAV_HEIGHT);
              else controller?.fitToViewport(NAV_HEIGHT);
            }}
          >
            <FitViewIcon size={16} />
          </IconButton>
          <CanvasToolsMenu />
          <ClearCanvasButton />
          <SelectionInfo />
        </>
      }
      right={
        <>
          <GridSnapToggle />
          <MaskVisibilityToggle />
          <AutoFrameToggle />
          {!rightOpen && (
            <SidePanelTrigger side="right" open={rightOpen} onClick={() => setRightOpen(true)} />
          )}
          {!leftOpen && !rightOpen && (
            <BothPanelsTrigger
              leftOpen={leftOpen}
              rightOpen={rightOpen}
              onChange={(open) => { setLeftOpen(open); setRightOpen(open); }}
            />
          )}
        </>
      }
    />
  );
}
