// Copies the SQL migration files next to the compiled JavaScript (tsc does not copy them).
import { cpSync } from 'node:fs';

cpSync(
  new URL('../src/db/migrations', import.meta.url),
  new URL('../dist/db/migrations', import.meta.url),
  { recursive: true },
);
