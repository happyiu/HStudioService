import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('ghome_worlds')
@Index('UQ_ghome_world_owner', ['ownerId'], { unique: true })
export class GhomeWorld {
  @PrimaryColumn({ type: 'varchar', length: 36 }) id!: string;
  @Column({ type: 'varchar', length: 36 }) ownerId!: string;
  @Column({ type: 'integer', default: 1 }) schemaVersion!: number;
  @Column({ type: 'integer', default: 1 }) mapRevision!: number;
  @Column({ type: 'text' }) mapJson!: string;
  @Column({ type: 'text' }) runtimeJson!: string;
}

@Entity('ghome_commands')
export class GhomeCommandReceipt {
  @PrimaryColumn({ type: 'varchar', length: 36 }) worldId!: string;
  @PrimaryColumn({ type: 'varchar', length: 80 }) commandId!: string;
  @Column({ type: 'varchar', length: 64 }) digest!: string;
  @Column({ type: 'text' }) resultJson!: string;
}
