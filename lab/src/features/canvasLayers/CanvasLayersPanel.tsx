import { useState, useEffect, useMemo, useRef } from 'react';
import { useCollapsed } from '@/hooks/useCollapsed';
import { canvasStorage } from '@/lib/canvasStorageInstance';
import { getCanvasController } from '@/lib/canvasContext';
import { blobToDisplayUrl } from '@/lib/brush/pibr';
import type { LayerHistoryEntry } from '@/lib/types';
import {
  DndContext, PointerSensor, useSensor, useSensors,
  closestCenter, useDroppable, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import * as RPopover from '@radix-ui/react-popover';
import type { CanvasLayer } from '@/lib/types';
import { useCanvasStore } from '@/lib/canvasStore';
import { RESOLUTION_PRESETS } from '@/lib/storage';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import {
  PlusIcon, EyeIcon, EyeSlashIcon, EraserIcon, LockIcon, LockOpenIcon, CloseIcon,
  ImagePlaceholderIcon, CopyIcon, CameraIcon, ChevronDownIcon, ChevronRightIcon,
  FolderIcon, FolderOpenIcon,
} from '@/components/ui/icons';
import { InpaintSection } from '@/features/inputImage';
import { cn } from '@/lib/cn';
import { useLayerSelectedThumb } from '@/hooks/useLayerSelectedThumb';
import { snapshotLayerComposite } from './snapshotLayer';

// Most-recently-used layer ids to surface as "Recents" in the add-layer
// popover (#41 follow-up). Module-local because it never needs to survive
// reloads — the source list is sorted by zIndex anyway, recents are just a
// soft pin within a single session.
const recentSourceIds: string[] = [];
function bumpRecent(id: string) {
  const idx = recentSourceIds.indexOf(id);
  if (idx >= 0) recentSourceIds.splice(idx, 1);
  recentSourceIds.unshift(id);
  while (recentSourceIds.length > 2) recentSourceIds.pop();
}

/**
 * Right-panel "Layers" tab — Photoshop-style list of canvas-compositor layers.
 *
 * Index mapping note: `canvasStore.canvasLayers` is sorted ascending by
 * `zIndex` (top of the stack = LAST element). We render the panel reversed so
 * the visually-top row is the highest-zIndex layer. Whenever we hand indexes
 * back to `reorderCanvasLayers`, we convert from display-index (top=0) to
 * store-index via `storeIdx = layers.length - 1 - displayIdx`.
 */
export function CanvasLayersPanel() {
  const layers = useCanvasStore(s => s.canvasLayers);
  const activeId = useCanvasStore(s => s.activeLayerId);
  const hydrated = useCanvasStore(s => s.canvasLayersHydrated);
  const addCanvasLayer = useCanvasStore(s => s.addCanvasLayer);
  const reorderCanvasLayers = useCanvasStore(s => s.reorderCanvasLayers);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  // Build a tree: top-level entries (sorted highest-zIndex first), with
  // folder children rendered nested. Children also sort by zIndex desc.
  // Display list (flat, for SortableContext) still needs every id so dnd-kit
  // can match drop targets.
  const setLayerParent = useCanvasStore(s => s.setLayerParent);
  const addCanvasFolder = useCanvasStore(s => s.addCanvasFolder);
  type Tree = { layer: CanvasLayer; children: CanvasLayer[] }[];
  const tree: Tree = useMemo(() => {
    const sorted = [...layers].sort((a, b) => b.zIndex - a.zIndex);
    const topLevel = sorted.filter(l => !l.parentId);
    return topLevel.map(l => ({
      layer: l,
      children: l.isFolder
        ? sorted.filter(c => c.parentId === l.id)
        : [],
    }));
  }, [layers]);
  const flatIds = useMemo(() => {
    const out: string[] = [];
    for (const node of tree) {
      out.push(node.layer.id);
      for (const child of node.children) out.push(child.id);
    }
    return out;
  }, [tree]);

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const activeId = String(e.active.id);
    const overId = String(e.over.id);

    // Drop-into-folder zone uses id "folder-zone:<folderId>".
    if (overId.startsWith('folder-zone:')) {
      const folderId = overId.slice('folder-zone:'.length);
      setLayerParent(activeId, folderId);
      return;
    }
    // Drop into the top-level root zone.
    if (overId === 'root-zone') {
      setLayerParent(activeId, null);
      return;
    }

    // Sort-style drop on another layer: reuse existing reorder. If the over
    // target sits in a different parent, re-parent first.
    const activeLayer = layers.find(l => l.id === activeId);
    const overLayer = layers.find(l => l.id === overId);
    if (!activeLayer || !overLayer) return;
    if (activeLayer.isFolder) {
      // Folders can only re-order at the root level. No drop into other folders.
      if (overLayer.parentId) return;
    } else if (activeLayer.parentId !== overLayer.parentId) {
      setLayerParent(activeId, overLayer.parentId ?? null);
    }
    // Reorder by store-index (ascending zIndex). Convert from flat display id.
    const fromStore = layers.findIndex(l => l.id === activeId);
    const toStore = layers.findIndex(l => l.id === overId);
    if (fromStore < 0 || toStore < 0) return;
    reorderCanvasLayers(fromStore, toStore);
  };

  const addCanvasLayerFromSource = useCanvasStore(s => s.addCanvasLayerFromSource);
  const handleAdd = (sourceId?: string) => {
    if (sourceId) {
      const id = addCanvasLayerFromSource(sourceId);
      if (id) bumpRecent(sourceId);
    } else {
      addCanvasLayer({});
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Sticky header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-bg-panel px-3.5 py-3">
        <span className="text-[10px] font-semibold uppercase tracking-section text-fg-dim">
          Layers
        </span>
        <span className="rounded bg-bg-elev px-1.5 py-0.5 text-[10px] font-medium text-fg-muted">
          {layers.length}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <DefaultSizePicker />
          <button
            type="button"
            onClick={() => addCanvasFolder()}
            title="Add a group/folder"
            aria-label="Add a group"
            className="flex h-9 items-center gap-1 rounded-lg border border-border-default bg-bg-elev px-2 text-[12px] font-medium text-fg-tertiary transition-colors hover:border-border-strong hover:text-fg-secondary"
          >
            <FolderIcon size={13} />
          </button>
          <AddLayerButton onAdd={handleAdd} />
        </div>
      </div>

      {/* Scrollable body — SelectedLayerSection is inside the scroll container
          (not above it) so its inpaint knobs don't squeeze the layer list off
          the bottom on short viewports. The whole panel scrolls as one. */}
      <div className="scroll-y min-h-0 flex-1 overflow-x-hidden">
        <SelectedLayerSection />
        <div className="px-2 py-2">
        {!hydrated ? (
          <div className="px-3 py-8 text-center text-[11.5px] italic text-fg-muted">
            Loading layers…
          </div>
        ) : layers.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-default px-3 py-8 text-center">
            <div className="text-[12px] text-fg-muted">No canvas layers yet</div>
            <AddLayerButton onAdd={handleAdd} prominent />
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={flatIds} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-1.5">
                {tree.map(node => (
                  node.layer.isFolder
                    ? <FolderRow key={node.layer.id} layer={node.layer} children={node.children} activeId={activeId} />
                    : <LayerRow key={node.layer.id} layer={node.layer} active={node.layer.id === activeId} />
                ))}
                <RootDropZone />
              </div>
            </SortableContext>
          </DndContext>
        )}
        </div>
      </div>
    </div>
  );
}

// ── Selected-layer section ──────────────────────────────────────────────────
// Inpaint/fill-mode controls + layer utilities for the currently-active
// layer. Per-layer generation parameters (prompt, denoise, seed, …) live in
// the left panel and are intentionally NOT duplicated here — this section
// is scoped to layer-level functions like fill mode and future utilities
// (Remove BG, etc.).

function SelectedLayerSection() {
  const activeId = useCanvasStore(s => s.activeLayerId);
  const layer = useCanvasStore(s =>
    s.activeLayerId ? s.canvasLayers.find(l => l.id === s.activeLayerId) ?? null : null);
  const updateCanvasLayer = useCanvasStore(s => s.updateCanvasLayer);

  if (!activeId || !layer) {
    return (
      <div className="shrink-0 border-b border-border-subtle bg-bg-panel px-3.5 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-section text-fg-dim">
          Selected layer
        </div>
        <div className="mt-1.5 text-[11.5px] italic text-fg-muted">
          Select a layer to edit its mode and actions.
        </div>
      </div>
    );
  }

  const fillMode = layer.fillMode ?? 'inpaint';
  const hasSelection = !!layer.selectedHistoryId;
  const modes: { value: 'inpaint' | 'img2img' | 'txt2img'; label: string; hint: string; disabled?: boolean }[] = [
    { value: 'txt2img', label: 'Txt2img', hint: 'Skip canvas capture — generate a fresh image at the layer’s bounds size.' },
    { value: 'img2img', label: 'Img2img', hint: hasSelection
        ? 'Use the layer’s selected history image as the source. No mask.'
        : 'Select a history image first to enable img2img.',
      disabled: !hasSelection },
    { value: 'inpaint', label: 'Inpaint', hint: 'Capture the canvas + bounds mask and run through the inpaint pipeline.' },
  ];

  return (
    <div className="shrink-0 border-b border-border-subtle bg-bg-panel px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-section text-fg-dim">
          Selected layer
        </div>
        <div className="min-w-0 truncate text-[11px] text-fg-muted" title={layer.name}>
          {layer.name}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span className="shrink-0 text-[11px] text-fg-tertiary">Fill mode</span>
        <div className="flex flex-1 rounded-md border border-border-default bg-bg-input p-0.5">
          {modes.map(m => (
            <button
              key={m.value}
              type="button"
              onClick={() => !m.disabled && updateCanvasLayer(layer.id, { fillMode: m.value })}
              disabled={m.disabled}
              title={m.hint}
              aria-pressed={fillMode === m.value}
              className={cn(
                'flex-1 rounded px-2 py-1.5 text-[11px] font-medium transition-colors',
                m.disabled
                  ? 'cursor-not-allowed text-fg-dim'
                  : fillMode === m.value
                    ? 'bg-accent text-white shadow-sm'
                    : 'text-fg-muted hover:text-fg-secondary',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {fillMode === 'inpaint' && (
        <div className="mt-3 border-t border-border-subtle pt-3">
          <InpaintSection />
        </div>
      )}
    </div>
  );
}

// ── Add-layer button ────────────────────────────────────────────────────────

/**
 * Add-layer button. Clicking the primary face adds a fresh layer (inheriting
 * params from the most-recently-active layer). Clicking the chevron opens a
 * popover that lets the user explicitly pick a source layer to copy params
 * from, with up to two "Recents" pinned at the top.
 */
function AddLayerButton({
  onAdd,
  prominent,
}: {
  onAdd: (sourceId?: string) => void;
  prominent?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const allLayers = useCanvasStore(s => s.canvasLayers);
  const lastActiveId = useCanvasStore(s => s.lastActiveLayerId);
  const sorted = useMemo(
    () => [...allLayers].sort((a, b) => b.zIndex - a.zIndex),
    [allLayers],
  );
  const recentIds = useMemo(() => {
    const out: string[] = [];
    for (const id of recentSourceIds) {
      if (out.length >= 2) break;
      if (allLayers.some(l => l.id === id)) out.push(id);
    }
    if (out.length < 2 && lastActiveId && !out.includes(lastActiveId)
        && allLayers.some(l => l.id === lastActiveId)) {
      out.push(lastActiveId);
    }
    return out;
  }, [allLayers, lastActiveId]);
  const recents = recentIds
    .map(id => allLayers.find(l => l.id === id))
    .filter((l): l is CanvasLayer => !!l);

  const primaryCls = prominent
    ? 'flex h-9 items-center gap-1.5 rounded-l-lg border-y border-l border-accent bg-accent px-3 text-[12px] font-semibold text-white transition-colors hover:bg-accent-hover'
    : 'flex h-9 items-center gap-1 rounded-l-lg border-y border-l border-border-default bg-bg-elev px-2.5 text-[12px] font-medium text-fg-tertiary transition-colors hover:border-border-strong hover:text-fg-secondary';
  const chevronCls = prominent
    ? 'flex h-9 items-center justify-center rounded-r-lg border border-accent bg-accent px-1.5 text-white transition-colors hover:bg-accent-hover'
    : 'flex h-9 items-center justify-center rounded-r-lg border border-border-default bg-bg-elev px-1.5 text-fg-tertiary transition-colors hover:border-border-strong hover:text-fg-secondary';

  return (
    <div className="flex items-stretch">
      <button
        type="button"
        className={primaryCls}
        onClick={() => onAdd()}
        title="Add a fresh canvas layer (inherits last layer's params)"
      >
        <PlusIcon size={13} />
        <span>Add layer</span>
      </button>
      {sorted.length > 0 && (
        <RPopover.Root open={open} onOpenChange={setOpen}>
          <RPopover.Trigger asChild>
            <button
              type="button"
              className={chevronCls}
              title="Copy params from an existing layer"
              aria-label="Copy params from an existing layer"
            >
              <ChevronDownIcon size={10} />
            </button>
          </RPopover.Trigger>
          <RPopover.Portal>
            <RPopover.Content
              align="end"
              sideOffset={6}
              className="z-50 w-[240px] overflow-hidden rounded-lg border border-border-default bg-bg-elev shadow-xl"
            >
              <div className="border-b border-border-subtle px-3 py-2 text-[10px] font-semibold uppercase tracking-section text-fg-tertiary">
                New layer from…
              </div>
              <div className="scroll-y max-h-[320px] py-1.5">
                <button
                  type="button"
                  onClick={() => { onAdd(); setOpen(false); }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-fg-secondary transition-colors hover:bg-bg-base/60"
                >
                  <PlusIcon size={11} />
                  <span className="flex-1">Blank layer</span>
                  <span className="text-[9px] text-fg-dim">last active</span>
                </button>
                {recents.length > 0 && (
                  <>
                    <div className="mt-1 px-3 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-section text-fg-dim">
                      Recents
                    </div>
                    {recents.map(l => (
                      <SourceRow key={`r-${l.id}`} layer={l} onPick={(id) => { onAdd(id); setOpen(false); }} />
                    ))}
                    <div className="my-1 h-px bg-border-subtle" />
                  </>
                )}
                <div className="px-3 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-section text-fg-dim">
                  All layers
                </div>
                {sorted.map(l => (
                  <SourceRow key={l.id} layer={l} onPick={(id) => { onAdd(id); setOpen(false); }} />
                ))}
              </div>
            </RPopover.Content>
          </RPopover.Portal>
        </RPopover.Root>
      )}
    </div>
  );
}

function SourceRow({ layer, onPick }: { layer: CanvasLayer; onPick: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(layer.id)}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-fg-secondary transition-colors hover:bg-bg-base/60"
    >
      <span className="font-mono text-[9px] text-fg-dim">z{layer.zIndex}</span>
      <span className="min-w-0 flex-1 truncate">{layer.name}</span>
    </button>
  );
}

// ── Per-layer row ────────────────────────────────────────────────────────────

function LayerRow({ layer, active }: { layer: CanvasLayer; active: boolean }) {
  const setActiveLayer = useCanvasStore(s => s.setActiveLayer);
  const updateCanvasLayer = useCanvasStore(s => s.updateCanvasLayer);
  const removeCanvasLayer = useCanvasStore(s => s.removeCanvasLayer);
  const confirm = useConfirm();
  // `useCollapsed` returns `collapsed` (true = hidden). We flip naming locally.
  const [historyCollapsed, toggleHistory] = useCollapsed(`canvasLayer.history:${layer.id}`, true);
  const historyOpen = !historyCollapsed;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: layer.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  // Inline name editing. Draft starts in sync with the store; commits on blur
  // or Enter, reverts on Escape. Effect resyncs if the store-side name changes
  // out from under us (e.g. layer rebuild).
  const [nameDraft, setNameDraft] = useState(layer.name);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setNameDraft(layer.name), [layer.name]);

  const commitName = () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setNameDraft(layer.name);
      return;
    }
    if (trimmed !== layer.name) updateCanvasLayer(layer.id, { name: trimmed });
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete layer',
      message: `Delete “${layer.name}”? Its per-layer history will also be removed.`,
      confirmLabel: 'Delete',
    });
    if (ok) removeCanvasLayer(layer.id);
  };

  return (
    <div ref={setNodeRef} style={style} className="flex flex-col">
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border bg-bg-card px-2 py-2 transition-colors',
        active
          ? 'border-accent border-l-[3px] bg-accent-soft/30'
          : 'border-border-default border-l-[3px] border-l-transparent hover:border-border-strong',
      )}
    >
      {/* Row 1: identity — disclosure, drag, thumbnail, name (full width), z-chip. */}
      <div className="flex items-center gap-2">
        {/* Disclosure */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); toggleHistory(); }}
          title={historyOpen ? 'Collapse history' : 'Expand history'}
          aria-label={historyOpen ? 'Collapse history' : 'Expand history'}
          aria-expanded={historyOpen}
          className="flex h-8 w-5 shrink-0 items-center justify-center text-fg-dim transition-colors hover:text-fg-secondary"
        >
          {historyOpen ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
        </button>
        {/* Drag handle */}
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          title="Drag to reorder"
          className="flex h-8 w-4 shrink-0 cursor-grab touch-none items-center justify-center text-handle hover:text-fg-tertiary active:cursor-grabbing"
        >
          <DragDots />
        </button>

        <LayerThumb layer={layer} onClick={() => setActiveLayer(layer.id)} />


        {/* Name field — takes all remaining row space, never truncates while
            editing. Activates the layer on plain click. */}
        <input
          ref={inputRef}
          value={nameDraft}
          spellCheck={false}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onFocus={() => setActiveLayer(layer.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'Escape') {
              setNameDraft(layer.name);
              (e.target as HTMLInputElement).blur();
            }
          }}
          onClick={(e) => { e.stopPropagation(); setActiveLayer(layer.id); }}
          onPointerDown={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 truncate rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-[12px] text-fg-secondary outline-none hover:border-border-subtle focus:border-border-strong focus:bg-bg-input"
        />

        <span
          className="shrink-0 rounded bg-bg-elev px-1.5 py-0.5 font-mono text-[9px] text-fg-dim"
          title="z-index (higher renders on top)"
        >
          z{layer.zIndex}
        </span>
      </div>

      {/* Row 2: action buttons — compact, evenly distributed across the row. */}
      <div className="flex items-center gap-0.5 pl-7">
        <CopyParamsButton targetLayerId={layer.id} />
        <RowBtn
          title="Capture the visible canvas at this layer's bounds as a new history entry"
          onClick={() => { void snapshotLayerComposite(layer.id); }}
        >
          <CameraIcon size={14} />
        </RowBtn>
        <RowBtn
          title={layer.visible ? 'Hide layer' : 'Show layer'}
          onClick={() => updateCanvasLayer(layer.id, { visible: !layer.visible })}
        >
          {layer.visible ? <EyeIcon size={14} /> : <EyeSlashIcon size={14} className="text-fg-dim" />}
        </RowBtn>
        <RowBtn
          title={layer.locked ? 'Unlock layer' : 'Lock layer'}
          onClick={() => updateCanvasLayer(layer.id, { locked: !layer.locked })}
        >
          {layer.locked
            ? <LockIcon size={14} className="text-accent" filled />
            : <LockOpenIcon size={14} className="text-fg-dim" />}
        </RowBtn>
        {layer.selectedHistoryId && (
          <RowBtn
            title="Clear stamp (unselects the current image, layer + its history are kept)"
            onClick={() => updateCanvasLayer(layer.id, { selectedHistoryId: undefined })}
          >
            <EraserIcon size={14} className="text-fg-dim" />
          </RowBtn>
        )}
        <RowBtn title="Delete layer" danger onClick={handleDelete}>
          <CloseIcon size={14} />
        </RowBtn>
      </div>
    </div>

    {historyOpen && <LayerHistoryList layer={layer} />}
    </div>
  );
}

function FolderRow({
  layer, children, activeId,
}: {
  layer: CanvasLayer;
  children: CanvasLayer[];
  activeId: string | null;
}) {
  const toggleFolderCollapsed = useCanvasStore(s => s.toggleFolderCollapsed);
  const removeCanvasLayer = useCanvasStore(s => s.removeCanvasLayer);
  const updateCanvasLayer = useCanvasStore(s => s.updateCanvasLayer);
  const confirm = useConfirm();
  const open = !layer.folderCollapsed;
  const [nameDraft, setNameDraft] = useState(layer.name);
  useEffect(() => setNameDraft(layer.name), [layer.name]);
  const commitName = () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) { setNameDraft(layer.name); return; }
    if (trimmed !== layer.name) updateCanvasLayer(layer.id, { name: trimmed });
  };

  // The folder row itself is sortable (you can reorder folders).
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: layer.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  // The body is a drop target for "drop into folder" — id "folder-zone:<id>".
  const { setNodeRef: setZoneRef, isOver } = useDroppable({ id: `folder-zone:${layer.id}` });

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete group',
      message: `Delete the “${layer.name}” group? Layers inside will become un-grouped, not deleted.`,
      confirmLabel: 'Delete group',
    });
    if (ok) removeCanvasLayer(layer.id);
  };

  return (
    <div ref={setNodeRef} style={style} className="flex flex-col">
      <div className={cn(
        'flex items-center gap-2 rounded-t-lg border border-b-0 px-2 py-1.5 transition-colors',
        isOver ? 'border-accent bg-accent-soft/30' : 'border-border-default bg-bg-elev',
        !open && 'rounded-b-lg border-b',
      )}>
        <button
          type="button"
          onClick={() => toggleFolderCollapsed(layer.id)}
          className="flex h-7 w-5 shrink-0 items-center justify-center text-fg-dim hover:text-fg-secondary"
          title={open ? 'Collapse group' : 'Expand group'}
        >
          {open ? <ChevronDownIcon size={11} /> : <ChevronRightIcon size={11} />}
        </button>
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder group"
          title="Drag to reorder group"
          className="flex h-7 w-4 shrink-0 cursor-grab touch-none items-center justify-center text-handle hover:text-fg-tertiary active:cursor-grabbing"
        >
          <DragDots />
        </button>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center text-fg-tertiary">
          {open ? <FolderOpenIcon size={14} /> : <FolderIcon size={14} />}
        </span>
        <input
          value={nameDraft}
          spellCheck={false}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            else if (e.key === 'Escape') { setNameDraft(layer.name); (e.target as HTMLInputElement).blur(); }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 truncate rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-[12px] font-medium text-fg-secondary outline-none hover:border-border-subtle focus:border-border-strong focus:bg-bg-input"
        />
        <span className="shrink-0 rounded bg-bg-base/40 px-1.5 py-0.5 font-mono text-[9px] text-fg-dim">
          {children.length}
        </span>
        <button
          type="button"
          onClick={handleDelete}
          title="Delete group"
          aria-label="Delete group"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-dim transition-colors hover:bg-status-err/10 hover:text-status-err"
        >
          <CloseIcon size={12} />
        </button>
      </div>
      {open && (
        <div
          ref={setZoneRef}
          className={cn(
            'flex flex-col gap-1.5 rounded-b-lg border border-t-0 border-border-default bg-bg-base/30 px-2 pb-2 pt-1.5',
            isOver && 'border-accent bg-accent-soft/20',
          )}
        >
          {children.length === 0 ? (
            <div className="px-2 py-2 text-center text-[10.5px] italic text-fg-dim">
              Drop layers here
            </div>
          ) : (
            children.map(c => (
              <LayerRow key={c.id} layer={c} active={c.id === activeId} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function RootDropZone() {
  const { setNodeRef, isOver } = useDroppable({ id: 'root-zone' });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'mt-1 h-6 rounded border border-dashed text-center text-[10px] leading-6 transition-colors',
        isOver
          ? 'border-accent bg-accent-soft/20 text-fg-secondary'
          : 'border-transparent text-fg-dim',
      )}
    >
      {isOver ? 'Drop to ungroup' : ''}
    </div>
  );
}

function LayerThumb({ layer, onClick }: { layer: CanvasLayer; onClick: () => void }) {
  const url = useLayerSelectedThumb(layer.id, layer.selectedHistoryId);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Select ${layer.name}`}
      className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border-default bg-[repeating-conic-gradient(theme(colors.zinc.700)_0%_25%,transparent_0%_50%)] bg-[length:8px_8px] text-fg-dim"
    >
      {url
        ? <img src={url} alt="" className="h-full w-full object-cover" />
        : <ImagePlaceholderIcon size={18} />}
    </button>
  );
}

// ── Per-layer history strip ─────────────────────────────────────────────────
// Expanded under each layer row. Lists the layer's stamped history entries
// newest-first as small thumbnails; clicking one sets that entry as the
// layer's `selectedHistoryId` and stamps its blob into the canvas sprite.
// Same effect as ← / → arrow nav via navigateLayerHistory.

function LayerHistoryList({ layer }: { layer: CanvasLayer }) {
  const updateCanvasLayer = useCanvasStore(s => s.updateCanvasLayer);
  const [entries, setEntries] = useState<LayerHistoryEntry[] | null>(null);
  const urlsRef = useRef<Map<string, string>>(new Map());
  // Force re-render when urlsRef gains entries.
  const [, setTick] = useState(0);
  const bump = () => setTick(t => t + 1);

  // Refetch whenever the layer's selectedHistoryId changes — a new gen stamps
  // a fresh entry + advances the pointer, so this is the cheapest signal that
  // the per-layer history list has changed.
  useEffect(() => {
    let cancelled = false;
    canvasStorage.listLayerHistory(layer.id).then(rows => {
      if (cancelled) return;
      rows.sort((a, b) => a.at - b.at);
      setEntries(rows);
    });
    return () => { cancelled = true; };
  }, [layer.id, layer.selectedHistoryId]);

  // Maintain blob URLs for the current entry set. Drop URLs for entries that
  // disappeared; create URLs for new ones lazily.
  useEffect(() => {
    if (!entries) return;
    const present = new Set(entries.map(e => e.id));
    let changed = false;
    for (const [id, u] of [...urlsRef.current]) {
      if (!present.has(id)) {
        URL.revokeObjectURL(u);
        urlsRef.current.delete(id);
        changed = true;
      }
    }
    let cancelled = false;
    (async () => {
      for (const e of entries) {
        if (cancelled) return;
        if (urlsRef.current.has(e.id)) continue;
        const blob = await canvasStorage.getBlob(e.blobId);
        if (cancelled || !blob) continue;
        // Brush-commit entries are PIBR-format raw RGBA, not PNG — the
        // browser can't decode them as an <img> source. blobToDisplayUrl
        // detects PIBR vs PNG and returns a URL that an <img> can render.
        const url = await blobToDisplayUrl(blob);
        if (cancelled) { URL.revokeObjectURL(url); continue; }
        urlsRef.current.set(e.id, url);
        bump();
      }
    })();
    if (changed) bump();
    return () => { cancelled = true; };
  }, [entries]);

  // Revoke all URLs on unmount (panel collapse / layer delete).
  useEffect(() => () => {
    urlsRef.current.forEach(u => URL.revokeObjectURL(u));
    urlsRef.current.clear();
  }, []);

  const onDelete = async (entry: LayerHistoryEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    // If we're deleting the selected entry, pick the next-most-recent
    // surviving one (or clear) so the sprite has somewhere to land.
    let nextSelected: string | undefined = layer.selectedHistoryId;
    if (entry.id === layer.selectedHistoryId && entries) {
      const survivors = entries.filter(e2 => e2.id !== entry.id);
      const newest = survivors.sort((a, b) => b.at - a.at)[0];
      nextSelected = newest?.id;
      updateCanvasLayer(layer.id, { selectedHistoryId: nextSelected });
    }
    try {
      await canvasStorage.deleteLayerHistoryEntry(layer.id, entry.id);
    } catch (err) {
      console.warn('[LayerHistoryList] delete failed', err);
      return;
    }
    // Revoke + drop the URL.
    const url = urlsRef.current.get(entry.id);
    if (url) {
      URL.revokeObjectURL(url);
      urlsRef.current.delete(entry.id);
    }
    setEntries(prev => prev ? prev.filter(e2 => e2.id !== entry.id) : prev);
  };

  const onPick = async (entry: LayerHistoryEntry) => {
    if (entry.id === layer.selectedHistoryId) return;
    updateCanvasLayer(layer.id, { selectedHistoryId: entry.id });
    // Canvas display needs the ORIGINAL blob (PIBR / PNG) so the
    // controller's setLayerImage can dispatch on magic bytes. The cached
    // URL in urlsRef is a PNG conversion for the thumbnail strip — using
    // it on the canvas would lose the byte-exact PIBR roundtrip.
    const blob = await canvasStorage.getBlob(entry.blobId);
    if (!blob) return;
    const fresh = URL.createObjectURL(blob);
    getCanvasController()?.setLayerImage(layer.id, fresh, entry.blobId);
  };

  if (entries === null) {
    return (
      <div className="ml-7 mt-1 px-2 py-1.5 text-[10.5px] italic text-fg-dim">
        Loading…
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div className="ml-7 mt-1 px-2 py-1.5 text-[10.5px] italic text-fg-muted">
        No history yet — generate to stamp something.
      </div>
    );
  }

  return (
    <div className="ml-7 mt-1 flex flex-wrap gap-1.5 px-1 pb-1">
      {entries.map(e => {
        const url = urlsRef.current.get(e.id);
        const selected = e.id === layer.selectedHistoryId;
        return (
          <div
            key={e.id}
            className={cn(
              'group relative h-16 w-16 shrink-0 overflow-hidden rounded border bg-bg-elev transition-colors',
              selected
                ? 'border-accent ring-1 ring-accent'
                : 'border-border-default hover:border-border-strong',
            )}
          >
            <button
              type="button"
              onClick={() => onPick(e)}
              title={`${new Date(e.at).toLocaleString()}\n${e.positive.slice(0, 120)}`}
              className="block h-full w-full"
            >
              {url
                ? <img src={url} alt="" className="h-full w-full object-cover" />
                : <span className="block h-full w-full" />}
            </button>
            <button
              type="button"
              onClick={(ev) => { void onDelete(e, ev); }}
              title="Delete this history entry"
              aria-label="Delete this history entry"
              className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-bg-elev/85 text-fg-tertiary opacity-0 shadow ring-1 ring-border-default transition-opacity hover:bg-status-err/90 hover:text-white hover:ring-status-err group-hover:opacity-100 focus-visible:opacity-100"
            >
              <CloseIcon size={9} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Per-layer "copy params from another layer" trigger + popover picker
 * (#41). Source = any OTHER layer; destination = this row's layer. Hidden
 * when there's no other layer to copy from. Stops click propagation so
 * opening the popover doesn't also activate the layer.
 */
function CopyParamsButton({ targetLayerId }: { targetLayerId: string }) {
  // Select the raw array (stable reference unless layers actually change),
  // then derive the filtered + sorted list outside the selector — returning
  // a fresh array from the selector itself trips Zustand v5's
  // getSnapshot-must-be-cached invariant and causes infinite re-renders.
  const allLayers = useCanvasStore(s => s.canvasLayers);
  const duplicateLayerParams = useCanvasStore(s => s.duplicateLayerParams);
  const [open, setOpen] = useState(false);

  const sorted = useMemo(
    () => allLayers
      .filter(l => l.id !== targetLayerId)
      .sort((a, b) => b.zIndex - a.zIndex),
    [allLayers, targetLayerId],
  );

  if (sorted.length === 0) return null;

  return (
    <RPopover.Root open={open} onOpenChange={setOpen}>
      <RPopover.Trigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          title="Copy params from another layer"
          aria-label="Copy params from another layer"
          className="flex h-7 min-w-7 flex-1 shrink-0 items-center justify-center rounded-md border border-border-subtle text-fg-tertiary transition-colors hover:border-border-strong hover:bg-bg-elev hover:text-fg-secondary"
        >
          <CopyIcon size={14} />
        </button>
      </RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[220px] overflow-hidden rounded-lg border border-border-default bg-bg-elev shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="border-b border-border-subtle px-3 py-2 text-[10px] font-semibold uppercase tracking-section text-fg-tertiary">
            Copy params from…
          </div>
          <div className="scroll-y max-h-[280px] p-1.5">
            {sorted.map(l => (
              <button
                key={l.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  duplicateLayerParams(l.id, targetLayerId);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-fg-secondary transition-colors hover:bg-bg-base/60"
              >
                <span className="font-mono text-[9px] text-fg-dim">z{l.zIndex}</span>
                <span className="min-w-0 flex-1 truncate">{l.name}</span>
              </button>
            ))}
          </div>
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

function RowBtn({
  onClick, title, danger, children,
}: {
  onClick: () => void;
  title: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      aria-label={title}
      className={cn(
        'flex h-7 min-w-7 flex-1 shrink-0 items-center justify-center rounded-md border border-border-subtle text-fg-tertiary transition-colors',
        danger
          ? 'hover:border-status-err/40 hover:bg-status-err/10 hover:text-status-err'
          : 'hover:border-border-strong hover:bg-bg-elev hover:text-fg-secondary',
      )}
    >
      {children}
    </button>
  );
}

function DragDots() {
  return (
    <svg viewBox="0 0 8 12" width="11" height="16" aria-hidden className="shrink-0">
      <g fill="currentColor">
        <circle cx="1.5" cy="1.5" r="1" />
        <circle cx="6.5" cy="1.5" r="1" />
        <circle cx="1.5" cy="6" r="1" />
        <circle cx="6.5" cy="6" r="1" />
        <circle cx="1.5" cy="10.5" r="1" />
        <circle cx="6.5" cy="10.5" r="1" />
      </g>
    </svg>
  );
}

// ── Default new-layer size picker ────────────────────────────────────────────
// Replaces the top-toolbar canvas-size dropdown. Sets the default bounds size
// applied to layers created via +Add. Persisted in canvasStore + localStorage.

function DefaultSizePicker() {
  const size = useCanvasStore(s => s.defaultLayerSize);
  const setSize = useCanvasStore(s => s.setDefaultLayerSize);
  const label = `${size.w}×${size.h}`;
  // Build presets: the existing RESOLUTION_PRESETS list. Include the current
  // value even if it's not a preset so the dropdown shows what's selected.
  const presetStrs = RESOLUTION_PRESETS.map(([w, h]) => `${w}×${h}`);
  const opts = presetStrs.includes(label) ? presetStrs : [label, ...presetStrs];
  return (
    <select
      aria-label="Default size for new layers"
      title="Default bounds size for newly-added layers"
      value={label}
      onChange={(e) => {
        const [w, h] = e.target.value.split('×').map(n => Number(n));
        if (Number.isFinite(w) && Number.isFinite(h)) setSize({ w, h });
      }}
      className="h-9 rounded-md border border-border-subtle bg-bg-elev px-2 font-mono text-[10.5px] text-fg-tertiary hover:border-border-strong focus:outline-none focus:ring-1 focus:ring-accent"
    >
      {opts.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
