import { GhomePlayer, GhomeWorldCreation, GhomeSaveArchive } from './database/entities/ghome-player.entity';
import { GhomeWorldModule } from './ghome-world/ghome-world.module';
import { GhomeWorld, GhomeCommandReceipt } from './database/entities/ghome-world.entity';
import { join } from 'node:path';

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from './auth/auth.module';
import { AppController } from './app.controller';
import { resolveDatabasePath } from './database/database-path';
import { Device } from './database/entities/device.entity';
import { AuthSession } from './database/entities/auth-session.entity';
import { Site } from './database/entities/site.entity';
import { User } from './database/entities/user.entity';
import { DevicesModule } from './devices/devices.module';
import { GhomeModule } from './ghome/ghome.module';
import { LuckyModule } from './lucky/lucky.module';
import { PveModule } from './pve/pve.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'better-sqlite3' as const,
        database: resolveDatabasePath(config.get<string>('DB_PATH')),
        entities: [User, AuthSession, Device, Site, GhomeWorld, GhomeCommandReceipt, GhomePlayer, GhomeWorldCreation, GhomeSaveArchive],
        migrations: [join(__dirname, 'database/migrations/*{.js,.ts}')],
        migrationsRun: true,
        synchronize: false,
      }),
    }),
    AuthModule,
    DevicesModule,
    GhomeModule,
    GhomeWorldModule,
    LuckyModule,
    PveModule,
    NotificationsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
