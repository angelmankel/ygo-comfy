import { Modal } from '@/components/modal';
import { Chip } from '@/features/models/primitives';
import { ExternalLinkIcon, ResetIcon } from '@/components/ui/icons';
import { civitaiModelUrl } from './civitai';
import { useModelMetadataStore, useSelectedVersion } from './store';
import { Section } from './Section';
import { StatsStrip } from './StatsStrip';
import { VersionSelector } from './VersionSelector';
import { VersionNotes } from './VersionNotes';
import { TriggerWords } from './TriggerWords';
import { RecommendedSettings } from './RecommendedSettings';
import { AboutSection } from './AboutSection';
import { FileDetails } from './FileDetails';
import { LicenseChips } from './LicenseChips';
import { DownloadAction } from './DownloadAction';

/**
 * Right column of the metadata modal — header + scrollable metadata sections +
 * footer. Each section is its own component in this folder so the column stays
 * a thin composition and the pieces stay independently maintainable.
 */
export function MetadataColumn() {
  const load = useModelMetadataStore((s) => s.load);
  const model = useModelMetadataStore((s) => s.model);
  const error = useModelMetadataStore((s) => s.error);
  const close = useModelMetadataStore((s) => s.close);
  const retry = useModelMetadataStore((s) => s.retry);
  const openModelId = useModelMetadataStore((s) => s.openModelId);
  const version = useSelectedVersion();

  return (
    <Modal.Column className="w-[440px]">
      {load === 'loading' || load === 'idle' ? (
        <MetadataSkeleton />
      ) : load === 'error' || !model || !version ? (
        <MetadataErrorState
          error={error ?? 'Failed to load metadata.'}
          modelId={openModelId}
          onRetry={retry}
        />
      ) : (
        <>
          <Modal.Header className="flex flex-col gap-2.5">
            <div className="flex items-start gap-2">
              <Chip tone="accent" className="uppercase tracking-tag">
                {model.type}
              </Chip>
              {model.nsfw && (
                <Chip tone="warn" className="uppercase tracking-tag">
                  NSFW
                </Chip>
              )}
              <div className="flex-1" />
              <Modal.Close />
            </div>
            <h2 className="text-[20px] font-semibold leading-tight text-fg-primary">{model.name}</h2>
            <div className="flex items-center gap-2 text-[11px] text-fg-tertiary">
              {model.creator?.image ? (
                <img src={model.creator.image} alt="" className="h-5 w-5 rounded-full object-cover" />
              ) : (
                <span className="h-5 w-5 rounded-full bg-gradient-to-br from-accent to-lora" />
              )}
              <span>by {model.creator?.username ?? 'unknown'}</span>
              <span className="text-fg-faint">·</span>
              <a
                href={civitaiModelUrl(model.id)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-accent-fg hover:underline"
              >
                Civitai <ExternalLinkIcon size={12} />
              </a>
            </div>
          </Modal.Header>

          <Modal.Body className="flex flex-col gap-4">
            <StatsStrip stats={model.stats} />
            <Section label="Version">
              <VersionSelector />
            </Section>
            <VersionNotes version={version} />
            <TriggerWords version={version} />
            <RecommendedSettings />
            {model.description && <AboutSection description={model.description} />}
            {(model.tags ?? []).length > 0 && (
              <Section label="Tags">
                <div className="flex flex-wrap gap-1.5">
                  {model.tags.map((t) => (
                    <Chip key={t}>{t}</Chip>
                  ))}
                </div>
              </Section>
            )}
            <FileDetails version={version} />
            <LicenseChips model={model} />
          </Modal.Body>

          <Modal.Footer className="flex items-center gap-2">
            <a
              href={civitaiModelUrl(model.id)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-default px-3.5 py-2 text-[12.5px] font-medium text-fg-tertiary transition-colors hover:border-border-strong hover:text-fg-secondary"
            >
              Open on Civitai <ExternalLinkIcon size={13} />
            </a>
            <div className="flex-1" />
            <DownloadAction version={version} />
            <button
              type="button"
              onClick={close}
              className="rounded-lg bg-accent px-4 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-accent-hover"
            >
              Done
            </button>
          </Modal.Footer>
        </>
      )}
    </Modal.Column>
  );
}

/**
 * Skeleton shown while the CivitAI metadata fetch is in flight. Mirrors the
 * real column's structure (header chips → title → byline → stats strip →
 * section blocks → footer) so the layout doesn't shift when the data lands.
 * Subtle pulse so it reads as "loading" without being distracting.
 */
function MetadataSkeleton() {
  return (
    <>
      <Modal.Header className="flex flex-col gap-2.5">
        <div className="flex items-start gap-2">
          <div className="h-5 w-16 animate-pulse rounded bg-bg-elev" />
          <div className="flex-1" />
          <Modal.Close />
        </div>
        <div className="h-6 w-3/4 animate-pulse rounded bg-bg-elev" />
        <div className="flex items-center gap-2">
          <div className="h-5 w-5 animate-pulse rounded-full bg-bg-elev" />
          <div className="h-3 w-32 animate-pulse rounded bg-bg-elev" />
        </div>
      </Modal.Header>
      <Modal.Body className="flex flex-col gap-4">
        {/* Stats strip */}
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-md bg-bg-elev" />
          ))}
        </div>
        {/* Version selector */}
        <div className="flex flex-col gap-1.5">
          <div className="h-3 w-16 animate-pulse rounded bg-bg-elev" />
          <div className="h-9 w-full animate-pulse rounded-md bg-bg-elev" />
        </div>
        {/* Two text-section placeholders */}
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <div className="h-3 w-24 animate-pulse rounded bg-bg-elev" />
            <div className="h-3 w-full animate-pulse rounded bg-bg-elev" />
            <div className="h-3 w-5/6 animate-pulse rounded bg-bg-elev" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-bg-elev" />
          </div>
        ))}
        {/* File details */}
        <div className="flex flex-col gap-1.5">
          <div className="h-3 w-20 animate-pulse rounded bg-bg-elev" />
          <div className="h-16 w-full animate-pulse rounded-md bg-bg-elev" />
        </div>
      </Modal.Body>
      <Modal.Footer className="flex items-center gap-2">
        <div className="h-9 w-36 animate-pulse rounded-lg bg-bg-elev" />
        <div className="flex-1" />
        <div className="h-9 w-28 animate-pulse rounded-lg bg-bg-elev" />
        <div className="h-9 w-16 animate-pulse rounded-lg bg-bg-elev" />
      </Modal.Footer>
    </>
  );
}

/**
 * Failure state — explains what broke and gives the user usable escape
 * hatches instead of a dead text blob. Always offers Retry; when we know
 * the CivitAI model id (the common path, since both `open()` and the
 * file-resolver set it before fetching), the "Open on Civitai" link is
 * deep-linked so the user can manually grab the model from there.
 */
function MetadataErrorState({
  error, modelId, onRetry,
}: { error: string; modelId: number | null; onRetry: () => void }) {
  return (
    <>
      <Modal.Header className="flex flex-col gap-2.5">
        <div className="flex items-start gap-2">
          <Chip tone="warn" className="uppercase tracking-tag">Error</Chip>
          <div className="flex-1" />
          <Modal.Close />
        </div>
        <h2 className="text-[20px] font-semibold leading-tight text-fg-primary">
          Couldn’t load metadata
        </h2>
        <div className="text-[12px] text-fg-tertiary">
          {error}
        </div>
      </Modal.Header>
      <Modal.Body className="flex flex-col items-start gap-3">
        <div className="text-[12px] text-fg-muted">
          The CivitAI request didn’t come back in time. You can retry, or open the model directly on CivitAI to download a version yourself.
        </div>
      </Modal.Body>
      <Modal.Footer className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-default px-3.5 py-2 text-[12.5px] font-medium text-fg-secondary transition-colors hover:border-border-strong hover:text-fg-primary"
        >
          <ResetIcon size={13} /> Retry
        </button>
        {modelId != null && (
          <a
            href={civitaiModelUrl(modelId)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-default px-3.5 py-2 text-[12.5px] font-medium text-fg-tertiary transition-colors hover:border-border-strong hover:text-fg-secondary"
          >
            Open on Civitai <ExternalLinkIcon size={13} />
          </a>
        )}
      </Modal.Footer>
    </>
  );
}
