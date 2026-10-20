import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitNotifications1710000000007 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE webhook_sources (
      id text PRIMARY KEY NOT NULL, userId text NOT NULL, name text NOT NULL,
      secretHash text NOT NULL, enabled integer NOT NULL DEFAULT 1, createdAt integer NOT NULL,
      FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE)`);
    await q.query('CREATE INDEX IDX_webhook_owner ON webhook_sources(userId)');
    await q.query(`CREATE TABLE hub_messages (
      id text PRIMARY KEY NOT NULL, userId text NOT NULL, sourceId text NOT NULL, sourceName text NOT NULL,
      eventId text, title text NOT NULL, content text NOT NULL, dataJson text,
      createdAt integer NOT NULL, expiresAt integer NOT NULL, readAt integer,
      FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(sourceId) REFERENCES webhook_sources(id), UNIQUE(sourceId, eventId))`);
    await q.query('CREATE INDEX IDX_messages_owner_created ON hub_messages(userId, createdAt, id)');
    await q.query(`CREATE TABLE push_devices (
      id text PRIMARY KEY NOT NULL, installationId text NOT NULL UNIQUE, cid text NOT NULL UNIQUE,
      userId text NOT NULL, sessionId text NOT NULL, platform text NOT NULL,
      enabled integer NOT NULL, updatedAt integer NOT NULL,
      FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(sessionId) REFERENCES auth_sessions(id) ON DELETE CASCADE)`);
    await q.query('CREATE INDEX IDX_push_devices_owner ON push_devices(userId)');
    await q.query(`CREATE TABLE push_deliveries (
      id text PRIMARY KEY NOT NULL, messageId text NOT NULL, deviceId text NOT NULL,
      sessionId text NOT NULL, cid text NOT NULL, status text NOT NULL DEFAULT 'pending',
      attempts integer NOT NULL DEFAULT 0, nextAttemptAt integer NOT NULL,
      lastError text, providerTaskId text, updatedAt integer NOT NULL,
      FOREIGN KEY(messageId) REFERENCES hub_messages(id) ON DELETE CASCADE,
      FOREIGN KEY(deviceId) REFERENCES push_devices(id) ON DELETE CASCADE, UNIQUE(messageId, deviceId))`);
    await q.query('CREATE INDEX IDX_push_due ON push_deliveries(status, nextAttemptAt)');
  }
  async down(q: QueryRunner): Promise<void> {
    for (const table of ['push_deliveries', 'push_devices', 'hub_messages', 'webhook_sources']) await q.query(`DROP TABLE ${table}`);
  }
}
