import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('devices')
@Index('IDX_devices_user_id', ['userId'])
@Index('UQ_devices_user_connection', ['userId', 'connection'], { unique: true })
export class Device {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  userId!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 2048 })
  connection!: string;

  @Column({ type: 'varchar', length: 255 })
  machineId!: string;

  @Column({ type: 'varchar', length: 120 })
  deviceCode!: string;

  @Column({ type: 'text' })
  deviceToken!: string;

  @Column({ type: 'text', default: "'[]'" })
  profilesJson!: string;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
