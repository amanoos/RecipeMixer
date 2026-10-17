// Synthetic recipes with generated photos, for trying the app out and for repeatable audits and screenshots.
// Nothing here is real data: titles and ingredients are made up and the photos are plain colour fields.
import sharp from 'sharp';
import type { Db } from '../src/db/connection.js';
import { createRecipe, setRecipeImage } from '../src/db/recipes.js';
import type { RecipeInput } from '../src/schemas/recipe.js';
import { processImage, type ImageStore } from '../src/services/images.js';

const CUISINES = ['Italian', 'Indian', 'Mexican', 'Thai', 'American', 'French', null] as const;

const INGREDIENT_SETS: string[][] = [
  ['2 cups chopped tomatoes', '1 onion, diced', '2 cloves garlic', '1 tbsp olive oil', 'salt and pepper'],
  ['1 lb chicken thighs', '1 onion', '2 tbsp curry powder', '1 cup basmati rice', '1 can coconut milk'],
  ['1 lb ground beef', '8 corn tortillas', '1 cup shredded cheddar', '1 tomato', '1 avocado'],
  ['8 oz spaghetti', '3 cloves garlic', '1/4 cup olive oil', 'parmesan cheese', 'fresh parsley'],
  ['2 eggs', '1 cup flour', '1 cup milk', '1 tbsp sugar', 'butter for the pan'],
];

const TITLES = [
  'Tomato Soup',
  'Chicken Curry',
  'Beef Tacos',
  'Pad Thai',
  'Mac and Cheese',
  'Ratatouille',
  'Garlic Pasta',
  'Veggie Stir Fry',
  'Black Bean Chili',
  'Lemon Chicken',
  'Mushroom Risotto',
  'Fried Rice',
  'Greek Salad',
  'Pancakes',
  'Shakshuka',
  'Lentil Dal',
  'Pork Dumplings',
  'Caprese Salad',
  'Fish Tacos',
  'Pesto Gnocchi',
  'Potato Leek Soup',
  'Egg Fried Noodles',
  'Chickpea Curry',
  'Spinach Quiche',
  'BBQ Chicken Wraps',
  'Thai Green Curry',
  'Stuffed Peppers',
  'Banana Bread',
  'Avocado Toast',
  'Minestrone with a very long title that keeps going to test how a card wraps its text',
];

export const DEMO_RECIPE_COUNT = TITLES.length;

export function demoRecipe(index: number): RecipeInput {
  return {
    title: TITLES[index % TITLES.length]!,
    cuisine: CUISINES[index % CUISINES.length] ?? null,
    description: 'A made-up recipe used to try out the app. Cook until done and serve warm.',
    sourceUrl: index % 3 === 0 ? `https://recipes.example/demo/${index + 1}` : null,
    rating: index % 4 === 0 ? null : (index % 5) + 1,
    ingredients: INGREDIENT_SETS[index % INGREDIENT_SETS.length]!,
    steps: ['Prepare and measure everything.', 'Cook until done, stirring now and then.', 'Taste, adjust and serve.'],
  };
}

/** A plain colour field in a spread of hues, big enough to behave like a real photo upload. */
async function demoPhoto(index: number): Promise<Buffer> {
  const hue = (index * 47) % 360;
  return sharp({
    create: {
      width: 1200,
      height: 900,
      channels: 3,
      background: { r: 120 + (hue % 100), g: 90 + ((hue * 2) % 120), b: 80 + ((hue * 3) % 140) },
    },
  })
    .png()
    .toBuffer();
}

/** Adds the demo recipes (four in five with a photo) and returns how many were created. */
export async function seedDemoLibrary(db: Db, images: ImageStore, count = DEMO_RECIPE_COUNT): Promise<number> {
  for (let index = 0; index < count; index++) {
    const id = createRecipe(db, demoRecipe(index));
    if (index % 5 === 4) continue;
    const { data, filename } = await processImage(await demoPhoto(index));
    await images.save(filename, data);
    setRecipeImage(db, id, filename);
  }
  return count;
}
