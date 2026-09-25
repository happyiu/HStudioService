import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AllowCustomSites1710000000003 implements MigrationInterface {
  name = 'AllowCustomSites1710000000003';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('sites');
    const column = table?.findColumnByName('luckyRuleId');
    if (!column || column.isNullable) return;

    await queryRunner.changeColumn('sites', column, new TableColumn({
      name: 'luckyRuleId',
      type: column.type,
      length: column.length,
      isNullable: true,
    }));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const rows = await queryRunner.query(
      'SELECT COUNT(*) AS count FROM "sites" WHERE "luckyRuleId" IS NULL',
    ) as Array<{ count: number | string }>;
    if (Number(rows[0]?.count || 0) > 0) {
      throw new Error('Cannot revert custom sites migration while custom sites exist');
    }

    const table = await queryRunner.getTable('sites');
    const column = table?.findColumnByName('luckyRuleId');
    if (!column || !column.isNullable) return;

    await queryRunner.changeColumn('sites', column, new TableColumn({
      name: 'luckyRuleId',
      type: column.type,
      length: column.length,
      isNullable: false,
    }));
  }
}
