import { Logo } from '@/components/Logo';
import { IconButton } from '@/components/ui/IconButton';
import { Tip } from '@/components/ui/Tooltip';
import {
  CollectionsIcon,
  ComfyIcon,
  GenerateIcon,
  InfiniteViewIcon,
  ModelBrowserIcon,
  SettingsIcon,
  SparkleIcon,
} from '@/components/ui/icons';
import { useCanvasStore } from '@/lib/canvasStore';
import { useFocusMode } from '@/features/studio/StudioView';
import type { MainView } from '@/lib/canvasStore';
import type { Server } from '@/lib/storage';

/**
 * Slim left rail — the app's primary navigation. Buttons are typed:
 *
 *   - `view`  — switches `mainView` in canvasStore. Shows an active treatment
 *               when its view is current.
 *   - `modal` — opens a focused overlay (Settings, ComfyUI iframe) without
 *               leaving the current view.
 *
 * The rail is always visible and rendered above overlays so users can switch
 * back without exiting first.
 */
export function Sidebar({
  servers,
  onOpenSettings,
}: {
  servers: Server[];
  onOpenSettings: () => void;
}) {
  const mainView = useCanvasStore((s) => s.mainView);
  const setMainView = useCanvasStore((s) => s.setMainView);
  const comfyServerId = useCanvasStore((s) => s.comfyServerId);
  const setComfyServerId = useCanvasStore((s) => s.setComfyServerId);
  const openComfyServer = (id: string) => {
    setComfyServerId(id);
    setMainView('comfy');
  };

  // Focus mode is Studio's promise: no node graph unless you ask for one. It hides the per-server
  // ComfyUI buttons, and it is always on for a phone.
  const focusMode = useFocusMode();

  return (
    <nav className="relative z-[70] flex h-full w-[52px] shrink-0 flex-col items-center gap-3 border-r border-border-subtle bg-bg-panel py-3">
      {/* App logo */}
      <Tip label="ImageLab" side="right">
        <button
          type="button"
          aria-label="ImageLab"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg outline-none"
        >
          <Logo size={28} className="shrink-0 drop-shadow-[0_0_8px_rgba(47,107,98,0.5)]" />
        </button>
      </Tip>

      {/* Primary views */}
      <div className="mt-1 flex w-full flex-col items-center gap-1.5 border-t border-border-subtle pt-3">
        <ViewButton
          view="generate"
          current={mainView}
          onSelect={setMainView}
          label="Generate"
          icon={<GenerateIcon size={16} />}
        />
        <ViewButton
          view="canvas"
          current={mainView}
          onSelect={setMainView}
          label="Infinite canvas"
          icon={<InfiniteViewIcon size={16} />}
        />
        <ViewButton
          view="collections"
          current={mainView}
          onSelect={setMainView}
          label="Collections"
          icon={<CollectionsIcon size={16} />}
        />
        <ViewButton
          view="browser"
          current={mainView}
          onSelect={setMainView}
          label="Browse models"
          icon={<ModelBrowserIcon size={16} />}
        />
        <ViewButton
          view="studio"
          current={mainView}
          onSelect={setMainView}
          label="Studio"
          icon={<SparkleIcon size={16} />}
        />
      </div>

      {/* One ComfyUI button per server — each is a view switcher
          (mainView='comfy' + the server's id). Active treatment when this
          server's ComfyUI is the current view. */}
      {servers.length > 0 && !focusMode && (
        <div className="mt-1 flex w-full flex-col items-center gap-1.5 border-t border-border-subtle pt-3">
          {servers.map((s, i) => {
            const active = mainView === 'comfy' && comfyServerId === s.id;
            return (
              <ActiveRail key={s.id} active={active}>
                <Tip label={`ComfyUI — ${s.name} (${s.host})`} side="right">
                  <IconButton
                    aria-label={`Open ComfyUI for ${s.name}`}
                    aria-current={active ? 'page' : undefined}
                    state={active ? 'on' : 'off'}
                    onClick={() => openComfyServer(s.id)}
                    className="relative"
                  >
                    <ComfyIcon size={15} />
                    <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-accent px-0.5 text-[8px] font-bold leading-none text-white">
                      {i + 1}
                    </span>
                  </IconButton>
                </Tip>
              </ActiveRail>
            );
          })}
        </div>
      )}

      <div className="flex-1" />

      <Tip label="Settings" side="right">
        <IconButton aria-label="Settings" onClick={onOpenSettings}>
          <SettingsIcon size={15} />
        </IconButton>
      </Tip>
    </nav>
  );
}

function ViewButton({
  view,
  current,
  onSelect,
  label,
  icon,
}: {
  view: MainView;
  current: MainView;
  onSelect: (v: MainView) => void;
  label: string;
  icon: React.ReactNode;
}) {
  const active = current === view;
  return (
    <ActiveRail active={active}>
      <Tip label={label} side="right">
        <IconButton
          aria-label={label}
          aria-current={active ? 'page' : undefined}
          state={active ? 'on' : 'off'}
          onClick={() => onSelect(view)}
        >
          {icon}
        </IconButton>
      </Tip>
    </ActiveRail>
  );
}

/** Adds a 3px accent bar pinned to the rail's left edge for the active
 *  button — same idea as VS Code's activity bar. Pairs with the IconButton's
 *  on-state fill so the active item reads at a glance. */
function ActiveRail({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div className="relative flex w-full items-center justify-center">
      <span
        aria-hidden
        className={`pointer-events-none absolute left-0 h-7 w-[3px] rounded-r-full bg-accent transition-opacity duration-150 ${active ? 'opacity-100' : 'opacity-0'}`}
      />
      {children}
    </div>
  );
}
