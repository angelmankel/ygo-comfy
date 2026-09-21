import { IconButton } from '@/components/ui/IconButton';
import { FullscreenIcon, InfoIcon } from '@/components/ui/icons';
import { GenerateWidget } from '@/features/generate/GenerateWidget';
import { GenerateNavActions } from '@/features/generate/GenerateNavActions';
import { RecallButton } from './RecallButton';
import { DownloadSelectedButton } from './DownloadSelectedButton';
import { TopNav } from './TopNav';
import { SidePanelTrigger, BothPanelsTrigger } from './SidePanel';
import { TOOLBAR_TRANSITION } from './constants';
import { useStore } from '@/lib/store';

interface Props {
  isDesktop: boolean;
  leftOpen: boolean;
  rightOpen: boolean;
  setLeftOpen: (open: boolean) => void;
  setRightOpen: (open: boolean) => void;
  leftInset: number;
  rightInset: number;
}

export function GenerateTopNav({ isDesktop, leftOpen, rightOpen, setLeftOpen, setRightOpen, leftInset, rightInset }: Props) {
  const openViewer = useStore(s => s.openViewer);
  const selectedEntry = useStore(s => s.selectedEntry);
  const hasHistory = useStore(s => s.history.length > 0);
  const disabled = !selectedEntry && !hasHistory;
  return (
    <TopNav
      leftInset={leftInset}
      rightInset={rightInset}
      insetTransition={TOOLBAR_TRANSITION}
      left={
        <>
          {!leftOpen && (
            <SidePanelTrigger side="left" open={leftOpen} onClick={() => setLeftOpen(true)} />
          )}
          {isDesktop && !leftOpen && <GenerateWidget />}
        </>
      }
      right={
        <>
          <GenerateNavActions />
          <RecallButton />
          <DownloadSelectedButton />
          <IconButton
            aria-label="Open image info"
            title="Open the selected image with its details"
            onClick={() => openViewer({ withInfo: true })}
            disabled={disabled}
            className="disabled:cursor-not-allowed disabled:opacity-40"
          >
            <InfoIcon size={16} />
          </IconButton>
          <IconButton
            aria-label="View image fullscreen"
            title="View image fullscreen (Space)"
            onClick={() => openViewer()}
            disabled={disabled}
            className="disabled:cursor-not-allowed disabled:opacity-40"
          >
            <FullscreenIcon size={16} />
          </IconButton>
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
