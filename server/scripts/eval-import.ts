// Tries the URL-import pipeline on your own list of recipe links and prints what it could read,
// to measure how many pages import with a title, ingredients and a photo.
//
//   npm run eval:import -w server -- path/to/urls.txt [--no-images]
//
// urls.txt has one address per line; blank lines and lines starting with # are ignored (see
// example-urls.txt). Each page is fetched once, one second apart, through the same guarded fetcher
// the app uses. It never touches your recipes or database. With --no-images the photos are not
// downloaded, so the rate only reflects title and ingredients.
import fs from 'node:fs';
import { HttpError } from '../src/errors.js';
import { processImage } from '../src/services/images.js';
import { decodePage, extractRecipe } from '../src/services/recipe-jsonld.js';
import { createSafeFetcher } from '../src/services/safe-fetch.js';

const TARGET_RATE = 0.7;
const PAUSE_MS = 1000;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith('--'));
if (!file) fail('Usage: npm run eval:import -w server -- path/to/urls.txt [--no-images]');
const checkImages = !args.includes('--no-images');

let text: string;
try {
  text = fs.readFileSync(file, 'utf8');
} catch (err) {
  fail(`Could not read ${file}: ${err instanceof Error ? err.message : String(err)}`);
}
const urls = text
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));
if (urls.length === 0) fail(`${file} has no addresses. Put one recipe link per line.`);

let lastReason = '';
const fetcher = createSafeFetcher({ onReject: (reason) => (lastReason = reason) });
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Row {
  url: string;
  ok: boolean;
  note: string;
}

async function tryOne(url: string): Promise<Row> {
  lastReason = '';
  try {
    const page = await fetcher.fetchPage(url);
    const extracted = extractRecipe(decodePage(page.body, page.contentType), page.url);
    if (!extracted) return { url, ok: false, note: 'no recipe data on the page' };

    const { draft, imageUrl } = extracted;
    const summary = `"${draft.title}", ${draft.ingredients.length} ingredients, ${draft.steps.length} steps`;
    if (draft.ingredients.length === 0) return { url, ok: false, note: `${summary}; no ingredients` };
    if (!checkImages) return { url, ok: true, note: summary };
    if (!imageUrl) return { url, ok: false, note: `${summary}; no photo address` };

    try {
      const image = await fetcher.fetchImage(imageUrl);
      await processImage(image.body);
    } catch (err) {
      return { url, ok: false, note: `${summary}; photo failed (${lastReason || (err as Error).message})` };
    }
    return { url, ok: true, note: `${summary}, photo ok` };
  } catch (err) {
    const message = err instanceof HttpError ? err.message : String(err);
    return { url, ok: false, note: lastReason ? `${message} (${lastReason})` : message };
  }
}

const rows: Row[] = [];
for (const [index, url] of urls.entries()) {
  if (index > 0) await pause(PAUSE_MS);
  const row = await tryOne(url);
  rows.push(row);
  console.log(`${row.ok ? 'OK  ' : 'FAIL'} ${row.url}\n       ${row.note}`);
}

const passed = rows.filter((row) => row.ok).length;
const rate = passed / rows.length;
console.log(
  `\n${passed} of ${rows.length} pages imported (${Math.round(rate * 100)}%). ` +
    `Target: ${Math.round(TARGET_RATE * 100)}% ${checkImages ? 'with title, ingredients and photo' : 'with title and ingredients'}.`,
);
process.exit(rate >= TARGET_RATE ? 0 : 2);
