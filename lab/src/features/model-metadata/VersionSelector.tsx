import { useEffect, useMemo, useState } from 'react';
import { Select } from '@/components/ui/Select';
import { useStore } from '@/lib/store';
import { localHashSet, versionOnDisk } from '@/lib/modelHash';
import { Chip } from '@/features/models/primitives';
import { formatDate } from './civitai';
import { useModelMetadataStore, useSelectedVersion } from './store';

/**
 * Version dropdown + base-model chip + published date.
 *
 * By default the dropdown lists only versions present on disk (matched by file
 * hash against `store.modelHashes`) — the model you opened is the focus, not
 * CivitAI's full catalogue. A "show all versions" toggle reveals the rest as a
 * secondary affordance. When the hash cache is empty we can't tell what's
 * downloaded, so it falls back to listing everything.
 *
 * On-disk status for the *selected* version is now shown by the footer's
 * download action, so there's no separate pill here.
 */
export function VersionSelector() {
  const model = useModelMetadataStore((s) => s.model);
  const selectVersion = useModelMetadataStore((s) => s.selectVersion);
  const version = useSelectedVersion();
  const modelHashes = useStore((s) => s.modelHashes);

  const local = useMemo(() => localHashSet(modelHashes), [modelHashes]);
  const canCheck = modelHashes.length > 0;

  const [showAll, setShowAll] = useState(false);
  // Reset to the on-disk-first view whenever a different model opens.
  useEffect(() => { setShowAll(false); }, [model?.id]);

  if (!model || !version) return null;

  const allVersions = model.modelVersions;
  const onDisk = canCheck ? allVersions.filter((v) => versionOnDisk(local, v)) : [];

  // Default view: only versions on disk. Always keep the selected one visible
  // even if it isn't (e.g. opened via a stale id, or hash match missed).
  const filtering = onDisk.length > 0 && !showAll;
  let visible = filtering ? onDisk : allVersions;
  if (!visible.some((v) => v.id === version.id)) visible = [version, ...visible];

  const hiddenCount = allVersions.length - visible.length;
  const showToggle = onDisk.length > 0 && (hiddenCount > 0 || showAll);
  const published = formatDate(version.publishedAt ?? version.createdAt);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Select
          value={String(version.id)}
          onValueChange={(id) => selectVersion(Number(id))}
          options={visible.map((v) => {
            const name = v.name || `Version ${v.id}`;
            return {
              value: String(v.id),
              label: canCheck && !versionOnDisk(local, v) ? `${name} — CivitAI only` : name,
            };
          })}
          ariaLabel="Model version"
        />
        {version.baseModel && (
          <Chip tone="accent" className="shrink-0">
            {version.baseModel}
          </Chip>
        )}
      </div>
      {(published || showToggle) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-fg-dim">
          {published && <span>Published {published}</span>}
          {published && showToggle && <span className="text-fg-faint">·</span>}
          {showToggle && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="font-medium transition-colors hover:text-fg-tertiary"
            >
              {showAll
                ? 'Show on-disk versions only'
                : `Show all ${allVersions.length} versions (${hiddenCount} on CivitAI only)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
