import { describe, expect, it, vi } from 'vitest';
import { HttpError } from '../src/errors.js';
import {
  commonsUrl,
  creditFor,
  findPhotoCandidates,
  licenceAllowed,
  mergeCandidates,
  openverseUrl,
  parseCommons,
  parseOpenverse,
  searchTermsFor,
  type PhotoCandidate,
} from '../src/services/image-search.js';
import type { SafeFetcher } from '../src/services/safe-fetch.js';

const STRICT = { allowNonCommercial: false };
const RELAXED = { allowNonCommercial: true };

describe('searchTermsFor', () => {
  it.each([
    ['Tomato Soup', ['Tomato Soup']],
    ['Braised Pork Belly (Hong Shao Rou/红烧肉), an Easy Version', ['Braised Pork Belly']],
    ['Easy Homemade Chicken Noodle Soup Recipe', ['Chicken Noodle Soup']],
    ['Mac and Cheese: the best ever', ['Mac and Cheese ever', 'Mac and Cheese']],
    ["Grandma's Apple Pie - with a lattice top", ["Grandma's Apple Pie with lattice top", "Grandma's Apple Pie"]],
    ['Shakshuka', ['Shakshuka']],
    ['Crème brûlée', ['Crème brûlée']],
  ])('turns %j into %j', (title, expected) => {
    expect(searchTermsFor(title)).toEqual(expected);
  });

  it('keeps only letters, digits, apostrophes and hyphens, so a title cannot add search operators', () => {
    for (const term of searchTermsFor('Soup" OR insource:secret -site:x "quoted" <b>bold</b> & more | pipe')) {
      expect(term).toMatch(/^[\p{L}\p{N}'\s-]+$/u);
    }
  });

  it('gives nothing for a title with no Latin letters or too little to search for', () => {
    expect(searchTermsFor('红烧肉')).toEqual([]);
    expect(searchTermsFor('((红烧肉))')).toEqual([]);
    expect(searchTermsFor('')).toEqual([]);
    expect(searchTermsFor('A B')).toEqual([]);
    expect(searchTermsFor('12 3')).toEqual([]);
  });

  it('keeps a phrase within 80 characters, and handles a huge title quickly', () => {
    const terms = searchTermsFor('soup '.repeat(500));
    expect(terms.every((term) => term.length <= 80)).toBe(true);
    const started = Date.now();
    searchTermsFor('(['.repeat(5_000) + 'x'.repeat(5_000));
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('licenceAllowed', () => {
  it.each(['cc0', 'pdm', 'by', 'by-sa', 'BY', 'by sa'])('allows %s', (code) => {
    expect(licenceAllowed(code, STRICT)).toBe(true);
  });

  it.each(['by-nd', 'by-nc-nd', 'by-nc', 'by-nc-sa', 'all rights reserved', '', 'gfdl', 'by-sa-nd'])('refuses %j when non-commercial is off', (code) => {
    expect(licenceAllowed(code, STRICT)).toBe(false);
  });

  it('allows non-commercial licences when asked, but never one that forbids changes', () => {
    expect(licenceAllowed('by-nc', RELAXED)).toBe(true);
    expect(licenceAllowed('by-nc-sa', RELAXED)).toBe(true);
    expect(licenceAllowed('by-nd', RELAXED)).toBe(false);
    expect(licenceAllowed('by-nc-nd', RELAXED)).toBe(false);
  });
});

// ---- provider answers --------------------------------------------------------------------------------------------

const commonsPage = (overrides: Record<string, unknown> = {}, info: Record<string, unknown> = {}) => ({
  pageid: 1,
  ns: 6,
  title: 'File:Red_braised_pork_belly.jpg',
  index: 1,
  imageinfo: [
    {
      thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a8/Red_braised_pork_belly.jpg/1280px-Red_braised_pork_belly.jpg',
      width: 1600,
      height: 1200,
      mime: 'image/jpeg',
      descriptionurl: 'https://commons.wikimedia.org/wiki/File:Red_braised_pork_belly.jpg',
      extmetadata: {
        Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Jane">Jane <b>Doe</b></a>' },
        LicenseShortName: { value: 'CC BY 2.0' },
        LicenseUrl: { value: 'https://creativecommons.org/licenses/by/2.0' },
      },
      ...info,
    },
  ],
  ...overrides,
});

const commons = (...pages: unknown[]) => ({ query: { pages } });

describe('parseCommons', () => {
  it('reads a photo with its credit, with the markup taken out of the author', () => {
    expect(parseCommons(commons(commonsPage()), STRICT)).toEqual([
      {
        imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a8/Red_braised_pork_belly.jpg/1280px-Red_braised_pork_belly.jpg',
        title: 'Red braised pork belly',
        creator: 'Jane Doe',
        licence: 'CC BY 2.0',
        licenceUrl: 'https://creativecommons.org/licenses/by/2.0',
        landingUrl: 'https://commons.wikimedia.org/wiki/File:Red_braised_pork_belly.jpg',
        provider: 'Wikimedia Commons',
        width: 1600,
        height: 1200,
      },
    ]);
  });

  it('keeps the search order', () => {
    const result = parseCommons(commons(commonsPage({ index: 2, title: 'File:Second.jpg' }), commonsPage({ index: 1, title: 'File:First.jpg' })), STRICT);
    expect(result.map((item) => item.title)).toEqual(['First', 'Second']);
  });

  it.each([
    ['a licence that forbids changes', { extmetadata: { LicenseShortName: { value: 'CC BY-ND 2.0' } } }],
    ['a licence that is not recognised', { extmetadata: { LicenseShortName: { value: 'GFDL' } } }],
    ['no licence at all', { extmetadata: {} }],
    ['a non-commercial licence', { extmetadata: { LicenseShortName: { value: 'CC BY-NC 4.0' } } }],
    ['a format the app does not take', { mime: 'image/svg+xml' }],
    ['a photo that is too narrow', { width: 300 }],
    ['an address on another host', { thumburl: 'https://evil.example/x.jpg' }],
    ['an address that is not https', { thumburl: 'http://upload.wikimedia.org/x.jpg' }],
    ['an address with a user name', { thumburl: 'https://user:pw@upload.wikimedia.org/x.jpg' }],
    ['no address', { thumburl: undefined }],
  ])('leaves out %s', (_name, info) => {
    expect(parseCommons(commons(commonsPage({}, info)), STRICT)).toEqual([]);
  });

  it('accepts a non-commercial licence when asked, but still not one that forbids changes', () => {
    const nc = { extmetadata: { LicenseShortName: { value: 'CC BY-NC 4.0' } } };
    const nd = { extmetadata: { LicenseShortName: { value: 'CC BY-NC-ND 4.0' } } };
    expect(parseCommons(commons(commonsPage({}, nc)), RELAXED)).toHaveLength(1);
    expect(parseCommons(commons(commonsPage({}, nd)), RELAXED)).toEqual([]);
  });

  it.each([null, undefined, 'x', 5, [], {}, { query: null }, { query: { pages: 'x' } }, { query: { pages: [null, 'x', 5, {}] } }])('gives nothing for %j', (payload) => {
    expect(parseCommons(payload, STRICT)).toEqual([]);
  });

  it('cuts long text and removes control characters from the credit', () => {
    const page = commonsPage({}, { extmetadata: { Artist: { value: `Bad\u0000Name\n${'x'.repeat(500)}` }, LicenseShortName: { value: 'CC BY 4.0' } } });
    const [item] = parseCommons(commons(page), STRICT);
    expect(item!.creator!.length).toBeLessThanOrEqual(80);
    expect([...item!.creator!].every((char) => char.charCodeAt(0) >= 32)).toBe(true);
  });
});

const openverseItem = (overrides: Record<string, unknown> = {}) => ({
  title: 'Tomato soup',
  creator: 'Jane Doe',
  license: 'by',
  license_version: '2.0',
  license_url: 'https://creativecommons.org/licenses/by/2.0/',
  foreign_landing_url: 'https://www.flickr.com/photos/1/2',
  url: 'https://live.staticflickr.com/65535/123_abc_b.jpg',
  width: 1024,
  height: 768,
  ...overrides,
});
const openverse = (...results: unknown[]) => ({ results });

describe('parseOpenverse', () => {
  it('reads a photo with its credit', () => {
    expect(parseOpenverse(openverse(openverseItem()), STRICT)).toEqual([
      {
        imageUrl: 'https://live.staticflickr.com/65535/123_abc_b.jpg',
        title: 'Tomato soup',
        creator: 'Jane Doe',
        licence: 'CC BY 2.0',
        licenceUrl: 'https://creativecommons.org/licenses/by/2.0/',
        landingUrl: 'https://www.flickr.com/photos/1/2',
        provider: 'Openverse',
        width: 1024,
        height: 768,
      },
    ]);
  });

  it.each([
    ['by-nd', STRICT],
    ['by-nc-nd', RELAXED],
    ['by-nc', STRICT],
    ['unknown', RELAXED],
  ])('leaves out a %s photo', (license, options) => {
    expect(parseOpenverse(openverse(openverseItem({ license })), options)).toEqual([]);
  });

  it('names the common licences plainly', () => {
    const names = ['cc0', 'pdm', 'by-sa'].map((license) => parseOpenverse(openverse(openverseItem({ license, license_version: '1.0' })), STRICT)[0]!.licence);
    expect(names).toEqual(['CC0 1.0', 'Public Domain Mark', 'CC BY-SA 1.0']);
  });

  it.each([
    ['an address that is not https', { url: 'http://live.staticflickr.com/x.jpg' }],
    ['a format the app does not take', { url: 'https://live.staticflickr.com/x.gif' }],
    ['an address with a user name', { url: 'https://u:p@live.staticflickr.com/x.jpg' }],
    ['a photo that is too narrow', { width: 200 }],
    ['no width', { width: null }],
  ])('leaves out %s', (_name, overrides) => {
    expect(parseOpenverse(openverse(openverseItem(overrides)), STRICT)).toEqual([]);
  });

  it('drops a link that is not https instead of passing it on', () => {
    const [item] = parseOpenverse(openverse(openverseItem({ foreign_landing_url: 'javascript:alert(1)', license_url: 'http://x' })), STRICT);
    expect(item).toMatchObject({ landingUrl: null, licenceUrl: null });
  });

  it.each([null, undefined, 'x', {}, { results: 'x' }, { results: [null, 5, 'x', {}] }])('gives nothing for %j', (payload) => {
    expect(parseOpenverse(payload, STRICT)).toEqual([]);
  });
});

describe('request addresses', () => {
  it('ask Commons for bitmaps only and encode the phrase', () => {
    const url = new URL(commonsUrl('Mac & Cheese'));
    expect(url.origin + url.pathname).toBe('https://commons.wikimedia.org/w/api.php');
    expect(url.searchParams.get('gsrsearch')).toBe('filetype:bitmap Mac & Cheese');
    expect(url.searchParams.get('gsrlimit')).toBe('12');
    expect(url.searchParams.get('iiurlwidth')).toBe('1280');
  });

  it('ask Openverse for Flickr photographs that may be changed, leaving out adult content', () => {
    const strict = new URL(openverseUrl('soup', STRICT));
    expect(strict.origin + strict.pathname).toBe('https://api.openverse.org/v1/images/');
    expect(strict.searchParams.get('license_type')).toBe('commercial,modification');
    expect(strict.searchParams.get('mature')).toBe('false');
    expect(strict.searchParams.get('source')).toBe('flickr');
    expect(new URL(openverseUrl('soup', RELAXED)).searchParams.get('license_type')).toBe('modification');
  });

  it('cannot be pointed at another host by the phrase', () => {
    expect(new URL(commonsUrl('@evil.example/#')).hostname).toBe('commons.wikimedia.org');
    expect(new URL(openverseUrl('@evil.example/#', STRICT)).hostname).toBe('api.openverse.org');
  });
});

// ---- merging and searching -----------------------------------------------------------------------------------------

const candidate = (n: number, overrides: Partial<PhotoCandidate> = {}): PhotoCandidate => ({
  imageUrl: `https://upload.wikimedia.org/p${n}.jpg`,
  title: `Photo ${n}`,
  creator: `Person ${n}`,
  licence: 'CC BY 2.0',
  licenceUrl: null,
  landingUrl: `https://example.org/${n}`,
  provider: 'Openverse',
  width: 1000,
  height: 800,
  ...overrides,
});

describe('mergeCandidates', () => {
  it('takes turns between the lists and stops at five', () => {
    const a = [1, 2, 3, 4].map((n) => candidate(n));
    const b = [11, 12, 13, 14].map((n) => candidate(n));
    expect(mergeCandidates([a, b]).map((item) => item.title)).toEqual(['Photo 1', 'Photo 11', 'Photo 2', 'Photo 12', 'Photo 3']);
  });

  it('removes repeats by address, by page and by title and author', () => {
    const merged = mergeCandidates([
      [candidate(1), candidate(2, { imageUrl: candidate(1).imageUrl })],
      [candidate(3, { landingUrl: candidate(1).landingUrl }), candidate(4, { title: 'PHOTO 1', creator: 'Person 1' }), candidate(5)],
    ]);
    expect(merged.map((item) => item.title)).toEqual(['Photo 1', 'Photo 5']);
  });

  it('copes with empty lists', () => {
    expect(mergeCandidates([[], []])).toEqual([]);
    expect(mergeCandidates([])).toEqual([]);
  });
});

describe('creditFor', () => {
  it('names the photo, its author, the licence and where it came from, and links to its page', () => {
    expect(creditFor(candidate(1))).toEqual({
      text: 'Photo: "Photo 1" by Person 1, CC BY 2.0, via Openverse',
      url: 'https://example.org/1',
    });
  });

  it('copes with no author and no page, and never grows past 300 characters', () => {
    expect(creditFor(candidate(1, { creator: null, landingUrl: null }))).toEqual({ text: 'Photo: "Photo 1", CC BY 2.0, via Openverse', url: null });
    expect(creditFor(candidate(1, { title: 'x'.repeat(1000) })).text.length).toBeLessThanOrEqual(300);
  });
});

function fakeFetcher(answer: (url: string) => Promise<unknown> | unknown): SafeFetcher & { fetchJson: ReturnType<typeof vi.fn> } {
  return {
    fetchPage: vi.fn(),
    fetchImage: vi.fn(),
    fetchJson: vi.fn(async (url: string) => answer(url)),
  } as never;
}

const byHost = (host: string) => (url: string) => new URL(url).hostname === host;

describe('findPhotoCandidates', () => {
  const six = (prefix: string) => Array.from({ length: 6 }, (_, n) => openverseItem({ title: `${prefix} ${n}`, creator: `${prefix}${n}`, url: `https://live.staticflickr.com/${prefix}${n}.jpg`, foreign_landing_url: `https://flickr.example/${prefix}${n}` }));
  const sixCommons = Array.from({ length: 6 }, (_, n) => commonsPage({ index: n, title: `File:Commons ${n}.jpg` }, { thumburl: `https://upload.wikimedia.org/c${n}.jpg`, descriptionurl: `https://commons.wikimedia.org/c${n}` }));

  it('asks both services and returns at most five, taking turns', async () => {
    const fetcher = fakeFetcher((url) => (byHost('commons.wikimedia.org')(url) ? commons(...sixCommons) : openverse(...six('ov'))));
    const found = await findPhotoCandidates(fetcher, 'Tomato Soup', STRICT);
    expect(found).toHaveLength(5);
    expect(found.map((item) => item.provider)).toEqual(['Wikimedia Commons', 'Openverse', 'Wikimedia Commons', 'Openverse', 'Wikimedia Commons']);
    expect(fetcher.fetchJson).toHaveBeenCalledTimes(2);
  });

  it('tries the shorter phrase when the first finds too few', async () => {
    const fetcher = fakeFetcher((url) => {
      const query = new URL(url).searchParams.get('q') ?? new URL(url).searchParams.get('gsrsearch') ?? '';
      if (query.includes('ever')) return byHost('commons.wikimedia.org')(url) ? commons() : { results: [] };
      return byHost('commons.wikimedia.org')(url) ? commons() : openverse(...six('ov'));
    });
    const found = await findPhotoCandidates(fetcher, 'Soup: the best ever', STRICT);
    expect(found.length).toBeGreaterThan(0);
    expect(fetcher.fetchJson).toHaveBeenCalledTimes(4);
  });

  it('does not search again when five were found at once', async () => {
    const fetcher = fakeFetcher((url) => (byHost('commons.wikimedia.org')(url) ? commons(...sixCommons) : openverse(...six('ov'))));
    await findPhotoCandidates(fetcher, 'Tomato Soup, the easy way', STRICT);
    expect(fetcher.fetchJson).toHaveBeenCalledTimes(2);
  });

  it('still answers when one service fails, and reports why', async () => {
    const reports: string[] = [];
    const fetcher = fakeFetcher((url) => {
      if (byHost('api.openverse.org')(url)) throw new HttpError(502, 'Could not fetch that page');
      return commons(...sixCommons);
    });
    const found = await findPhotoCandidates(fetcher, 'Tomato Soup', STRICT, (reason) => reports.push(reason));
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((item) => item.provider === 'Wikimedia Commons')).toBe(true);
    expect(reports.join(' ')).toContain('Openverse search failed');
  });

  it('fails with a generic message when both services fail', async () => {
    const fetcher = fakeFetcher(() => {
      throw new HttpError(502, 'Could not fetch that page');
    });
    const error = await findPhotoCandidates(fetcher, 'Tomato Soup', STRICT).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).statusCode).toBe(502);
    expect((error as HttpError).message).toBe('Could not search for photos right now');
  });

  it('gives an empty list without asking anyone when the title has nothing to search for', async () => {
    const fetcher = fakeFetcher(() => ({}));
    expect(await findPhotoCandidates(fetcher, '红烧肉', STRICT)).toEqual([]);
    expect(fetcher.fetchJson).not.toHaveBeenCalled();
  });

  it('treats an answer in an odd shape as no photos, not as a failure', async () => {
    const fetcher = fakeFetcher(() => ({ unexpected: true }));
    expect(await findPhotoCandidates(fetcher, 'Tomato Soup', STRICT)).toEqual([]);
  });
});

describe('review fixes', () => {
  const fast = (work: () => void) => {
    const started = Date.now();
    work();
    return Date.now() - started;
  };

  it('is not slowed down by provider text made of a million "<"', () => {
    const hostile = '<'.repeat(1_000_000);
    const elapsed = fast(() => {
      parseOpenverse(openverse(openverseItem({ creator: hostile, title: hostile })), STRICT);
      parseCommons(commons(commonsPage({}, { extmetadata: { Artist: { value: hostile }, LicenseShortName: { value: 'CC BY 4.0' } } })), STRICT);
    });
    expect(elapsed).toBeLessThan(500);
  });

  it('cuts a licence version that is not a plain number', () => {
    const [item] = parseOpenverse(openverse(openverseItem({ license_version: 'x'.repeat(100_000) })), STRICT);
    expect(item!.licence).toBe('CC BY');
    expect(parseOpenverse(openverse(openverseItem({ license_version: '4.0' })), STRICT)[0]!.licence).toBe('CC BY 4.0');
    expect(parseOpenverse(openverse(openverseItem({ license_version: '2.5.1' })), STRICT)[0]!.licence).toBe('CC BY');
  });

  it('takes Openverse photos only from Flickr\'s own host, on the standard port', () => {
    const urls: [string, boolean][] = [
      ['https://live.staticflickr.com/65535/1_a_b.jpg', true],
      ['https://farm5.staticflickr.com/1/2_c.jpg', true],
      ['https://staticflickr.com/a.jpg', true],
      ['https://example.org/a.jpg', false],
      ['https://staticflickr.com.evil.example/a.jpg', false],
      ['https://evilstaticflickr.com/a.jpg', false],
      ['https://live.staticflickr.com:8443/a.jpg', false],
      ['https://127.0.0.1/a.jpg', false],
    ];
    for (const [url, accepted] of urls) {
      expect(parseOpenverse(openverse(openverseItem({ url })), STRICT).length, url).toBe(accepted ? 1 : 0);
    }
  });

  it('strips invisible characters that can reorder or hide a credit', () => {
    const creator = `Jane‮Evil​⁦Doe\u0085﻿`;
    const [item] = parseOpenverse(openverse(openverseItem({ creator })), STRICT);
    expect(item!.creator).toBe('JaneEvilDoe');
  });

  it('removes search operators and a leading hyphen from words', () => {
    expect(searchTermsFor('-pizza NOT cheese OR bread AND ham')).toEqual(['pizza cheese bread ham']);
    expect(searchTermsFor('--spicy--soup')).toEqual(['spicy--soup']);
    expect(searchTermsFor('and or not soup')).toEqual(['and or not soup']);
  });

  it('refuses a country-specific "PD-" tag on Commons but takes plain public domain', () => {
    const tag = (value: string) => commons(commonsPage({}, { extmetadata: { LicenseShortName: { value } } }));
    expect(parseCommons(tag('PD-Italy'), STRICT)).toEqual([]);
    expect(parseCommons(tag('PD-old-70'), STRICT)).toEqual([]);
    expect(parseCommons(tag('Public domain'), STRICT)).toHaveLength(1);
  });
});
