import { MigrationInterface, QueryRunner } from 'typeorm';
export class InitGhomeSaveArchive1710000000006 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE ghome_save_archives (
      id varchar(36) PRIMARY KEY NOT NULL, ownerId varchar(36) NOT NULL,
      nickname varchar(24) NOT NULL, deletedAt integer NOT NULL, snapshotJson text NOT NULL,
      FOREIGN KEY(ownerId) REFERENCES users(id) ON DELETE CASCADE)`);
    await q.query('CREATE INDEX IDX_ghome_archive_owner ON ghome_save_archives (ownerId)');
  }
  async down(q: QueryRunner): Promise<void> { await q.query('DROP TABLE ghome_save_archives'); }
}
