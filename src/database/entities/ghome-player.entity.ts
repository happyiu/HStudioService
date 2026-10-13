import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('ghome_players')
export class GhomePlayer {
  @PrimaryColumn({ type: 'varchar', length: 36 }) ownerId!: string;
  @Column({ type: 'varchar', length: 36, unique: true }) id!: string;
  @Column({ type: 'varchar', length: 24 }) nickname!: string;
  @Column({ type: 'text' }) appearanceJson!: string;
  @Column({ type: 'integer' }) createdAt!: number;
}

@Entity('ghome_world_creation')
export class GhomeWorldCreation {
  @PrimaryColumn({ type: 'varchar', length: 36 }) ownerId!: string;
  @Column({ type: 'varchar', length: 36, unique: true }) worldId!: string;
  @Column({ type: 'varchar', length: 24 }) name!: string;
  @Column({ type: 'varchar', length: 40 }) templateId!: string;
  @Column({ type: 'integer', default: 1 }) templateVersion!: number;
  @Column({ type: 'varchar', length: 20 }) status!: 'INITIALIZING' | 'FAILED' | 'READY';
  @Column({ type: 'integer', default: 0 }) completed!: number;
  @Column({ type: 'text', default: '' }) error!: string;
  @Column({ type: 'integer' }) createdAt!: number;
}

@Entity('ghome_save_archives')
@Index('IDX_ghome_archive_owner', ['ownerId'])
export class GhomeSaveArchive {
  @PrimaryColumn({ type: 'varchar', length: 36 }) id!: string;
  @Column({ type: 'varchar', length: 36 }) ownerId!: string;
  @Column({ type: 'varchar', length: 24 }) nickname!: string;
  @Column({ type: 'integer' }) deletedAt!: number;
  @Column({ type: 'text' }) snapshotJson!: string;
}
