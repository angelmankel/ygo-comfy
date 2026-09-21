import { useMemo } from 'react';
import { useStore } from '@/lib/store';
import { serversWithModel } from '@/lib/routing';
import { type CivitaiModelVersion, formatFileSize, primaryFile } from './civitai';
import { Section } from './Section';
import { useModelMetadataStore } from './store';
import { CheckIcon, FileIcon } from '@/components/ui/icons';

/**
 * Primary file: name, size / format / precision, AutoV2 hash, scan status, and
 * which connected server(s) have the model on disk.
 */
export function FileDetails({ version }: { version: CivitaiModelVersion }) {
  const fileName = useModelMetadataStore((s) => s.openFileName);
  const servers = useStore((s) => s.servers);
  const serverInfo = useStore((s) => s.serverInfo);

  // Which servers host the model the modal was opened for. Matched by the
  // local file name against each server's model lists.
  const hostNames = useMemo(() => {
    if (!fileName) return [];
    const ids = new Set(serversWithModel(serverInfo, fileName));
    return servers.filter((s) => ids.has(s.id)).map((s) => s.name);
  }, [fileName, servers, serverInfo]);

  const file = primaryFile(version);
  if (!file) return null;

  const meta = file.metadata ?? { fp: null, size: null, format: null };
  const bits = [formatFileSize(file.sizeKB), meta.format, meta.fp, meta.size].filter(
    (b): b is string => Boolean(b),
  );
  const hash = file.hashes?.AutoV2;
  const scanned = file.virusScanResult === 'Success' && file.pickleScanResult === 'Success';

  return (
    <Section label="File">
      <div className="flex flex-col gap-2 rounded-lg border border-border-default bg-bg-card p-3">
        <div className="flex items-center gap-2">
          <span className="text-fg-muted"><FileIcon size={14} /></span>
          <span className="truncate text-[12px] font-medium text-fg-secondary">{file.name}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-fg-muted">
          {bits.map((b, i) => (
            <span key={b} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-fg-faint">·</span>}
              {b}
            </span>
          ))}
        </div>
        {hash && (
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-semibold uppercase tracking-tag text-fg-dim">AutoV2</span>
            <span className="text-[11px] text-fg-tertiary">{hash}</span>
            {scanned && (
              <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-vae-soft px-2 py-0.5 text-[10px] font-medium text-vae-fg">
                <CheckIcon size={11} /> Scanned
              </span>
            )}
          </div>
        )}
        {fileName && (
          <div className="flex items-center gap-2 border-t border-border-subtle pt-2">
            <span className="text-[9px] font-semibold uppercase tracking-tag text-fg-dim">Servers</span>
            {hostNames.length > 0 ? (
              <span className="flex flex-wrap gap-1">
                {hostNames.map((n) => (
                  <span
                    key={n}
                    className="rounded bg-bg-elev px-1.5 py-0.5 text-[10px] font-medium text-fg-tertiary"
                  >
                    {n}
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-[11px] text-fg-muted">Not on any connected server</span>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}
