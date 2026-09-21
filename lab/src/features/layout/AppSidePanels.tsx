import { LeftPanel } from './LeftPanel';
import { RightPanel } from '@/features/canvasLayers';
import { SidePanel, SidePanelTrigger, BothPanelsTrigger } from './SidePanel';
import { StatusPill } from './StatusPill';
import { QueueButton } from './QueueButton';
import { DownloadsButton } from '@/features/downloads';
import { LEFT_W, RIGHT_W, SIDENAV_W } from './constants';
import { cn } from '@/lib/cn';

interface Props {
  isDesktop: boolean;
  leftOpen: boolean;
  rightOpen: boolean;
  setLeftOpen: (open: boolean) => void;
  setRightOpen: (open: boolean) => void;
}

export function AppSidePanels({ isDesktop, leftOpen, rightOpen, setLeftOpen, setRightOpen }: Props) {
  const anyOpen = leftOpen || rightOpen;
  return (
    <>
      {/* Mobile scrim. A drawer covering most of the screen needs somewhere to tap to
          dismiss it — without one the only way out is the small collapse chevron, and
          taps on what looks like the canvas behind land on the canvas. It sits just
          under the drawer's z-30 and fades rather than popping. */}
      {!isDesktop && (
        <div
          onClick={() => { setLeftOpen(false); setRightOpen(false); }}
          aria-hidden
          className={cn(
            'fixed inset-0 z-20 bg-black/55 transition-opacity duration-200',
            anyOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        />
      )}
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
        mobileLeftOffset={SIDENAV_W}
        header={
          <div className="flex items-center gap-1.5">
            <SidePanelTrigger side="right" open={rightOpen} onClick={() => setRightOpen(false)} />
            {/* "Open both" is a desktop convenience. On a phone the two drawers cannot
                share the width, so offering it only ever produced the overlap. */}
            {isDesktop && (
              <BothPanelsTrigger
                leftOpen={leftOpen}
                rightOpen={rightOpen}
                onChange={(open) => { setLeftOpen(open); setRightOpen(open); }}
              />
            )}
          </div>
        }
      >
        <RightPanel />
      </SidePanel>
    </>
  );
}
