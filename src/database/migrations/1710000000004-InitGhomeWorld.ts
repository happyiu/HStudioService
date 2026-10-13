import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitGhomeWorld1710000000004 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE ghome_worlds (
      id varchar(36) PRIMARY KEY NOT NULL, ownerId varchar(36) NOT NULL UNIQUE,
      schemaVersion integer NOT NULL DEFAULT 1, mapRevision integer NOT NULL DEFAULT 1,
      mapJson text NOT NULL, runtimeJson text NOT NULL,
      FOREIGN KEY(ownerId) REFERENCES users(id) ON DELETE CASCADE)`);
    await queryRunner.query(`CREATE TABLE ghome_commands (
      worldId varchar(36) NOT NULL, commandId varchar(80) NOT NULL,
      digest varchar(64) NOT NULL, resultJson text NOT NULL,
      PRIMARY KEY(worldId, commandId),
      FOREIGN KEY(worldId) REFERENCES ghome_worlds(id) ON DELETE CASCADE)`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE ghome_commands');
    await queryRunner.query('DROP TABLE ghome_worlds');
  }
}
