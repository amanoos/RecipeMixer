// Prints the top matches for your own "what's in my fridge" lists, to judge match quality by eye.
//
//   npm run eval:matching -w server -- path/to/sets.json [--no-staples]
//
// sets.json is an array of ingredient lists, e.g. [["chicken", "rice"], ["eggs", "spinach", "feta"]].
// It reads the database in DATA_DIR (default ./data) and never changes your recipes; it only
// brings the ingredient index up to date, which the server also does on every start.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { DB_FILENAME, openDatabase } from '../src/db/connection.js';
import { backfillIngredients } from '../src/db/ingredients.js';
import { migrate } from '../src/db/migrate.js';
import { MAX_INGREDIENT_LENGTH, MAX_MATCH_INGREDIENTS } from '../src/schemas/match.js';
import { renderMatchReport } from '../src/services/match-report.js';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readSets(file: string): string[][] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    fail(`Could not read ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const valid =
    Array.isArray(parsed) &&
    parsed.length > 0 &&
    parsed.every(
      (set) =>
        Array.isArray(set) &&
        set.length > 0 &&
        set.length <= MAX_MATCH_INGREDIENTS &&
        set.every((item) => typeof item === 'string' && item.trim().length > 0 && item.length <= MAX_INGREDIENT_LENGTH),
    );
  if (!valid) {
    fail(
      `${file} must be a non-empty array of ingredient lists, each with 1-${MAX_MATCH_INGREDIENTS} ` +
        `non-empty strings of at most ${MAX_INGREDIENT_LENGTH} characters.`,
    );
  }
  return parsed as string[][];
}

const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith('--'));
if (!file) fail('Usage: npm run eval:matching -w server -- path/to/sets.json [--no-staples]');

const config = loadConfig();
if (!fs.existsSync(path.join(config.dataDir, DB_FILENAME))) {
  fail(`No database found in ${config.dataDir}. Set DATA_DIR to the folder that holds ${DB_FILENAME}.`);
}

const sets = readSets(file);
const db = openDatabase(config.dataDir);
migrate(db);
const reindexed = backfillIngredients(db);
if (reindexed > 0) console.error(`Updated ${reindexed} ingredient lines to the current matching rules.\n`);

console.log(renderMatchReport(db, sets, !args.includes('--no-staples')));
db.close();
