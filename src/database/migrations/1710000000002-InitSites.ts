import { MigrationInterface, QueryRunner, Table, TableIndex, TableUnique } from 'typeorm';

export class InitSites1710000000002 implements MigrationInterface {
  name = 'InitSites1710000000002';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(new Table({
      name: 'sites',
      columns: [
        { name: 'id', type: 'varchar', length: '36', isPrimary: true },
        { name: 'luckyRuleId', type: 'varchar', length: '120' },
        { name: 'sourceName', type: 'varchar', length: '255' },
        { name: 'url', type: 'varchar', length: '2048' },
        { name: 'sourceEnabled', type: 'boolean', default: '1' },
        { name: 'name', type: 'varchar', length: '120' },
        { name: 'icon', type: 'varchar', length: '120', default: "'globe'" },
        { name: 'category', type: 'varchar', length: '64', default: "'other'" },
        { name: 'accessMode', type: 'varchar', length: '32', default: "'public'" },
        { name: 'enabled', type: 'boolean', default: '1' },
        { name: 'favorite', type: 'boolean', default: '0' },
        { name: 'sortOrder', type: 'integer', default: '0' },
        { name: 'syncStatus', type: 'varchar', length: '16', default: "'active'" },
        { name: 'lastSeenAt', type: 'datetime', isNullable: true },
        { name: 'createdAt', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
        { name: 'updatedAt', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
      ],
      uniques: [new TableUnique({
        name: 'UQ_sites_lucky_rule_id',
        columnNames: ['luckyRuleId'],
      })],
    }), true);

    await queryRunner.createIndex('sites', new TableIndex({
      name: 'IDX_sites_sync_status',
      columnNames: ['syncStatus'],
    }));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('sites', true);
  }
}
