import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
  TableUnique,
} from 'typeorm';

export class InitDevices1710000000001 implements MigrationInterface {
  name = 'InitDevices1710000000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(new Table({
      name: 'devices',
      columns: [
        { name: 'id', type: 'varchar', length: '36', isPrimary: true },
        { name: 'userId', type: 'varchar', length: '36' },
        { name: 'name', type: 'varchar', length: '120' },
        { name: 'connection', type: 'varchar', length: '2048' },
        { name: 'machineId', type: 'varchar', length: '255' },
        { name: 'deviceCode', type: 'varchar', length: '120' },
        { name: 'deviceToken', type: 'text' },
        { name: 'profilesJson', type: 'text', default: "'[]'" },
        { name: 'createdAt', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
        { name: 'updatedAt', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
      ],
      uniques: [new TableUnique({
        name: 'UQ_devices_user_connection',
        columnNames: ['userId', 'connection'],
      })],
    }), true);

    await queryRunner.createIndex('devices', new TableIndex({
      name: 'IDX_devices_user_id',
      columnNames: ['userId'],
    }));
    await queryRunner.createForeignKey('devices', new TableForeignKey({
      name: 'FK_devices_user_id',
      columnNames: ['userId'],
      referencedTableName: 'users',
      referencedColumnNames: ['id'],
      onDelete: 'CASCADE',
    }));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const devices = await queryRunner.getTable('devices');
    const foreignKey = devices?.foreignKeys.find((key) => key.name === 'FK_devices_user_id');
    if (foreignKey) {
      await queryRunner.dropForeignKey('devices', foreignKey);
    }
    await queryRunner.dropTable('devices', true);
  }
}
