import { z } from 'zod';
import { badGateway } from '../errors.js';
import type { SafeFetcher } from './safe-fetch.js';

// Finds photos for a recipe by title in two services that publish openly licensed images and need no key:
// Wikimedia Commons (https://commons.wikimedia.org) and Openverse (https://openverse.org, mostly Flickr photos).
// Google and Bing image search are not options: scraping them breaks their terms and their official APIs cost money.

export const MAX_CANDIDATES = 5;
const MIN_WIDTH = 480;
const PROVIDER_PAGE_SIZE = 12;
const MAX_TERM_LENGTH = 80;
const MAX_CREDIT_LENGTH = 300;

const OPENVERSE_API = 'https://api.openverse.org/v1/images/';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

export interface PhotoCandidate {
  /** https address of a JPEG, PNG or WebP of reasonable size (Commons: a 1280 px rendition, never the original). */
  imageUrl: string;
  title: string;
  creator: string | null;
  /** For example "CC BY 2.0". */
  licence: string;
  licenceUrl: string | null;
  /** The photo's own page, where the author and licence can be checked. */
  landingUrl: string | null;
  provider: 'Wikimedia Commons' | 'Openverse';
  width: number;
  height: number;
}

export interface SearchOptions {
  allowNonCommercial: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// What to search for

// Text in other scripts (a second name in Chinese, say) and CJK punctuation. The same list as the web app uses to
// tidy titles on screen.
const OTHER_SCRIPTS =
  /[\p{Script=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Tamil}\u{3000}-\u{303f}\u{30fb}\u{ff01}-\u{ff0f}\u{ff1a}-\u{ff20}\u{ff3b}-\u{ff40}\u{ff5b}-\u{ff65}]/gu;

// Words that describe the recipe page rather than the dish, and would only narrow the search to nothing.
const FILLER = new Set([
  'easy', 'simple', 'quick', 'fast', 'best', 'ultimate', 'perfect', 'foolproof', 'homemade', 'authentic', 'recipe',
  'recipes', 'version', 'style', 'my', 'the', 'an', 'a',
]);

const OPERATORS = new Set(['AND', 'OR', 'NOT']);

function words(text: string): string[] {
  return text
    .replace(/[^\p{L}\p{N}'\s-]/gu, ' ')
    .split(/\s+/)
    // A leading hyphen would mean "not this word" to the search engines, and AND, OR and NOT are their operators.
    .map((word) => word.replace(/^-+/, ''))
    .filter((word) => /[\p{L}\p{N}]/u.test(word) && !FILLER.has(word.toLowerCase()) && !OPERATORS.has(word));
}

const clip = (text: string): string => text.slice(0, MAX_TERM_LENGTH).trim();

/**
 * One or two search phrases for a recipe title, most specific first: the whole title cleaned up, then just the part
 * before the first comma, colon or dash ("Braised Pork Belly, an Easy Version" becomes "Braised Pork Belly").
 * Nothing but letters, digits, apostrophes and hyphens is kept, so the title cannot add search operators.
 */
export function searchTermsFor(title: string): string[] {
  const latin = title.slice(0, 300).replace(OTHER_SCRIPTS, ' ');
  // Bracketed asides are usually a second name or a note, not part of the dish's name.
  const withoutAsides = latin.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  const firstPart = withoutAsides.split(/[,:;|]|\s[-–—]\s/)[0] ?? '';

  const full = clip(words(withoutAsides).join(' '));
  const core = clip(words(firstPart).join(' '));
  const terms = [full, core].filter((term) => term.replace(/[^\p{L}]/gu, '').length >= 3);
  return [...new Set(terms)];
}

// ---------------------------------------------------------------------------------------------------------------
// Licences and credit

/** Licences that allow a copy to be resized and re-encoded, as the app does, and shown with credit. */
export function licenceAllowed(code: string, options: SearchOptions): boolean {
  const normalised = code.trim().toLowerCase().replace(/\s+/g, '-');
  const base = new Set(['cc0', 'pdm', 'by', 'by-sa']);
  const nonCommercial = new Set(['by-nc', 'by-nc-sa']);
  return base.has(normalised) || (options.allowNonCommercial && nonCommercial.has(normalised));
}

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  // Credits come from other people's metadata: no markup, no control characters, no runs of spaces. The text is cut
  // first and the tag pattern is bounded, so a hostile string of "<" cannot make the cleaning slow.
  const cleaned = value
    .slice(0, max * 4)
    .replace(/<[^<>]{0,200}>/g, ' ')
    // Control characters, and the invisible marks that can reorder or hide text (bidi overrides, zero-width).
    .replace(/[\u{80}-\u{9f}\u{200b}-\u{200f}\u{202a}-\u{202e}\u{2060}-\u{2069}\u{feff}]/gu, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? cleaned.slice(0, max) : null;
};

function httpsUrl(value: unknown, max = 2048): string | null {
  if (typeof value !== 'string' || value.length > max) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** The line shown under the photo: who made it and under what licence. */
export function creditFor(candidate: PhotoCandidate): { text: string; url: string | null } {
  const by = candidate.creator ? ` by ${candidate.creator}` : '';
  const line = `Photo: "${candidate.title}"${by}, ${candidate.licence}, via ${candidate.provider}`;
  return { text: line.slice(0, MAX_CREDIT_LENGTH), url: candidate.landingUrl };
}

// ---------------------------------------------------------------------------------------------------------------
// Wikimedia Commons

const commonsPage = z.looseObject({
  title: z.string(),
  index: z.number().optional(),
  imageinfo: z
    .array(
      z.looseObject({
        thumburl: z.string().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        mime: z.string().optional(),
        descriptionurl: z.string().optional(),
        extmetadata: z
          .looseObject({
            Artist: z.looseObject({ value: z.unknown() }).optional(),
            LicenseShortName: z.looseObject({ value: z.unknown() }).optional(),
            LicenseUrl: z.looseObject({ value: z.unknown() }).optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});
const commonsResponse = z.object({ query: z.object({ pages: z.array(z.unknown()) }).optional() });

export function commonsUrl(term: string): string {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: `filetype:bitmap ${term}`,
    gsrnamespace: '6',
    gsrlimit: String(PROVIDER_PAGE_SIZE),
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl',
    iiurlwidth: '1280',
    format: 'json',
    formatversion: '2',
  });
  return `${COMMONS_API}?${params.toString()}`;
}

// Country-specific "PD-..." tags are public domain only in some countries, so only plain "Public domain" is taken.
const COMMONS_LICENCE = /^(cc0|public domain|cc by(?:-nc)?(?:-sa)? \d(?:\.\d)?)/i;

export function parseCommons(payload: unknown, options: SearchOptions): PhotoCandidate[] {
  const parsed = commonsResponse.safeParse(payload);
  if (!parsed.success) return [];
  const pages = (parsed.data.query?.pages ?? [])
    .map((page) => commonsPage.safeParse(page))
    .flatMap((result) => (result.success ? [result.data] : []))
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  const found: PhotoCandidate[] = [];
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (!info) continue;
    const mime = info.mime ?? '';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) continue;

    const licence = text(info.extmetadata?.LicenseShortName?.value, 40);
    if (!licence || !COMMONS_LICENCE.test(licence)) continue;
    // Even a recognised family can carry restrictions in its name; refuse any that mention them.
    if (/\bnd\b/i.test(licence)) continue;
    if (/\bnc\b/i.test(licence) && !options.allowNonCommercial) continue;

    const imageUrl = httpsUrl(info.thumburl);
    if (!imageUrl || new URL(imageUrl).hostname !== 'upload.wikimedia.org') continue;
    const width = info.width ?? 0;
    if (width < MIN_WIDTH) continue;

    found.push({
      imageUrl,
      title: text(page.title.replace(/^File:/i, '').replace(/\.[a-z0-9]{3,4}$/i, '').replace(/_/g, ' '), 120) ?? 'Photo',
      creator: text(info.extmetadata?.Artist?.value, 80),
      licence,
      licenceUrl: httpsUrl(info.extmetadata?.LicenseUrl?.value),
      landingUrl: httpsUrl(info.descriptionurl),
      provider: 'Wikimedia Commons',
      width,
      height: info.height ?? 0,
    });
  }
  return found;
}

// ---------------------------------------------------------------------------------------------------------------
// Openverse

const openverseItem = z.looseObject({
  title: z.string().nullish(),
  creator: z.string().nullish(),
  license: z.string(),
  license_version: z.string().nullish(),
  license_url: z.string().nullish(),
  foreign_landing_url: z.string().nullish(),
  url: z.string(),
  width: z.number().nullish(),
  height: z.number().nullish(),
});
const openverseResponse = z.object({ results: z.array(z.unknown()) });

export function openverseUrl(term: string, options: SearchOptions): string {
  const params = new URLSearchParams({
    q: term,
    page_size: String(PROVIDER_PAGE_SIZE),
    category: 'photograph',
    mature: 'false',
    // Flickr only: its photos are the ones this app downloads, from one known host. Wikimedia Commons is searched
    // directly, so it is not needed here.
    source: 'flickr',
    license_type: options.allowNonCommercial ? 'modification' : 'commercial,modification',
  });
  return `${OPENVERSE_API}?${params.toString()}`;
}

function licenceName(code: string, version: string | null | undefined): string {
  const lower = code.toLowerCase();
  if (lower === 'cc0') return 'CC0 1.0';
  if (lower === 'pdm') return 'Public Domain Mark';
  // The version comes from a third party: only a plain number such as "2.0" or "4.0" is shown.
  const shown = version && /^\d{1,2}(\.\d)?$/.test(version) ? ` ${version}` : '';
  return `CC ${lower.toUpperCase()}${shown}`;
}

/** Openverse's photos come from Flickr, whose pictures are served from staticflickr.com. Nothing else is fetched. */
const isFlickrHost = (hostname: string): boolean => hostname === 'staticflickr.com' || hostname.endsWith('.staticflickr.com');

export function parseOpenverse(payload: unknown, options: SearchOptions): PhotoCandidate[] {
  const parsed = openverseResponse.safeParse(payload);
  if (!parsed.success) return [];

  const found: PhotoCandidate[] = [];
  for (const raw of parsed.data.results) {
    const item = openverseItem.safeParse(raw);
    if (!item.success) continue;
    const { license, license_version: version, url, width, height } = item.data;
    if (!licenceAllowed(license, options)) continue;

    const imageUrl = httpsUrl(url);
    if (!imageUrl || (width ?? 0) < MIN_WIDTH) continue;
    // Only the formats the app accepts; the file's real content is checked again when it is downloaded.
    const parsedUrl = new URL(imageUrl);
    if (!isFlickrHost(parsedUrl.hostname) || parsedUrl.port !== '') continue;
    if (!/\.(jpe?g|png|webp)$/i.test(parsedUrl.pathname)) continue;

    found.push({
      imageUrl,
      title: text(item.data.title, 120) ?? 'Photo',
      creator: text(item.data.creator, 80),
      licence: licenceName(license, version),
      licenceUrl: httpsUrl(item.data.license_url),
      landingUrl: httpsUrl(item.data.foreign_landing_url),
      provider: 'Openverse',
      width: width ?? 0,
      height: height ?? 0,
    });
  }
  return found;
}

// ---------------------------------------------------------------------------------------------------------------
// Putting it together

const sameThing = (a: PhotoCandidate, b: PhotoCandidate): boolean =>
  a.imageUrl === b.imageUrl ||
  (a.landingUrl !== null && a.landingUrl === b.landingUrl) ||
  (a.title.toLowerCase() === b.title.toLowerCase() && (a.creator ?? '') === (b.creator ?? ''));

/** Takes turns between the two lists so neither service crowds the other out, and removes repeats. */
export function mergeCandidates(lists: PhotoCandidate[][], limit = MAX_CANDIDATES): PhotoCandidate[] {
  const merged: PhotoCandidate[] = [];
  for (let position = 0; merged.length < limit; position++) {
    let any = false;
    for (const list of lists) {
      const candidate = list[position];
      if (!candidate) continue;
      any = true;
      if (merged.length < limit && !merged.some((kept) => sameThing(kept, candidate))) merged.push(candidate);
    }
    if (!any) break;
  }
  return merged;
}

/**
 * Looks for photos in both services, widening to the shorter phrase when the first finds too few. At most five come
 * back. One service being down or busy is fine; both failing is an error.
 */
export async function findPhotoCandidates(
  fetcher: SafeFetcher,
  title: string,
  options: SearchOptions,
  report: (reason: string) => void = () => undefined,
): Promise<PhotoCandidate[]> {
  const terms = searchTermsFor(title);
  if (terms.length === 0) return [];

  const collected: PhotoCandidate[][] = [[], []];
  let answered = 0;
  for (const term of terms) {
    const [commons, openverse] = await Promise.allSettled([
      fetcher.fetchJson(commonsUrl(term)),
      fetcher.fetchJson(openverseUrl(term, options)),
    ]);
    const outcomes = [
      { index: 0, outcome: commons, parse: parseCommons, name: 'Wikimedia Commons' },
      { index: 1, outcome: openverse, parse: parseOpenverse, name: 'Openverse' },
    ] as const;
    for (const { index, outcome, parse, name } of outcomes) {
      if (outcome.status === 'fulfilled') {
        answered += 1;
        collected[index] = [...collected[index]!, ...parse(outcome.value, options)];
      } else {
        report(`${name} search failed: ${(outcome.reason as Error)?.message ?? 'unknown error'}`);
      }
    }
    if (mergeCandidates(collected).length >= MAX_CANDIDATES) break;
  }

  if (answered === 0) throw badGateway('Could not search for photos right now');
  return mergeCandidates(collected);
}
