import { LeftPanel } from './LeftPanel';
import { RightPanel } from '@/features/canvasLayers';
import { SidePanel, SidePanelTrigger, BothPanelsTrigger } from './SidePanel';
import { StatusPill } from './StatusPill';
import { QueueButton } from './QueueButton';
import { DownloadsButton } from '@/features/downloads';
import { LEFT_W, RIGHT_W, SIDENAV_W } from './constants';

interface Props {
  isDesktop: boolean;
  leftOpen: boolean;
  rightOpen: boolean;
  setLeftOpen: (open: boolean) => void;
  setRightOpen: (open: boolean) => void;
}

export function AppSidePanels({ isDesktop, leftOpen, rightOpen, setLeftOpen, setRightOpen }: Props) {
  return (
    <>
      <SidePanel
        side="left"
        open={leftOpen}
        isDesktop={isDesktop}
        width={LEFT_W}
        mobileLeftOffset={SIDENAV_W}
        header={
          <div className="flex items-center justify-between gap-2">
            <StatusPill />
            <div className="flex items-center gap-1.5">
              <QueueButton />
              <DownloadsButton />
              <SidePanelTrigger side="left" open={leftOpen} onClick={() => setLeftOpen(false)} />
            </div>
          </div>
        }
      >
        <LeftPanel />
      </SidePanel>
      <SidePanel
        side="right"
        open={rightOpen}
        isDesktop={isDesktop}
        width={RIGHT_W}
        header={
          <div className="flex items-center gap-1.5">
            <SidePanelTrigger side="right" open={rightOpen} onClick={() => setRightOpen(false)} />
            <BothPanelsTrigger
              leftOpen={leftOpen}
              rightOpen={rightOpen}
              onChange={(open) => { setLeftOpen(open); setRightOpen(open); }}
            />
          </div>
        }
      >
        <RightPanel />
      </SidePanel>
    </>
  );
}
