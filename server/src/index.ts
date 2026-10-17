import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db/connection.js';
import { backfillIngredients } from './db/ingredients.js';
import { migrate } from './db/migrate.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.dataDir);
  migrate(db);
  // Indexes ingredient lines saved before the matching feature (or by an older rule version).
  const reindexed = backfillIngredients(db);

  const app = await buildApp({ config, db });
  if (reindexed > 0) app.log.info({ reindexed }, 'ingredient index updated');

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    await app.close();
    db.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    config.appPassword === null
      ? 'no password set: the app is open to anyone who can reach this address'
      : 'login is required: the API and photos need the app password',
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
