import type { CivitaiModelVersion } from './civitai';
import { Section } from './Section';
import { CopyIcon } from '@/components/ui/icons';

/** A version's `trainedWords` as click-to-copy chips. Hidden when there are none. */
export function TriggerWords({ version }: { version: CivitaiModelVersion }) {
  const trainedWords = version.trainedWords ?? [];
  if (trainedWords.length === 0) return null;
  const copy = (word: string) => {
    navigator.clipboard?.writeText(word).catch(() => { /* clipboard unavailable */ });
  };
  return (
    <Section label="Trigger words">
      <div className="flex flex-wrap gap-1.5">
        {trainedWords.map((word) => (
          <button
            key={word}
            type="button"
            onClick={() => copy(word)}
            className="flex items-center gap-1.5 rounded-md border border-border-default bg-bg-elev px-2 py-1 text-[11.5px] font-medium text-fg-secondary transition-colors hover:border-border-strong"
          >
            {word}
            <span className="text-fg-dim"><CopyIcon size={11} /></span>
          </button>
        ))}
      </div>
    </Section>
  );
}
