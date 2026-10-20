import { MigrationInterface, QueryRunner } from 'typeorm';

export class MessageTags1710000000008 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE hub_messages ADD COLUMN tagsJson text NOT NULL DEFAULT '[]'`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE hub_messages DROP COLUMN tagsJson');
  }
}
