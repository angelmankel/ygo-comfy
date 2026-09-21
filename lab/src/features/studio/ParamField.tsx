/**
 * One knob from the loaded workflow, rendered as whatever control its declared type deserves.
 *
 * Nothing here is workflow-specific: the type, the options and the range all come from
 * `/object_info`, so a node nobody has seen before still gets a sensible control.
 *
 * Touch first. Every control is at least 44px tall, sliders get a big thumb, and a numeric knob
 * shows its value as text beside the track so a fingertip never has to be precise to read it.
 */
import { Select } from '@/components/ui/Select';
import { Slider } from '@/components/ui/Slider';
import { Switch } from '@/components/ui/Switch';
import { IconButton } from '@/components/ui/IconButton';
import { ResetIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import { paramLabel, randomSeed, type WorkflowParam } from './params';

interface Props {
  param: WorkflowParam;
  value: unknown;
  onChange: (value: unknown) => void;
  onReset?: () => void;
  /** Bigger type and spacing for the phone's simple mode. */
  large?: boolean;
}

export function ParamField({ param, value, onChange, onReset, large }: Props) {
  const label = paramLabel(param);
  // "Changed" means changed from what the workflow itself was saved with — not from the node
  // class's default. A prompt node's class default is the empty string, so comparing against that
  // marked every workflow's own prompt as edited and offered to "reset" it to nothing.
  const changed = value !== param.value;

  return (
    <div className={cn('flex flex-col gap-1.5', large ? 'py-2' : 'py-1')}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn('truncate font-medium text-fg-secondary', large ? 'text-[14px]' : 'text-[12px]')}>
          {label}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {(param.type === 'INT' || param.type === 'FLOAT') && (
            <span className={cn('tabular-nums text-fg-primary', large ? 'text-[14px]' : 'text-[12px]')}>
              {formatNumber(value, param)}
            </span>
          )}
          {changed && onReset && (
            <IconButton aria-label={`Reset ${label}`} title="Back to the value saved in ComfyUI" onClick={onReset}>
              <ResetIcon size={13} />
            </IconButton>
          )}
        </div>
      </div>
      <Control param={param} value={value} onChange={onChange} large={large} />
    </div>
  );
}

function Control({ param, value, onChange, large }: Omit<Props, 'onReset'>) {
  switch (param.type) {
    case 'BOOLEAN':
      return (
        <div className="flex h-11 items-center">
          <Switch checked={Boolean(value)} onCheckedChange={onChange} ariaLabel={paramLabel(param)} />
        </div>
      );

    case 'COMBO': {
      const options = (param.options ?? []).map(o => String(o));
      if (!options.length) {
        // A combo whose list is empty means the server has nothing to offer — no checkpoints
        // installed, say. Saying so beats an empty dropdown that looks broken.
        return <p className="text-[12px] text-fg-muted">Nothing installed for this input.</p>;
      }
      return (
        <Select
          value={String(value ?? options[0])}
          onValueChange={onChange}
          options={options}
          ariaLabel={paramLabel(param)}
          triggerClassName={large ? 'h-11 text-[14px]' : undefined}
        />
      );
    }

    case 'STRING':
      return param.multiline ? (
        <textarea
          value={String(value ?? '')}
          onChange={e => onChange(e.target.value)}
          rows={large ? 4 : 3}
          aria-label={paramLabel(param)}
          className={cn(
            'scroll-y w-full resize-y rounded-lg border border-border-subtle bg-bg-base px-3 py-2.5',
            'text-fg-primary outline-none placeholder:text-fg-muted focus:border-accent',
            large ? 'text-[15px]' : 'text-[13px]',
          )}
        />
      ) : (
        <input
          value={String(value ?? '')}
          onChange={e => onChange(e.target.value)}
          aria-label={paramLabel(param)}
          className={cn(
            'h-11 w-full rounded-lg border border-border-subtle bg-bg-base px-3',
            'text-fg-primary outline-none focus:border-accent',
            large ? 'text-[15px]' : 'text-[13px]',
          )}
        />
      );

    case 'INT':
    case 'FLOAT': {
      // A seed has a nominal range of 0..2^63; a slider across that is meaningless, so it gets a
      // number box and a dice instead.
      if (param.seedLike) {
        return (
          <div className="flex items-center gap-2">
            <input
              inputMode="numeric"
              value={String(value ?? 0)}
              onChange={e => onChange(Number(e.target.value.replace(/[^0-9]/g, '')) || 0)}
              aria-label={paramLabel(param)}
              className="h-11 min-w-0 flex-1 rounded-lg border border-border-subtle bg-bg-base px-3 font-mono text-[13px] text-fg-primary outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={() => onChange(randomSeed())}
              className="h-11 shrink-0 rounded-lg border border-border-subtle bg-bg-panel px-3 text-[13px] text-fg-secondary"
            >
              Roll
            </button>
          </div>
        );
      }
      const { min, max, step } = sliderRange(param);
      return (
        <div className="flex h-11 items-center">
          <Slider
            value={Number(value ?? param.default ?? min)}
            onValueChange={onChange}
            min={min}
            max={max}
            step={step}
            ariaLabel={paramLabel(param)}
            className="w-full"
          />
        </div>
      );
    }

    default:
      return <p className="text-[12px] text-fg-muted">{String(value ?? '')}</p>;
  }
}

/**
 * A usable slider range.
 *
 * object_info's declared bounds are frequently the type's limits rather than anything a person
 * would want — steps can say 0..10000, cfg 0..100. Where the declared range is absurd, narrow it
 * to the part people actually use, but never so far that it excludes the workflow's own value.
 */
function sliderRange(p: WorkflowParam) {
  const isFloat = p.type === 'FLOAT';
  let min = p.min ?? 0;
  let max = p.max ?? (isFloat ? 10 : 100);
  const SANE: Record<string, [number, number]> = {
    steps: [1, 100], cfg: [1, 20], denoise: [0, 1], guidance: [0, 20],
    width: [256, 2048], height: [256, 2048], batch_size: [1, 8],
  };
  const sane = SANE[p.name];
  if (sane) { min = Math.max(min, sane[0]); max = Math.min(max, sane[1]); }
  const current = Number(p.value);
  if (Number.isFinite(current)) { min = Math.min(min, current); max = Math.max(max, current); }
  const step = p.step ?? (isFloat ? 0.05 : 1);
  return { min, max, step };
}

function formatNumber(value: unknown, p: WorkflowParam) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  if (p.type === 'INT') return String(Math.round(n));
  // Show only as many decimals as the step implies, so 0.6 is not "0.6000000000000001".
  const decimals = (p.step ?? 0.05) < 0.01 ? 3 : (p.step ?? 0.05) < 0.1 ? 2 : 2;
  return n.toFixed(decimals);
}
