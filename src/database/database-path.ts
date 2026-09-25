import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function resolveDatabasePath(databasePath = process.env.DB_PATH || './data/home-hub.sqlite'): string {
  const absolutePath = resolve(databasePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  return absolutePath;
}
