import { useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Field } from '@/components/ui/Field';
import { Slider } from '@/components/ui/Slider';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { cn } from '@/lib/cn';
import { CloseIcon, SettingsIcon, LinkIcon, LinkBreakIcon } from '@/components/ui/icons';
import { fileToImageState, urlToImageState } from './imageOps';
import { EditImageModal } from './EditImageModal';

const SIZE_OPTIONS = ['256', '384', '512', '640', '768', '896', '1024', '1280', '1536', '1792', '2048'];

/**
 * "Input Image" parameter section — drop a file, paste from clipboard, or
 * click to browse. Shows a thumbnail of the current image once set, with
 * Edit / Clear / Replace controls and the img2img Denoise + Max size knobs.
 */
export function InputImageSection() {
  const inputImage = useStore(s => s.workflow.inputImage);
  const inputDenoise = useStore(s => s.workflow.inputDenoise);
  const inputMaxSize = useStore(s => s.workflow.inputMaxSize);
  const inputMinSize = useStore(s => s.workflow.inputMinSize);
  const setWorkflow = useStore(s => s.setWorkflow);
  const setStatus = useStore(s => s.setStatus);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [sizeLocked, setSizeLocked] = useState(false);

  const ingest = async (file: File | null | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setStatus(`${file.name} is not an image`, 'error');
      return;
    }
    try {
      const state = await fileToImageState(file);
      setWorkflow({ inputImage: state });
      setStatus(`Loaded ${state.width}×${state.height} input image`, 'ok');
    } catch (err) {
      setStatus(`Failed to read image: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  /**
   * Unified drop handler — accepts:
   *   1. Native files (the existing flow)
   *   2. History/Collections drag payload (`application/x-imagelab-image`):
   *      `{ url, name }` — we fetch the URL and ingest the blob.
   *   3. `text/uri-list` / `text/plain` containing an http(s) URL fallback.
   */
  const handleDataTransfer = async (dt: DataTransfer | null | undefined) => {
    if (!dt) return;
    const file = dt.files?.[0];
    if (file) { await ingest(file); return; }
    let url = '';
    let name = 'image.png';
    try {
      const json = dt.getData('application/x-imagelab-image');
      if (json) {
        const parsed = JSON.parse(json) as { url?: string; name?: string };
        if (parsed.url) { url = parsed.url; name = parsed.name || name; }
      }
    } catch { /* ignore — fall through to uri-list */ }
    if (!url) {
      const fromList = dt.getData('text/uri-list').split('\n').find(s => s.trim() && !s.startsWith('#'));
      url = fromList?.trim() || dt.getData('text/plain').trim();
    }
    if (!url || !/^https?:|^blob:|^data:/.test(url)) return;
    try {
      const state = await urlToImageState(url, name);
      setWorkflow({ inputImage: state });
      setStatus(`Loaded ${state.width}×${state.height} input image`, 'ok');
    } catch (err) {
      setStatus(`Failed to load image: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const dropHandlers = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragging(true); },
    onDragLeave: () => setDragging(false),
    onDrop: async (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      await handleDataTransfer(e.dataTransfer);
    },
  };

  const enabled = inputImage != null;

  return (
    <section className="flex flex-col gap-2">
      <SectionHeader
        label="INPUT IMAGE"
        right={
          enabled ? (
            <Switch
              checked={enabled}
              onCheckedChange={(on) => { if (!on) setWorkflow({ inputImage: null }); }}
              ariaLabel="Disable input image"
            />
          ) : undefined
        }
      />

      {!enabled ? (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          {...dropHandlers}
          onPaste={async (e) => {
            const item = Array.from(e.clipboardData?.items ?? []).find(i => i.type.startsWith('image/'));
            const f = item?.getAsFile();
            if (f) await ingest(f);
          }}
          className={cn(
            'flex h-32 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-3 py-2 text-center transition-colors',
            dragging
              ? 'border-accent bg-accent-soft/40 text-accent-fg'
              : 'border-border-default bg-bg-input text-fg-muted hover:border-border-strong hover:text-fg-tertiary',
          )}
        >
          <span className="text-[13px] font-medium">Drop image, click, or paste</span>
          <span className="text-[10px] text-fg-dim">img2img enabled when set · drag a history thumbnail here</span>
        </button>
      ) : (
        <div
          {...dropHandlers}
          className={cn(
            'flex flex-col gap-2 rounded-lg border-2 border-dashed transition-colors',
            dragging ? 'border-accent bg-accent-soft/40 p-2' : 'border-transparent',
          )}
        >
          <div className="flex gap-2.5">
            <div className="relative aspect-square w-[88px] shrink-0 overflow-hidden rounded-lg border border-border-default bg-bg-input">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={inputImage.dataUrl}
                alt={inputImage.name}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => setWorkflow({ inputImage: null })}
                aria-label="Clear input image"
                title="Clear input image"
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white/90 backdrop-blur-md hover:bg-red-500/80"
              >
                <CloseIcon size={11} />
              </button>
            </div>
            <div className="flex min-w-0 flex-1 flex-col justify-between gap-1.5">
              <div className="flex min-w-0 flex-col">
                <div className="truncate text-[12px] font-medium text-fg-secondary" title={inputImage.name}>
                  {inputImage.name}
                </div>
                <div className="font-mono text-[10px] text-fg-dim">
                  {inputImage.width}×{inputImage.height}
                </div>
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setEditorOpen(true)}
                  className="flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-border-default bg-bg-elev px-2 text-[11px] font-medium text-fg-tertiary hover:border-accent-hover hover:text-accent-fg"
                >
                  <SettingsIcon size={11} /> Edit
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-8 items-center justify-center rounded-md border border-border-default bg-bg-elev px-2.5 text-[11px] font-medium text-fg-tertiary hover:border-border-strong hover:text-fg-secondary"
                  title="Replace with a different image"
                >
                  Replace
                </button>
              </div>
            </div>
          </div>

          <Field label="Denoise">
            <Slider
              value={inputDenoise}
              onValueChange={(v) => setWorkflow({ inputDenoise: v })}
              min={0}
              max={1}
              step={0.01}
              ariaLabel="Input image denoise"
            />
            <span className="w-12 shrink-0 text-right text-[12px] font-medium tabular-nums text-fg-secondary">
              {inputDenoise.toFixed(2)}
            </span>
          </Field>
          <Field label="Size range">
            <div className="flex flex-1 items-center gap-1.5">
              <Select
                value={String(inputMinSize)}
                onValueChange={(v) => {
                  const min = Number(v) || 0;
                  if (sizeLocked) setWorkflow({ inputMinSize: min, inputMaxSize: min });
                  else setWorkflow({ inputMinSize: min, inputMaxSize: Math.max(min, inputMaxSize) });
                }}
                options={SIZE_OPTIONS}
                ariaLabel="Input image min size"
              />
              <button
                type="button"
                onClick={() => {
                  const next = !sizeLocked;
                  setSizeLocked(next);
                  if (next) setWorkflow({ inputMaxSize: inputMinSize });
                }}
                aria-pressed={sizeLocked}
                title={sizeLocked ? 'Unlink min/max' : 'Link min/max to the same value'}
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors',
                  sizeLocked
                    ? 'border-accent/60 bg-accent/15 text-accent'
                    : 'border-border-default bg-bg-elev text-fg-muted hover:border-border-strong hover:text-fg-secondary',
                )}
              >
                {sizeLocked ? <LinkIcon size={12} /> : <LinkBreakIcon size={12} />}
              </button>
              <Select
                value={String(inputMaxSize)}
                onValueChange={(v) => {
                  const max = Number(v) || 1024;
                  if (sizeLocked) setWorkflow({ inputMinSize: max, inputMaxSize: max });
                  else setWorkflow({ inputMaxSize: max, inputMinSize: Math.min(inputMinSize, max) });
                }}
                options={SIZE_OPTIONS}
                ariaLabel="Input image max size"
              />
            </div>
            <span className="shrink-0 text-[10px] text-fg-dim">longest edge</span>
          </Field>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          await ingest(f);
          e.target.value = '';
        }}
      />

      {editorOpen && inputImage && (
        <EditImageModal
          image={inputImage}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </section>
  );
}
