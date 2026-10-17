// Adds the bundled starter recipes (original, CC0) to a library folder.
//
//   npm run seed:starter -w server -- --dir ./data
//
// Needs an explicit --dir so it can never touch a library by accident. Repeating it adds nothing,
// because recipes whose title is already in the library are skipped.
import path from 'node:path';
import { openDatabase } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { loadStarterRecipes } from '../src/services/starter-recipes.js';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = args.indexOf('--dir');
const dir = flag >= 0 ? args[flag + 1] : undefined;
if (!dir || dir.startsWith('--')) fail('Usage: npm run seed:starter -w server -- --dir ./data');

const target = path.resolve(dir);
const db = openDatabase(target);
migrate(db);
const { added, skipped } = loadStarterRecipes(db);
db.close();

console.log(`Added ${added} starter recipes to ${target} (${skipped} already there).`);
