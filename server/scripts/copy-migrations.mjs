// Copies the files tsc does not (SQL migrations and bundled data) next to the compiled JavaScript.
import { cpSync } from 'node:fs';

for (const folder of ['db/migrations', 'data']) {
  cpSync(new URL(`../src/${folder}`, import.meta.url), new URL(`../dist/${folder}`, import.meta.url), {
    recursive: true,
  });
}
