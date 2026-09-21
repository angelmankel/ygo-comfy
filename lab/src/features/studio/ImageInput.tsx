/**
 * An image input on the loaded workflow.
 *
 * A `LoadImage` node's `image` widget is a COMBO listing what is already in ComfyUI's input
 * folder — useless on a phone, where the picture you want is in the camera roll and has never
 * been near the server. So the control is an uploader first and a picker second: choose a file
 * (or take a photo), it goes to `input/imagelab/`, and the widget is set to the name the server
 * gave it back.
 *
 * The upload is the same endpoint and subfolder the generate view uses, so the two never collide
 * and neither can overwrite the person's own files.
 */
import { useRef, useState } from 'react';
import { comfyHttpFor, loadImageRef, uploadImage } from '@/lib/comfy';
import { Select } from '@/components/ui/Select';
import { cn } from '@/lib/cn';
import { paramLabel, type WorkflowParam } from './params';

/** A COMBO named `image` on an image-loading node is a picture, not a dropdown. */
export function isImageParam(p: WorkflowParam): boolean {
  return p.type === 'COMBO' && p.name === 'image' && /LoadImage|ImageLoad/i.test(p.nodeType);
}

export function ImageInput({
  param, value, onChange, host, large,
}: {
  param: WorkflowParam;
  value: unknown;
  onChange: (value: unknown) => void;
  host: string;
  large?: boolean;
}) {
  const file = useRef<HTMLInputElement | null>(null);
  const camera = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = String(value ?? '');
  // ComfyUI serves an input image from the same /view endpoint as an output, with type=input.
  const preview = current
    ? `${comfyHttpFor(host)}/view?` + new URLSearchParams({
        filename: current.includes('/') ? current.slice(current.lastIndexOf('/') + 1) : current,
        subfolder: current.includes('/') ? current.slice(0, current.lastIndexOf('/')) : '',
        type: 'input',
      })
    : null;

  const accept = async (picked: File | undefined) => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      // Keep the original name so the workflow stays readable in ComfyUI, but make it unique —
      // `overwrite: true` means a second "photo.jpg" would silently replace the first.
      const safe = picked.name.replace(/[^\w.-]+/g, '-');
      const up = await uploadImage(host, picked, `${Date.now()}-${safe}`);
      onChange(loadImageRef(up));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const options = (param.options ?? []).map(String);

  return (
    <div className={cn('flex flex-col gap-2', large ? 'py-2' : 'py-1')}>
      <span className={cn('font-medium text-fg-secondary', large ? 'text-[14px]' : 'text-[12px]')}>
        {paramLabel(param)}
      </span>

      <div
        onClick={() => file.current?.click()}
        className={cn(
          'relative flex cursor-pointer items-center justify-center overflow-hidden rounded-lg',
          'border border-dashed border-border-subtle bg-bg-base',
          large ? 'h-44' : 'h-32',
        )}
      >
        {preview ? (
          <img src={preview} alt={current} className="h-full w-full object-contain" />
        ) : (
          <span className="px-4 text-center text-[12.5px] text-fg-muted">
            {busy ? 'Uploading…' : 'Tap to choose an image'}
          </span>
        )}
        {busy && <div className="absolute inset-0 bg-black/40" />}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => file.current?.click()}
          className="h-11 flex-1 rounded-lg border border-border-subtle text-[13px] text-fg-secondary"
        >
          Choose
        </button>
        <button
          type="button"
          onClick={() => camera.current?.click()}
          className="h-11 flex-1 rounded-lg border border-border-subtle text-[13px] text-fg-secondary"
        >
          Camera
        </button>
      </div>

      {options.length > 0 && (
        <Select
          value={options.includes(current) ? current : ''}
          onValueChange={onChange}
          options={options}
          placeholder="…or one already on the server"
          ariaLabel={`${paramLabel(param)} — already uploaded`}
          triggerClassName={large ? 'h-11 text-[14px]' : undefined}
        />
      )}

      {error && <p className="text-[12px] text-red-400">{error}</p>}

      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={e => { void accept(e.target.files?.[0]); e.target.value = ''; }}
      />
      {/* `capture` asks Android to open the camera straight away rather than the file browser. */}
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={e => { void accept(e.target.files?.[0]); e.target.value = ''; }}
      />
    </div>
  );
}
