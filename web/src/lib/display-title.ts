// Letters from scripts other than Latin, plus the punctuation that goes with CJK text (including the full-width
// punctuation, but not full-width letters and digits). Accented Latin letters (é, ñ, ø) are Latin and stay. The list
// is explicit on purpose: a broad "not Latin" rule would also remove digits, symbols and emoji, which are fine.
// Hiragana and Katakana use Script_Extensions so that marks shared by kana, such as the long-vowel mark in ラーメン,
// go too; Han and Hangul do not, because their extensions also claim ordinary punctuation such as the middle dot.
const OTHER_SCRIPTS =
  /[\p{Script=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Tamil}\u{3000}-\u{303f}\u{30fb}\u{ff01}-\u{ff0f}\u{ff1a}-\u{ff20}\u{ff3b}-\u{ff40}\u{ff5b}-\u{ff65}]/gu;

const SEPARATORS = '/|·,;:\\-–—';
const EMPTY_BRACKETS = new RegExp(`[(\\[]\\s*[${SEPARATORS}]*\\s*[)\\]]`, 'g');
const SEPARATOR_BEFORE_CLOSE = new RegExp(`\\s*[${SEPARATORS}]+\\s*(?=[)\\]])`, 'g');
const SEPARATOR_AFTER_OPEN = new RegExp(`(?<=[(\\[])\\s*[${SEPARATORS}]+\\s*`, 'g');
const EDGE_SEPARATORS = new RegExp(`^[\\s${SEPARATORS}]+|[\\s${SEPARATORS}]+$`, 'g');

/**
 * A recipe title for showing on screen: text in other scripts (for example the Chinese name some imported titles
 * carry in brackets) is left out and the leftovers are tidied, so "Braised Pork Belly (Hong Shao Rou/红烧肉), an Easy
 * Version" reads "Braised Pork Belly (Hong Shao Rou), an Easy Version". The saved title is never changed. A title
 * that is entirely in another script is shown as it is, because an empty heading helps nobody.
 */
export function displayTitle(title: string): string {
  // (search, not test: the pattern is global, and a global pattern's test() remembers where it stopped.)
  if (title.search(OTHER_SCRIPTS) < 0) return title;

  // Each removed run becomes one space, so the words either side of it do not run together; the tidying below
  // removes the spaces that are not wanted.
  const stripped = title.replace(OTHER_SCRIPTS, ' ');

  let tidy = stripped;
  // Brackets that held only removed text can leave nested empties, so repeat until nothing changes.
  for (let pass = 0; pass < 5; pass++) {
    const next = tidy.replace(EMPTY_BRACKETS, ' ');
    if (next === tidy) break;
    tidy = next;
  }
  tidy = tidy
    .replace(SEPARATOR_BEFORE_CLOSE, '')
    .replace(SEPARATOR_AFTER_OPEN, '')
    .replace(/([([])\s+/g, '$1')
    .replace(/\s+([,.;:!?)\]])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(EDGE_SEPARATORS, '');

  return tidy.length > 0 ? tidy : title;
}
