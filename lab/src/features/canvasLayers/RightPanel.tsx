import { useEffect, useState } from 'react';
import { HistoryPanel } from '@/features/history/HistoryPanel';
import { CanvasLayersPanel } from './CanvasLayersPanel';
import { useCanvasStore } from '@/lib/canvasStore';
import { cn } from '@/lib/cn';

const RIGHT_PANEL_TAB_KEY = 'imagelab.rightPanelTab.v1';

type RightTab = 'layers' | 'history';
const TABS: { id: RightTab; label: string }[] = [
  { id: 'layers',  label: 'Layers'  },
  { id: 'history', label: 'History' },
];

function loadTab(): RightTab {
  try {
    const v = localStorage.getItem(RIGHT_PANEL_TAB_KEY);
    if (v === 'layers' || v === 'history') return v;
  } catch { /* ignore */ }
  return 'history';
}

function saveTab(t: RightTab) {
  try { localStorage.setItem(RIGHT_PANEL_TAB_KEY, t); } catch { /* ignore */ }
}

/**
 * Tabbed right-panel shell: Layers (canvas-compositor list) / History
 * (existing per-server history). Mirrors `LeftPanel`'s segmented-control
 * visual language so both side panels feel like the same family.
 */
export function RightPanel() {
  const mainView = useCanvasStore(s => s.mainView);
  const visibleTabs = mainView === 'canvas' ? TABS : TABS.filter(t => t.id !== 'layers');

  const [tab, setTabState] = useState<RightTab>(() => loadTab());
  const setTab = (next: RightTab) => {
    setTabState(next);
    saveTab(next);
  };

  // Force History tab whenever Layers isn't available (generate view).
  useEffect(() => {
    if (!visibleTabs.some(t => t.id === tab)) setTabState('history');
  }, [visibleTabs, tab]);

  const activeTab: RightTab = visibleTabs.some(t => t.id === tab) ? tab : 'history';
  const showTablist = visibleTabs.length > 1;

  return (
    <div className="flex h-full flex-col">
      {showTablist && (
      <div role="tablist" className="flex shrink-0 items-stretch border-b border-border-subtle bg-bg-panel">
        {visibleTabs.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'relative flex-1 px-3 py-3 text-[12px] font-medium transition-colors',
              'min-h-[44px]', // touch target
              activeTab === t.id ? 'text-fg-primary' : 'text-fg-muted hover:text-fg-secondary',
            )}
          >
            {t.label}
            {activeTab === t.id && (
              <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-t-full bg-accent" />
            )}
          </button>
        ))}
      </div>
      )}
      <div className="min-h-0 flex-1">
        {activeTab === 'layers'  && <CanvasLayersPanel />}
        {activeTab === 'history' && (
          <HistoryPanel
            tileClickMode={mainView === 'canvas' ? 'open-immediately' : 'select-then-open'}
          />
        )}
      </div>
    </div>
  );
}
