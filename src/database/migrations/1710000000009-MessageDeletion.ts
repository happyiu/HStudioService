import { MigrationInterface, QueryRunner } from 'typeorm';

export class MessageDeletion1710000000009 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE hub_messages ADD COLUMN deletedAt integer');
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE hub_messages DROP COLUMN deletedAt');
  }
}
