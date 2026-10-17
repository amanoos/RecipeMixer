/**
 * Rule data for ingredient normalisation and matching. English and Western-cuisine biased.
 * Changing any list changes how existing recipes are indexed: bump NORMALIZER_VERSION so the
 * startup backfill re-normalises them (raw ingredient text is never modified).
 */
export const NORMALIZER_VERSION = 1;

/**
 * Words dropped from an ingredient name. All entries are single lower-case words in singular form,
 * because words are singularised before they are compared with this set.
 */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  // articles, connectors and filler
  'a', 'about', 'additional', 'an', 'desired', 'divided', 'extra', 'few', 'for', 'garnish',
  'in', 'into', 'more', 'needed', 'of', 'optional', 'plus', 'serving', 'some', 'taste', 'the', 'to',
  'with',
  // measures and containers
  'bag', 'bottle', 'box', 'bunch', 'can', 'carton', 'cup', 'dash', 'drop', 'g', 'gallon', 'gram',
  'handful', 'head', 'jar', 'kg', 'knob', 'l', 'lb', 'liter', 'litre', 'ml', 'ounce', 'oz', 'package',
  'packet', 'piece', 'pinch', 'pint', 'pound', 'quart', 'slice', 'splash', 'sprig', 'stalk', 'stick',
  'tablespoon', 'tbsp', 'teaspoon', 'tin', 'tsp',
  // sizes
  'big', 'jumbo', 'large', 'medium', 'mini', 'small',
  // state and preparation
  'beaten', 'bone', 'boneless', 'boiled', 'canned', 'chilled', 'chopped', 'coarsely', 'cold', 'cooked',
  'cored', 'crushed', 'cubed', 'cut', 'diced', 'dried', 'dry', 'drained', 'finely', 'firm', 'fresh',
  'freshly', 'frozen', 'good', 'grated', 'ground', 'halved', 'heaping', 'hot', 'leaf', 'lean', 'level',
  'lightly', 'low', 'mashed', 'melted', 'minced', 'organic', 'packed', 'peeled', 'pitted', 'plain',
  'quality', 'quartered', 'raw', 'reduced', 'rinsed', 'ripe', 'room', 'roughly', 'salted', 'seeded',
  'shredded', 'sifted', 'skinless', 'sliced', 'sodium', 'softened', 'stemmed', 'temperature',
  'thawed', 'thinly', 'toasted', 'trimmed', 'uncooked', 'unsalted', 'warm', 'washed', 'whole',
]);

/**
 * Contiguous word sequences (singular form) rewritten before stop words are removed.
 * A single-token replacement joined by a hyphen marks a compound that must never match its parts
 * (peanut-butter is not butter). An empty replacement deletes the phrase.
 */
export const PHRASE_SYNONYMS: ReadonlyArray<readonly [phrase: string, replacement: string]> = [
  // phrases that only describe the product
  ['fat free', ''],
  ['low fat', ''],
  ['reduced fat', ''],
  // regional and spelling variants
  ['aubergine', 'eggplant'],
  ['bicarbonate of soda', 'baking-soda'],
  ['capsicum', 'bell-pepper'],
  ['castor sugar', 'sugar'],
  ['caster sugar', 'sugar'],
  ['chile', 'chili'],
  ['chilli', 'chili'],
  ['confectioner sugar', 'powdered-sugar'],
  ['coriander leaf', 'cilantro'],
  ['corn starch', 'cornstarch'],
  ['cornflour', 'cornstarch'],
  ['courgette', 'zucchini'],
  ['garbanzo bean', 'chickpea'],
  ['garbanzo', 'chickpea'],
  ['icing sugar', 'powdered-sugar'],
  ['peppercorn', 'black-pepper'],
  ['prawn', 'shrimp'],
  ['rocket', 'arugula'],
  ['scallion', 'green-onion'],
  ['spring onion', 'green-onion'],
  // varieties treated as the plain ingredient
  ['all purpose flour', 'flour'],
  ['brown onion', 'onion'],
  ['double cream', 'cream'],
  ['granulated sugar', 'sugar'],
  ['heavy cream', 'cream'],
  ['plain flour', 'flour'],
  ['red onion', 'onion'],
  ['spanish onion', 'onion'],
  ['sweet onion', 'onion'],
  ['white onion', 'onion'],
  ['white sugar', 'sugar'],
  ['whipping cream', 'cream'],
  ['yellow onion', 'onion'],
  // compounds that must not match their parts
  ['almond flour', 'almond-flour'],
  ['almond milk', 'almond-milk'],
  ['baking powder', 'baking-powder'],
  ['baking soda', 'baking-soda'],
  ['bay leaf', 'bay-leaf'],
  ['bell pepper', 'bell-pepper'],
  ['black pepper', 'black-pepper'],
  ['bread crumb', 'breadcrumb'],
  ['brown sugar', 'brown-sugar'],
  ['chili flake', 'chili-flake'],
  ['chili powder', 'chili-powder'],
  ['coconut flour', 'coconut-flour'],
  ['coconut milk', 'coconut-milk'],
  ['cooking spray', 'cooking-spray'],
  ['cream cheese', 'cream-cheese'],
  ['fish sauce', 'fish-sauce'],
  ['garlic powder', 'garlic-powder'],
  ['green onion', 'green-onion'],
  ['ice cream', 'ice-cream'],
  ['maple syrup', 'maple-syrup'],
  ['oat milk', 'oat-milk'],
  ['onion powder', 'onion-powder'],
  ['peanut butter', 'peanut-butter'],
  ['powdered sugar', 'powdered-sugar'],
  ['rice flour', 'rice-flour'],
  ['soy milk', 'soy-milk'],
  ['soy sauce', 'soy-sauce'],
  ['sour cream', 'sour-cream'],
  ['sweet potato', 'sweet-potato'],
  ['tomato paste', 'tomato-paste'],
  ['tomato sauce', 'tomato-sauce'],
];

/** Whole-name rewrites, applied only when the entire normalised name equals the key. */
export const EXACT_SYNONYMS: ReadonlyMap<string, string> = new Map([
  // plain "pepper" in a recipe means black pepper, never a bell pepper
  ['pepper', 'black-pepper'],
]);

/**
 * Extra words that turn a longer name into a different product: "garlic" must not match
 * "garlic powder" and "chicken" must not match "chicken broth". Single singular lower-case words.
 */
export const IDENTITY_WORDS: ReadonlySet<string> = new Set([
  'broth', 'crumb', 'flake', 'flour', 'noodle', 'oil', 'paste', 'powder', 'sauce', 'starch',
  'stock', 'syrup', 'vinegar',
]);

/** Names (after normalisation) that are always assumed to be in the kitchen when staples are on. */
export const STAPLE_NAMES: ReadonlySet<string> = new Set(['black-pepper', 'cooking-spray', 'water']);

/** Names whose last word is one of these are staples too (sea salt, olive oil, vegetable oil...). */
export const STAPLE_HEAD_WORDS: ReadonlySet<string> = new Set(['oil', 'salt']);

/** Words the pluralisation library would mangle ("molasses" becomes "molass"). Left untouched. */
export const UNCOUNTABLE_WORDS: readonly string[] = [
  'asparagus', 'brussels', 'citrus', 'couscous', 'cress', 'grits', 'hummus', 'lemongrass', 'molasses',
  'swiss', 'watercress',
];
