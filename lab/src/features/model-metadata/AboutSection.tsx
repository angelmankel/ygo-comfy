import { useLayoutEffect, useRef, useState } from 'react';
import { Section } from './Section';
import { stripHtml } from './civitai';

/**
 * "About" section with an expand/collapse toggle. Descriptions vary wildly in
 * length — clamped to 6 lines by default, with a "Show more" link revealed only
 * when the content actually overflows that clamp.
 */
export function AboutSection({ description }: { description: string }) {
  const text = stripHtml(description);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLParagraphElement | null>(null);

  // Measure after layout so we only render the toggle when the clamp is hiding
  // content. `scrollHeight > clientHeight` is the cleanest cross-browser check.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // Always measure against the clamped state — temporarily clamp if needed.
      const wasExpanded = !el.classList.contains('line-clamp-6');
      if (wasExpanded) el.classList.add('line-clamp-6');
      setOverflows(el.scrollHeight > el.clientHeight + 1);
      if (wasExpanded) el.classList.remove('line-clamp-6');
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  if (!text) return null;

  return (
    <Section label="About">
      <p
        ref={ref}
        className={`whitespace-pre-line text-[12px] leading-relaxed text-fg-tertiary ${
          expanded ? '' : 'line-clamp-6'
        }`}
      >
        {text}
      </p>
      {overflows && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="self-start text-[11px] font-medium text-accent-fg hover:underline"
        >
          {expanded ? 'Hide' : 'Show more'}
        </button>
      )}
    </Section>
  );
}
