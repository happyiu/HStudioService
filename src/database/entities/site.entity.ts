import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('sites')
@Index('UQ_sites_lucky_rule_id', ['luckyRuleId'], { unique: true })
@Index('IDX_sites_sync_status', ['syncStatus'])
export class Site {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  luckyRuleId!: string | null;

  @Column({ type: 'varchar', length: 255 })
  sourceName!: string;

  @Column({ type: 'varchar', length: 2048 })
  url!: string;

  @Column({ type: 'boolean', default: true })
  sourceEnabled!: boolean;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 120, default: 'globe' })
  icon!: string;

  @Column({ type: 'varchar', length: 64, default: 'other' })
  category!: string;

  @Column({ type: 'varchar', length: 32, default: 'public' })
  accessMode!: string;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ type: 'boolean', default: false })
  favorite!: boolean;

  @Column({ type: 'integer', default: 0 })
  sortOrder!: number;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  syncStatus!: 'active' | 'missing';

  @Column({ type: 'datetime', nullable: true })
  lastSeenAt!: Date | null;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
