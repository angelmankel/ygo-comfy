import { useState } from 'react';
import { useStore } from '@/lib/store';
import { CloseIcon, EditIcon, HeartIcon, PlusIcon, StarIcon, UploadIcon } from '@/components/ui/icons';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { cn } from '@/lib/cn';
import type { RailBucket } from './useCollectionTiles';

/**
 * Left rail — three virtual buckets (`All`, `Imports`, `Favorites`) followed
 * by user-created collections. The active bucket is highlighted; clicking
 * outside the active row's chrome doesn't change selection.
 */
export function CollectionsRail({
  bucket,
  onChange,
}: {
  bucket: RailBucket;
  onChange: (next: RailBucket) => void;
}) {
  const collections = useStore((s) => s.collections);
  const history = useStore((s) => s.history);
  const importedImages = useStore((s) => s.importedImages);
  const createCollection = useStore((s) => s.createCollection);
  const deleteCollection = useStore((s) => s.deleteCollection);
  const confirm = useConfirm();
  const renameCollection = useStore((s) => s.renameCollection);

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const totalCount = history.length + importedImages.length;
  const favCount = history.filter((h) => h.liked).length + importedImages.filter((i) => i.liked).length;

  const submitNew = () => {
    const name = draft.trim();
    if (!name) { setAdding(false); setDraft(''); return; }
    const id = createCollection(name);
    setAdding(false);
    setDraft('');
    onChange(id);
  };
  const submitRename = (id: string) => {
    const name = renameDraft.trim();
    if (name) renameCollection(id, name);
    setRenamingId(null);
    setRenameDraft('');
  };

  return (
    <aside className="flex w-[220px] shrink-0 flex-col gap-1 border-r border-border-subtle bg-bg-panel/60 px-2 py-3">
      <RailRow
        active={bucket === 'all'}
        onClick={() => onChange('all')}
        icon={<StarIcon size={13} />}
        label="All"
        count={totalCount}
      />
      <RailRow
        active={bucket === 'imports'}
        onClick={() => onChange('imports')}
        icon={<UploadIcon size={13} />}
        label="Imports"
        count={importedImages.length}
      />
      <RailRow
        active={bucket === 'favorites'}
        onClick={() => onChange('favorites')}
        icon={<HeartIcon size={13} filled />}
        label="Favorites"
        count={favCount}
      />

      <div className="mx-1 my-2 border-t border-border-subtle" />

      <div className="px-1 text-[9px] font-semibold uppercase tracking-section text-fg-dim">
        Collections
      </div>

      {collections.map((c) => {
        const isActive = bucket === c.id;
        const isRenaming = renamingId === c.id;
        if (isRenaming) {
          return (
            <div key={c.id} className="flex items-center gap-1 px-1">
              <input
                value={renameDraft}
                autoFocus
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={() => submitRename(c.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitRename(c.id);
                  else if (e.key === 'Escape') { setRenamingId(null); setRenameDraft(''); }
                }}
                className="min-w-0 flex-1 rounded border border-accent bg-bg-input px-2 py-1 text-[12px] text-fg-secondary outline-none"
              />
            </div>
          );
        }
        return (
          <div key={c.id} className={cn('group flex items-center gap-1 rounded-md', isActive && 'bg-accent-soft')}>
            <button
              type="button"
              onClick={() => onChange(c.id)}
              className={cn(
                'flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors',
                isActive ? 'text-accent-fg' : 'text-fg-secondary hover:bg-bg-elev',
              )}
            >
              <span aria-hidden className="text-[11px]">{c.icon ?? '📁'}</span>
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <span className="text-[10px] tabular-nums text-fg-dim">{c.itemIds.length}</span>
            </button>
            <div className="flex items-center pr-1 opacity-0 group-hover:opacity-100">
              <button
                type="button"
                onClick={() => { setRenamingId(c.id); setRenameDraft(c.name); }}
                aria-label="Rename collection"
                title="Rename"
                className="flex h-6 w-6 items-center justify-center rounded text-fg-dim hover:bg-bg-elev hover:text-fg-secondary"
              >
                <EditIcon size={11} />
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!await confirm(`Delete the "${c.name}" collection? The images themselves are kept.`)) return;
                  deleteCollection(c.id);
                  if (bucket === c.id) onChange('all');
                }}
                aria-label="Delete collection"
                title="Delete"
                className="flex h-6 w-6 items-center justify-center rounded text-fg-dim hover:bg-bg-elev hover:text-status-err"
              >
                <CloseIcon size={11} />
              </button>
            </div>
          </div>
        );
      })}

      {collections.length === 0 && !adding && (
        <p className="px-1 py-1 text-[10.5px] italic text-fg-dim">No collections yet.</p>
      )}

      {adding ? (
        <div className="flex items-center gap-1 px-1">
          <input
            value={draft}
            autoFocus
            placeholder="Collection name…"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={submitNew}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitNew();
              else if (e.key === 'Escape') { setAdding(false); setDraft(''); }
            }}
            className="min-w-0 flex-1 rounded border border-accent bg-bg-input px-2 py-1 text-[12px] text-fg-secondary outline-none"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-1 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11.5px] text-fg-tertiary transition-colors hover:bg-bg-elev hover:text-accent-fg"
        >
          <PlusIcon size={12} />
          New collection
        </button>
      )}
    </aside>
  );
}

function RailRow({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors',
        active
          ? 'bg-accent-soft text-accent-fg'
          : 'text-fg-secondary hover:bg-bg-elev',
      )}
    >
      <span className={cn('shrink-0', active ? 'text-accent-fg' : 'text-fg-dim')}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-[10px] tabular-nums text-fg-dim">{count}</span>
    </button>
  );
}
