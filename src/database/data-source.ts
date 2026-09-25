import 'reflect-metadata';

import { join } from 'node:path';
import { DataSource } from 'typeorm';

import { resolveDatabasePath } from './database-path';
import { Device } from './entities/device.entity';
import { AuthSession } from './entities/auth-session.entity';
import { Site } from './entities/site.entity';
import { User } from './entities/user.entity';

export default new DataSource({
  type: 'better-sqlite3',
  database: resolveDatabasePath(),
  entities: [User, AuthSession, Device, Site],
  migrations: [join(__dirname, 'migrations/*{.js,.ts}')],
});
