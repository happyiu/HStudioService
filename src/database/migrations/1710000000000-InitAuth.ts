import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
  TableUnique,
} from 'typeorm';

export class InitAuth1710000000000 implements MigrationInterface {
  name = 'InitAuth1710000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(new Table({
      name: 'users',
      columns: [
        { name: 'id', type: 'varchar', length: '36', isPrimary: true },
        { name: 'username', type: 'varchar', length: '64' },
        { name: 'passwordHash', type: 'varchar', length: '255' },
        { name: 'role', type: 'varchar', length: '32', default: "'admin'" },
        { name: 'isActive', type: 'boolean', default: '1' },
        { name: 'createdAt', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
        { name: 'updatedAt', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
      ],
      uniques: [new TableUnique({
        name: 'UQ_users_username',
        columnNames: ['username'],
      })],
    }), true);

    await queryRunner.createTable(new Table({
      name: 'auth_sessions',
      columns: [
        { name: 'id', type: 'varchar', length: '36', isPrimary: true },
        { name: 'userId', type: 'varchar', length: '36' },
        { name: 'refreshTokenHash', type: 'varchar', length: '255' },
        { name: 'expiresAt', type: 'datetime' },
        { name: 'revokedAt', type: 'datetime', isNullable: true },
        { name: 'lastUsedAt', type: 'datetime' },
        { name: 'userAgent', type: 'varchar', length: '255', isNullable: true },
        { name: 'ipAddress', type: 'varchar', length: '64', isNullable: true },
        { name: 'createdAt', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
      ],
    }), true);

    await queryRunner.createIndex('auth_sessions', new TableIndex({
      name: 'IDX_auth_sessions_user_id',
      columnNames: ['userId'],
    }));
    await queryRunner.createForeignKey('auth_sessions', new TableForeignKey({
      name: 'FK_auth_sessions_user_id',
      columnNames: ['userId'],
      referencedTableName: 'users',
      referencedColumnNames: ['id'],
      onDelete: 'CASCADE',
    }));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const sessions = await queryRunner.getTable('auth_sessions');
    const foreignKey = sessions?.foreignKeys.find((key) => key.name === 'FK_auth_sessions_user_id');
    if (foreignKey) {
      await queryRunner.dropForeignKey('auth_sessions', foreignKey);
    }
    await queryRunner.dropTable('auth_sessions', true);
    await queryRunner.dropTable('users', true);
  }
}
