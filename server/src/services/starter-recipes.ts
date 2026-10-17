import fs from 'node:fs';
import { z } from 'zod';
import type { Db } from '../db/connection.js';
import { createRecipe } from '../db/recipes.js';
import { recipeInputSchema, type RecipeInput } from '../schemas/recipe.js';

// Original recipes written for this project and released under CC0 1.0 (see LICENSE-starter-recipes.txt).
// The file sits next to the compiled code: the build copies src/data to dist/data.
const STARTER_FILE = new URL('../data/starter-recipes.json', import.meta.url);

export interface StarterResult {
  added: number;
  skipped: number;
}

let cached: RecipeInput[] | undefined;

/** The bundled recipes, checked against the same rules as any recipe a user saves. */
export function readStarterRecipes(): RecipeInput[] {
  cached ??= z.array(recipeInputSchema).parse(JSON.parse(fs.readFileSync(STARTER_FILE, 'utf8')));
  return cached;
}

/** Adds the starter recipes that are not already in the library (same title, ignoring case). Safe to repeat. */
export function loadStarterRecipes(db: Db): StarterResult {
  const recipes = readStarterRecipes();
  return db.transaction(() => {
    const existing = new Set(
      (db.prepare('SELECT title FROM recipe').all() as { title: string }[]).map((row) => row.title.toLowerCase()),
    );
    let added = 0;
    for (const recipe of recipes) {
      if (existing.has(recipe.title.toLowerCase())) continue;
      createRecipe(db, recipe);
      added += 1;
    }
    return { added, skipped: recipes.length - added };
  })();
}
