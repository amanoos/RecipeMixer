import type { ExtractedRecipe, RecipeDraft } from '../schemas/import.js';

/**
 * Reads a schema.org Recipe from the JSON-LD blocks of an HTML page.
 *
 * The input is untrusted, so every step is bounded: a forward-only scan for script blocks, a cap on
 * blocks, nodes and depth, and a cap on the text taken from each field. Output is plain text only.
 */

const MAX_BLOCKS = 50;
const MAX_NODES = 5000;
const MAX_DEPTH = 6;
const MAX_ITEMS = 100;
const RAW_TEXT_LIMIT = 20_000;

// Limits mirror recipeInputSchema so a draft always fits the form.
const LIMITS = { title: 200, cuisine: 80, description: 5000, ingredient: 200, step: 2000 } as const;

const SCRIPT_START = /<script\b/gi;
const SCRIPT_END = /<\/script\s*>/gi;
const LD_JSON_TYPE = /\btype\s*=\s*["']?\s*application\/ld\+json/i;

/** Finds the contents of every JSON-LD script element. Each search moves forward only, so it is linear. */
function jsonLdBlocks(html: string): string[] {
  const blocks: string[] = [];
  SCRIPT_START.lastIndex = 0;

  while (blocks.length < MAX_BLOCKS) {
    const start = SCRIPT_START.exec(html);
    if (!start) break;

    const tagEnd = html.indexOf('>', start.index);
    if (tagEnd === -1) break;

    SCRIPT_END.lastIndex = tagEnd + 1;
    const end = SCRIPT_END.exec(html);
    if (!end) break;

    const attributes = html.slice(start.index + 7, tagEnd);
    if (attributes.length <= 500 && LD_JSON_TYPE.test(attributes)) {
      blocks.push(html.slice(tagEnd + 1, end.index));
    }
    SCRIPT_START.lastIndex = end.index + end[0].length;
  }
  return blocks;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  deg: '°',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
};

function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z0-9]{2,8}));/gi, (match, dec?: string, hex?: string, name?: string) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? match;
    const code = dec !== undefined ? Number(dec) : Number.parseInt(hex ?? '', 16);
    const isSurrogate = code >= 0xd800 && code <= 0xdfff;
    if (!Number.isInteger(code) || code < 1 || code > 0x10ffff || isSurrogate) return match;
    return String.fromCodePoint(code);
  });
}

/** Plain text from a possibly HTML-ish value: line breaks kept, tags removed, entities decoded once. */
function cleanText(value: unknown): string {
  if (typeof value !== 'string') return '';
  const withBreaks = value
    .slice(0, RAW_TEXT_LIMIT)
    .replace(/<\s*br\s*\/?\s*>|<\/\s*(?:p|li|div)\s*>/gi, '\n')
    .replace(/<[^>]{0,500}>/g, ' ');
  return decodeEntities(withBreaks)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

const cleanLine = (value: unknown): string => cleanText(value).replace(/\s*\n\s*/g, ' ');

/** Cuts to a length without leaving half of a surrogate pair behind. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/[\uD800-\uDBFF]$/, '').trim();
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function hasType(node: Record<string, unknown>, wanted: string): boolean {
  const raw = node['@type'];
  const types = Array.isArray(raw) ? raw : [raw];
  return types.some((type) => typeof type === 'string' && type.split(/[/:#]/).pop()?.toLowerCase() === wanted.toLowerCase());
}

/** Breadth-first search for the first Recipe node, through arrays, @graph and mainEntity. */
function findRecipe(root: unknown): Record<string, unknown> | null {
  const queue: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let seen = 0;

  for (let index = 0; index < queue.length && seen < MAX_NODES; index++) {
    const { value, depth } = queue[index]!;
    seen += 1;

    if (Array.isArray(value)) {
      if (depth < MAX_DEPTH) for (const item of value.slice(0, MAX_NODES)) queue.push({ value: item, depth: depth + 1 });
      continue;
    }
    if (!isObject(value)) continue;
    if (hasType(value, 'Recipe')) return value;
    if (depth >= MAX_DEPTH) continue;
    for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage']) {
      if (value[key] !== undefined) queue.push({ value: value[key], depth: depth + 1 });
    }
  }
  return null;
}

function textList(value: unknown, max: number): string[] {
  const items = typeof value === 'string' ? value.split(/\r?\n/) : Array.isArray(value) ? value : [];
  const out: string[] = [];
  for (const item of items) {
    const line = clip(cleanLine(item), max);
    if (line) out.push(line);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/** recipeInstructions can be text, a list of strings, HowToStep objects, or sections of steps. */
function collectSteps(value: unknown, out: string[], depth = 0): void {
  if (out.length >= MAX_ITEMS || depth > 4) return;

  if (typeof value === 'string') {
    for (const line of cleanText(value).split('\n')) {
      const step = clip(line, LIMITS.step);
      if (step && out.length < MAX_ITEMS) out.push(step);
    }
  } else if (Array.isArray(value)) {
    for (const item of value.slice(0, MAX_ITEMS)) collectSteps(item, out, depth + 1);
  } else if (isObject(value)) {
    if (value.itemListElement !== undefined) {
      collectSteps(value.itemListElement, out, depth + 1);
    } else {
      collectSteps(value.text ?? value.name, out, depth + 1);
    }
  }
}

function firstText(value: unknown, max: number): string {
  const items = Array.isArray(value) ? value : [value];
  for (const item of items) {
    const text = clip(cleanLine(item), max);
    if (text) return text;
  }
  return '';
}

function resolveImage(value: unknown, pageUrl: URL, depth = 0): string | null {
  if (depth > 3) return null;
  if (typeof value === 'string') {
    const candidate = value.trim();
    if (!candidate || candidate.length > 2048) return null;
    try {
      const url = new URL(candidate, pageUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      url.hash = '';
      return url.href;
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 10)) {
      const found = resolveImage(item, pageUrl, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (isObject(value)) return resolveImage(value.url ?? value.contentUrl, pageUrl, depth + 1);
  return null;
}

/** Decodes a page using the charset it declares, falling back to UTF-8. */
export function decodePage(body: Buffer, contentType: string): string {
  const label = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1];
  try {
    return new TextDecoder(label ?? 'utf-8').decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

export function extractRecipe(html: string, pageUrl: URL): ExtractedRecipe | null {
  for (const block of jsonLdBlocks(html)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block.trim());
    } catch {
      continue;
    }

    const recipe = findRecipe(parsed);
    if (!recipe) continue;

    const title = clip(cleanLine(recipe.name), LIMITS.title);
    if (!title) continue;

    const steps: string[] = [];
    collectSteps(recipe.recipeInstructions, steps);

    const draft: RecipeDraft = {
      title,
      cuisine: firstText(recipe.recipeCuisine, LIMITS.cuisine) || null,
      description: clip(cleanText(recipe.description), LIMITS.description) || null,
      ingredients: textList(recipe.recipeIngredient ?? recipe.ingredients, LIMITS.ingredient),
      steps,
    };
    return { draft, imageUrl: resolveImage(recipe.image, pageUrl) };
  }
  return null;
}
