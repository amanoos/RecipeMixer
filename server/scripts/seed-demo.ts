// Fills a NEW folder with synthetic demo recipes so you can try the app or repeat a UI audit.
//
//   npm run seed:demo -w server -- --dir ./demo-data
//
// It refuses to run without an explicit --dir and refuses a folder that already holds a database,
// so it can never add demo recipes to your real library.
import fs from 'node:fs';
import path from 'node:path';
import { DB_FILENAME, openDatabase } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { createImageStore } from '../src/services/images.js';
import { seedDemoLibrary } from './demo-data.js';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = args.indexOf('--dir');
const dir = flag >= 0 ? args[flag + 1] : undefined;
if (!dir || dir.startsWith('--')) fail('Usage: npm run seed:demo -w server -- --dir ./demo-data');

const target = path.resolve(dir);
if (fs.existsSync(path.join(target, DB_FILENAME))) {
  fail(`${target} already contains ${DB_FILENAME}. Choose an empty folder; demo data is never added to an existing library.`);
}

const db = openDatabase(target);
migrate(db);
const created = await seedDemoLibrary(db, createImageStore(path.join(target, 'images')));
db.close();

console.log(`Created ${created} demo recipes in ${target}.`);
console.log(`Try them with:  DATA_DIR="${target}" npm start   (after npm run build)`);
