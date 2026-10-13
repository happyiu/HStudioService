import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitGhomePlayer1710000000005 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE ghome_players (
      ownerId varchar(36) PRIMARY KEY NOT NULL, id varchar(36) NOT NULL UNIQUE,
      nickname varchar(24) NOT NULL, appearanceJson text NOT NULL, createdAt integer NOT NULL,
      FOREIGN KEY(ownerId) REFERENCES users(id) ON DELETE CASCADE)`);
    await q.query(`CREATE TABLE ghome_world_creation (
      ownerId varchar(36) PRIMARY KEY NOT NULL, worldId varchar(36) NOT NULL UNIQUE,
      name varchar(24) NOT NULL, templateId varchar(40) NOT NULL, templateVersion integer NOT NULL DEFAULT 1,
      status varchar(20) NOT NULL, completed integer NOT NULL DEFAULT 0, error text NOT NULL DEFAULT '', createdAt integer NOT NULL,
      FOREIGN KEY(ownerId) REFERENCES ghome_players(ownerId) ON DELETE CASCADE)`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE ghome_world_creation');
    await q.query('DROP TABLE ghome_players');
  }
}
