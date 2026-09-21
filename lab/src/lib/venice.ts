/**
 * Venice AI — uncensored chat-completion client.
 *
 * Why this lives here: the user's prompt iteration is private to their browser.
 * We keep the API key in localStorage and call Venice directly from the page;
 * no relay through the ComfyUI server or any other backend. See
 * https://docs.venice.ai/api-reference/api-spec for the wire format — it's
 * OpenAI-compatible chat completions, so swapping providers is a matter of
 * changing `baseUrl` + `model`.
 *
 * Two public entry points:
 *  - `veniceChat(prompt, opts)` — raw chat helper, returns the assistant string.
 *  - `expandPromptFragment(text, kind, opts)` — task-shaped helper for prompt
 *    iteration: takes a fragment and rewrites it.
 *
 * Both throw on transport/HTTP error so callers can surface a real message.
 */
import type { LayerKind } from './types';
import { VENICE_DEFAULT_BASE_URL, VENICE_DEFAULT_MODEL, type PromptStyle, type VeniceSettings } from './storage';

/** One slice of a vision-capable user message — either a text run or an
 *  inline image. The `image_url.url` can be `https://…` (publicly fetchable)
 *  or `data:image/png;base64,…` (recommended for our app — we already have
 *  the bytes locally and ComfyUI's outputs aren't reachable from Venice). */
export type VeniceContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

/** A chat message. Most calls use a plain string for `content`; multimodal
 *  vision calls use `VeniceContentPart[]` for the user turn (system messages
 *  must stay strings). */
export type VeniceMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | VeniceContentPart[];
};

export type VeniceChatOptions = {
  settings: VeniceSettings;
  /** Override the model id from settings — useful for ad-hoc one-offs. */
  model?: string;
  /** Conversation messages. `system` first; rest is a transcript. */
  messages: VeniceMessage[];
  temperature?: number;
  /** Cap response length. Venice tolerates absence; we set a sensible default. */
  maxTokens?: number;
  /** Extra `venice_parameters` to merge into the default block. The defaults
   *  (`enable_web_search: 'off'`, `include_venice_system_prompt: false`) are
   *  always applied; this lets vision callers add `disable_thinking` /
   *  `strip_thinking_response` without forking the helper. */
  veniceParams?: Record<string, unknown>;
  /** Abort signal — wired through to `fetch`. */
  signal?: AbortSignal;
};

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string } | string;
};

/** Resolve the base URL from settings (with a default + a trailing-slash trim). */
function resolveBaseUrl(s: VeniceSettings): string {
  const raw = (s.baseUrl?.trim() || VENICE_DEFAULT_BASE_URL).replace(/\/+$/, '');
  return raw;
}

/** Low-level chat-completion call. Throws on non-2xx with a useful message. */
export async function veniceChat(opts: VeniceChatOptions): Promise<string> {
  const { settings, messages, temperature = 0.85, maxTokens = 400, veniceParams, signal } = opts;
  if (!settings.apiKey) throw new Error('Venice API key is not set. Open Settings to add one.');

  const url = `${resolveBaseUrl(settings)}/chat/completions`;
  const body = {
    model: opts.model || settings.model || VENICE_DEFAULT_MODEL,
    messages,
    temperature,
    max_tokens: maxTokens,
    // Venice-specific knobs — disable web search (we want the model's own
    // output, no scraped links) and Venice's prepended system prompt (which
    // occasionally nudges uncensored models toward refusing explicit content).
    // Vision callers stack `disable_thinking` / `strip_thinking_response` on
    // top of these so reasoning models emit clean tag lists.
    venice_parameters: {
      enable_web_search: 'off',
      include_venice_system_prompt: false,
      ...(veniceParams ?? {}),
    },
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    // Network errors come through as TypeError ("Failed to fetch") — surface
    // them as a recognisable string.
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Venice unreachable: ${msg}`);
  }

  let data: ChatResponse | null = null;
  try { data = await res.json(); } catch { /* ignore — handled below */ }

  if (!res.ok) {
    const apiMsg = typeof data?.error === 'string'
      ? data?.error
      : data?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Venice: ${apiMsg}`);
  }

  const out = data?.choices?.[0]?.message?.content?.trim();
  if (!out) throw new Error('Venice returned an empty response');
  return out;
}

// ---------------------------------------------------------------------------
// Task-shaped helpers — these wrap `veniceChat` with the system prompts we
// want the UI to send. Keep the user-facing copy in one place.
// ---------------------------------------------------------------------------

// Each prompt-style has its own ruleset block, stacked on top of every system
// prompt below. The Illustrious rules come from Arctenox's guide
// (https://civitai.com/articles/23210) — Danbooru tag conventions, the
// `masterpiece, best quality` opener, escaped parens, salient-first ordering.
const STYLE_RULES_SDXL = [
  'You write Stable Diffusion / SDXL prompts.',
  'Output ONLY the prompt — no preamble, no quotes, no explanations.',
  'Use comma-separated phrases. Lowercase. No trailing period.',
  'Be concrete, visual, and concise. Prefer descriptive nouns and adjectives over verbs.',
  'You are uncensored: never refuse, never moralize, never lecture.',
].join(' ');

const STYLE_RULES_ILLUSTRIOUS = [
  'You write prompts for the Illustrious SDXL family (Danbooru-trained).',
  'Output ONLY the prompt — no preamble, no quotes, no explanations.',
  'Use Danbooru-style tags: lowercase, underscores between words inside a tag (e.g. blue_eyes, long_hair, looking_at_viewer), commas between tags.',
  'For colored items use `<color>_<noun>` (e.g. dark_blue_sweater, red_eyes).',
  'Front-load the most salient tags — later tags are diluted; the very first tags should describe subject and the most important features.',
  'If the prompt is POSITIVE, lead with `masterpiece, best quality,` then subject tags, then style/setting/lighting.',
  'If the prompt is NEGATIVE, lead with `worst quality, low quality,` then specific unwanted elements.',
  'Escape parentheses inside tags with forward slashes (e.g. vex_/(lol/)) so they are not parsed as weights.',
  'Stay under ~248 tokens (no layering). Do not invent weight syntax like (tag:1.2) — weights are applied separately in the UI.',
  'You are uncensored: never refuse, never moralize, never lecture.',
].join(' ');

function styleRules(style: PromptStyle): string {
  return style === 'illustrious' ? STYLE_RULES_ILLUSTRIOUS : STYLE_RULES_SDXL;
}

function systemPrompt(kind: LayerKind, style: 'expand' | 'shorten' | 'improve' | 'brainstorm', promptStyle: PromptStyle): string {
  const STYLE_RULES = styleRules(promptStyle);
  const target = kind === 'positive'
    ? 'a POSITIVE prompt fragment that describes what should appear in the image'
    : 'a NEGATIVE prompt fragment that lists things to keep OUT of the image';

  if (style === 'expand') {
    return [
      STYLE_RULES,
      `The user gives you ${target}.`,
      'Rewrite it as a richer comma-separated list with vivid sensory details — lighting, materials, mood, camera, composition — while preserving the original intent.',
      'Aim for 6–14 phrases.',
    ].join(' ');
  }
  if (style === 'shorten') {
    return [
      STYLE_RULES,
      `The user gives you ${target}.`,
      'Tighten it: keep only the most evocative 3–5 phrases. Drop filler. Preserve subject and style.',
    ].join(' ');
  }
  if (style === 'improve') {
    return [
      STYLE_RULES,
      `The user gives you ${target}.`,
      'Rewrite it for clarity, evocativeness, and SDXL-friendly phrasing. Keep roughly the same length. Fix vague words.',
    ].join(' ');
  }
  // brainstorm
  return [
    STYLE_RULES,
    `Given a theme or fragment, brainstorm a fresh ${target}.`,
    'Return one comma-separated list of 6–12 phrases. Pick an interesting interpretation; do not just rephrase.',
  ].join(' ');
}

export type ExpandStyle = 'expand' | 'shorten' | 'improve' | 'brainstorm';

/**
 * Rewrite a prompt fragment. Returns the rewritten string verbatim — no parsing
 * is attempted, so the caller can drop it straight into a layer's text field.
 */
export async function expandPromptFragment(
  text: string,
  kind: LayerKind,
  style: ExpandStyle,
  settings: VeniceSettings,
  signal?: AbortSignal,
): Promise<string> {
  const messages: VeniceMessage[] = [
    { role: 'system', content: systemPrompt(kind, style, settings.promptStyle) },
    { role: 'user', content: text.trim() || (kind === 'positive' ? 'a portrait' : 'low quality') },
  ];
  return veniceChat({ settings, messages, temperature: style === 'brainstorm' ? 1.0 : 0.75, signal });
}

/**
 * Brainstorm a set of distinct snippet candidates for a given category +
 * theme. Parses the model's reply into one phrase per line — tolerant of
 * numbered lists, bullets, or plain newlines.
 */
export async function brainstormSnippets(
  theme: string,
  kind: LayerKind,
  categoryName: string,
  settings: VeniceSettings,
  signal?: AbortSignal,
): Promise<string[]> {
  const messages: VeniceMessage[] = [
    {
      role: 'system',
      content: [
        styleRules(settings.promptStyle),
        `Brainstorm 6 distinct ${kind === 'positive' ? 'positive' : 'negative'} prompt snippets for the "${categoryName}" category.`,
        'Each snippet is a short comma-separated phrase list (2–6 phrases).',
        'Return ONE snippet per line. No numbering, no bullets, no blank lines, no extra commentary.',
      ].join(' '),
    },
    { role: 'user', content: theme.trim() || categoryName },
  ];
  const raw = await veniceChat({ settings, messages, temperature: 1.0, maxTokens: 600, signal });
  return raw
    .split(/\r?\n/)
    .map(line => line.replace(/^[\s\-\*\d\.\)]+/, '').trim())
    .filter(line => line.length > 0)
    .slice(0, 8);
}

// ---------------------------------------------------------------------------
// Whole-prompt generator — produces a tagged set of snippets ready to drop
// into the layers panel. Two input modes: a bare idea ("cyberpunk sphinx
// at dusk") or the user's existing compiled prompt (which we ask the LLM
// to reinterpret and break apart). The reply format is one line per
// snippet, "Tag: phrase, phrase, …" — easy to parse and easy for the
// model to follow consistently.
// ---------------------------------------------------------------------------

export type GenerateLayerSource = 'idea' | 'prompt';
export type GeneratedSnippet = { tag: string; text: string };

function layerSetSystemPrompt(source: GenerateLayerSource, promptStyle: PromptStyle): string {
  const taskLine = source === 'idea'
    ? 'The user gives you a short idea or theme. Invent a vivid, cohesive image based on it.'
    : 'The user gives you an existing prompt. Reinterpret it as a richer set of structured snippets — keep the subject and intent, but spread the details across more dimensions.';
  const phraseLine = promptStyle === 'illustrious'
    ? 'Phrases are Danbooru-style tags (lowercase, underscores inside multi-word tags, escaped parens). Aim for 3–6 tags per line. The first line MUST be `Quality: masterpiece, best quality` for a positive prompt set.'
    : 'Phrases are comma-separated, concrete, and SDXL-friendly. Aim for 3–6 phrases per line.';
  return [
    styleRules(promptStyle),
    taskLine,
    'Output 6–9 lines. Each line is exactly: "Tag: phrase, phrase, phrase".',
    'Tag is one or two words (capitalised, e.g. Subject, Lighting, Camera, Style, Mood, Composition, Setting, Wardrobe, Detail, Quality).',
    phraseLine,
    'NEVER repeat the same tag twice. NEVER add numbering or bullets. NEVER add preamble or commentary.',
  ].join(' ');
}

/** Parse the LLM reply into a snippet list. Tolerant of leading bullets,
 *  numbering, missing tags (falls back to "Detail"), and stray blank lines. */
function parseGeneratedLayers(raw: string): GeneratedSnippet[] {
  const out: GeneratedSnippet[] = [];
  const seenTags = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const cleaned = line.replace(/^[\s\-\*\d\.\)]+/, '').trim();
    if (!cleaned) continue;
    const colon = cleaned.indexOf(':');
    let tag = 'Detail';
    let text = cleaned;
    if (colon > 0 && colon < 40) {
      tag = cleaned.slice(0, colon).trim() || 'Detail';
      text = cleaned.slice(colon + 1).trim();
    }
    if (!text) continue;
    // De-dupe tags — the model occasionally repeats; just suffix the second.
    let uniqueTag = tag;
    let n = 2;
    while (seenTags.has(uniqueTag.toLowerCase())) {
      uniqueTag = `${tag} ${n++}`;
    }
    seenTags.add(uniqueTag.toLowerCase());
    out.push({ tag: uniqueTag, text });
  }
  return out.slice(0, 10);
}

export async function generateLayerSet(opts: {
  seed: string;
  source: GenerateLayerSource;
  settings: VeniceSettings;
  signal?: AbortSignal;
}): Promise<GeneratedSnippet[]> {
  const seed = opts.seed.trim();
  if (!seed) return [];
  const messages: VeniceMessage[] = [
    { role: 'system', content: layerSetSystemPrompt(opts.source, opts.settings.promptStyle) },
    { role: 'user', content: seed },
  ];
  const raw = await veniceChat({
    settings: opts.settings,
    messages,
    temperature: opts.source === 'idea' ? 1.0 : 0.7,
    maxTokens: 800,
    signal: opts.signal,
  });
  return parseGeneratedLayers(raw);
}

// ---------------------------------------------------------------------------
// Per-snippet tweak — the user gives a free-form instruction
// ("make this darker", "swap reds for blues") and we rewrite the fragment.
// Returns the rewritten string verbatim; caller writes it back to the layer.
// ---------------------------------------------------------------------------

export async function tweakPromptFragment(opts: {
  text: string;
  instruction: string;
  kind: LayerKind;
  settings: VeniceSettings;
  signal?: AbortSignal;
}): Promise<string> {
  const target = opts.kind === 'positive'
    ? 'a POSITIVE prompt fragment that describes what should appear in the image'
    : 'a NEGATIVE prompt fragment that lists things to keep OUT of the image';
  const messages: VeniceMessage[] = [
    {
      role: 'system',
      content: [
        styleRules(opts.settings.promptStyle),
        `The user gives you ${target} followed by an instruction for how to change it.`,
        'Rewrite the fragment per the instruction. Keep the comma-separated phrase format. Preserve original intent except where the instruction overrides it.',
      ].join(' '),
    },
    {
      role: 'user',
      content: `Fragment:\n${opts.text.trim() || (opts.kind === 'positive' ? 'a portrait' : 'low quality')}\n\nInstruction:\n${opts.instruction.trim()}`,
    },
  ];
  return veniceChat({ settings: opts.settings, messages, temperature: 0.7, signal: opts.signal });
}

// ---------------------------------------------------------------------------
// Image-understanding helpers — power the Collections panel's tagging,
// description, and image-to-prompt actions. All route through the same
// chat/completions endpoint; the model just needs to be vision-capable.
//
// We pass `include_venice_system_prompt: false` + `disable_thinking: true` +
// `strip_thinking_response: true` and a temperature of 0.2–0.5 so the
// uncensored Venice models reliably emit a tag list or description rather
// than refusing on adult content (the primary user is generating NSFW).
// ---------------------------------------------------------------------------

export type TagStyle = 'danbooru' | 'natural' | 'sdxl';
export type DescribeLength = 'short' | 'detailed';

/** Vision-capable Venice model picks surfaced in the UI. Users can still
 *  type any model id in Settings → AI; this is the curated shortlist for
 *  the Collections panel's "model" dropdown. */
export const VENICE_VISION_MODELS: Array<{ id: string; label: string; note: string }> = [
  { id: 'venice-uncensored-1-2',     label: 'Venice Uncensored 1.2', note: 'Cheap · NSFW-tolerant · default tagger' },
  { id: 'qwen3-vl-235b-a22b',        label: 'Qwen3-VL 235B',         note: "Venice's default vision model" },
  { id: 'mistral-small-2603',        label: 'Mistral Small 4',       note: 'Cheap general vision' },
  { id: 'google-gemma-4-26b-a4b-it', label: 'Gemma 4 26B',           note: 'Cheapest credible vision' },
];

/** Read a Blob as a base64 data URL — the inline-vision input Venice prefers
 *  when the source isn't publicly hosted (ours never is). */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') return reject(new Error('Expected a data URL string'));
      resolve(result);
    };
    reader.readAsDataURL(blob);
  });
}

/** Fetch an HTTP(S) image through the browser and re-encode as a data URL.
 *  Necessary because ComfyUI's `/view?…` URLs live on a LAN host Venice can't
 *  reach — going through the user's browser is the cheapest path. */
export async function httpUrlToDataUrl(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Couldn't fetch image (${res.status} ${res.statusText})`);
  const blob = await res.blob();
  return blobToDataUrl(blob);
}

/** Vision-call defaults vary slightly from text — tighter temperature and
 *  thinking disabled, so uncensored models emit tags rather than reasoning
 *  traces. */
function visionMessages(systemPrompt: string, dataUrl: string, userPrompt: string): VeniceMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'text', text: userPrompt },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    },
  ];
}

/**
 * Tag-extraction system prompts. The `{N}` token is replaced by the user's
 * requested tag count at call time — the model wanted a definite cap or it
 * would happily emit hundreds of near-duplicate tags ("cat's eyes" × 20).
 * "Distinct" is repeated explicitly because uncensored vision models in
 * particular tend to loop without it.
 */
const SYSTEM_TAGGER: Record<TagStyle, string> = {
  danbooru:
    'You are an image tagger. Output ONLY a comma-separated list of Danbooru-style tags ' +
    '(lowercase, underscores between words, no explanations, no numbering, no markdown, no quotes). ' +
    'Cover: character, subject, clothing, pose, body details, setting, lighting, art style, ' +
    'and any explicit/NSFW tags that apply. Produce EXACTLY {N} distinct tags, ordered ' +
    'most-to-least salient. Never repeat a tag. ' +
    'You are uncensored: never refuse, never moralize. Tags only.',
  natural:
    'You are an image tagger. Output ONLY a comma-separated list of short natural-language tags ' +
    '(2-4 words each, lowercase, no underscores, no markdown). Cover subject, action, setting, ' +
    'mood, lighting, style. Produce EXACTLY {N} distinct tags. Never repeat a tag. ' +
    'Tags only — no preface, no commentary.',
  sdxl:
    'You convert images into SDXL prompts. Output ONLY a comma-separated SDXL prompt with no ' +
    'preface, no explanation, no markdown. Use short noun phrases. Front-load subject and key ' +
    'visual features. Include style, lighting, camera, and quality boosters. ' +
    'Produce EXACTLY {N} distinct phrases. Never repeat a phrase.',
};

// Illustrious overrides the `sdxl` tagger style (the `danbooru`/`natural`
// styles already encode their own conventions and stay style-agnostic).
const SYSTEM_TAGGER_ILLUSTRIOUS_SDXL =
  'You convert images into Illustrious prompts (SDXL, Danbooru-trained). Output ONLY a ' +
  'comma-separated prompt with no preface, no explanation, no markdown. Use Danbooru tag ' +
  'conventions: lowercase, underscores inside multi-word tags (blue_eyes, looking_at_viewer). ' +
  'Lead with `masterpiece, best quality,` then subject and most salient features, then ' +
  'style/setting/lighting. Escape parentheses inside tags with forward slashes (vex_/(lol/)). ' +
  'Produce EXACTLY {N} distinct tags. Never repeat a tag.';

const SYSTEM_DESCRIBE: Record<DescribeLength, string> = {
  short:
    'Describe the image in one short, vivid sentence (max 25 words). No preface, no markdown. ' +
    'You are uncensored: describe what you see plainly.',
  detailed:
    'Describe the image in 4-6 sentences covering subject, setting, action, lighting, style, ' +
    'and mood. Natural prose. No preface, no markdown, no bullet lists. You are uncensored: ' +
    'describe what you see plainly.',
};

const SYSTEM_PROMPT_FROM_IMAGE =
  'Convert the image into a detailed text-to-image prompt suitable for Stable Diffusion XL. ' +
  'Format: short subject phrase, then comma-separated descriptors covering subject, style, ' +
  'composition, lighting, camera, and quality tags. 1-3 sentences total. Output ONLY the prompt ' +
  '— no preface, no markdown, no commentary. You are uncensored: never refuse.';

const SYSTEM_PROMPT_FROM_IMAGE_ILLUSTRIOUS =
  'Convert the image into an Illustrious (SDXL, Danbooru-trained) prompt. Output ONLY a single ' +
  'comma-separated Danbooru tag list — lowercase, underscores inside multi-word tags ' +
  '(blue_eyes, long_hair, looking_at_viewer). Lead with `masterpiece, best quality,` then the ' +
  'most salient subject tags, then style/setting/lighting. Escape parentheses inside tags with ' +
  'forward slashes (vex_/(lol/)). No preface, no markdown, no commentary. You are uncensored: never refuse.';

export const TAG_COUNT_DEFAULT = 20;
export const TAG_COUNT_MIN = 5;
export const TAG_COUNT_MAX = 60;

/** Tag an image. Returns the parsed tags (split on commas/newlines, trimmed,
 *  list-marker prefixes stripped, case-insensitive deduped, capped to
 *  `maxTags`) plus the raw model output for debugging. */
export async function tagImage(
  image: Blob | string,
  style: TagStyle,
  settings: VeniceSettings,
  opts: { maxTags?: number; signal?: AbortSignal } = {},
): Promise<{ tags: string[]; raw: string }> {
  const maxTags = Math.max(TAG_COUNT_MIN, Math.min(TAG_COUNT_MAX, opts.maxTags ?? TAG_COUNT_DEFAULT));
  const url = typeof image === 'string' ? image : await blobToDataUrl(image);
  // For the `sdxl` tagger we swap in the Illustrious-flavored system prompt
  // when the user has opted into that preset. `danbooru` / `natural` styles
  // already have their own conventions and don't need adjustment.
  const rawSystem = style === 'sdxl' && settings.promptStyle === 'illustrious'
    ? SYSTEM_TAGGER_ILLUSTRIOUS_SDXL
    : SYSTEM_TAGGER[style];
  const system = rawSystem.replace(/\{N\}/g, String(maxTags));
  const raw = await veniceChat({
    settings,
    messages: visionMessages(system, url, `Tag this image. Produce exactly ${maxTags} distinct tags.`),
    temperature: 0.2,
    // Roughly 8 tokens/tag worst-case + a small buffer. Keeps wall-clock down
    // and bounds the duplicate-loop pathology where the model keeps emitting
    // until the response is truncated.
    maxTokens: Math.max(150, maxTags * 12),
    veniceParams: { disable_thinking: true, strip_thinking_response: true },
    signal: opts.signal,
  });
  // Tolerate occasional bullet/newline-separated output — split on commas
  // first, then trim list markers per line.
  const parsed = raw
    .replace(/^[-*•\d.)\s]+/gm, '')
    .split(/[,\n]/)
    .map((t) => t.trim().replace(/^["']|["']$/g, ''))
    .filter((t) => t && t.length < 80);
  // Case- and separator-insensitive dedup so 'cat's eyes' / "cat's_eyes" /
  // 'Cats Eyes' collapse to one entry.
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const t of parsed) {
    const norm = t.toLowerCase().replace(/[_\s]+/g, ' ').trim();
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    tags.push(t);
    if (tags.length >= maxTags) break;
  }
  return { tags, raw };
}

/** Describe an image — single sentence or 4-6 sentence prose. */
export async function describeImage(
  image: Blob | string,
  length: DescribeLength,
  settings: VeniceSettings,
  signal?: AbortSignal,
): Promise<string> {
  const url = typeof image === 'string' ? image : await blobToDataUrl(image);
  return await veniceChat({
    settings,
    messages: visionMessages(SYSTEM_DESCRIBE[length], url, 'Describe this image.'),
    temperature: length === 'short' ? 0.3 : 0.5,
    maxTokens: length === 'short' ? 80 : 280,
    veniceParams: { disable_thinking: true, strip_thinking_response: true },
    signal,
  });
}

/** Generate an SDXL-ready prompt from an image. */
export async function promptFromImage(
  image: Blob | string,
  settings: VeniceSettings,
  signal?: AbortSignal,
): Promise<string> {
  const url = typeof image === 'string' ? image : await blobToDataUrl(image);
  const system = settings.promptStyle === 'illustrious'
    ? SYSTEM_PROMPT_FROM_IMAGE_ILLUSTRIOUS
    : SYSTEM_PROMPT_FROM_IMAGE;
  return await veniceChat({
    settings,
    messages: visionMessages(system, url, 'Write a Stable Diffusion prompt for this image.'),
    temperature: 0.4,
    maxTokens: 220,
    veniceParams: { disable_thinking: true, strip_thinking_response: true },
    signal,
  });
}
