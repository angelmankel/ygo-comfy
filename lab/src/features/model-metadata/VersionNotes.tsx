import { type CivitaiModelVersion, stripHtml } from './civitai';
import { Section } from './Section';

/**
 * The selected version's own notes / changelog (`version.description`) — distinct
 * from the model-level "About". Hidden when the version has no notes.
 */
export function VersionNotes({ version }: { version: CivitaiModelVersion }) {
  const notes = stripHtml(version.description);
  if (!notes) return null;
  return (
    <Section label="Version notes">
      <p className="line-clamp-6 whitespace-pre-line text-[12px] leading-relaxed text-fg-tertiary">
        {notes}
      </p>
    </Section>
  );
}
