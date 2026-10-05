// refresh-token.entity.ts
import { Entity, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { UserEntity } from '../user/user.entity';
import { BaseEntity } from '../../common/entities/base.entity';

export interface DeviceInfo {
  browser?: string;
  browserVersion?: string;
  os?: string;
  osVersion?: string;
  device?: string;
}

@Entity('refresh_tokens')
export class RefreshTokenEntity extends BaseEntity {
  @ManyToOne(() => UserEntity, (user) => user.refreshTokens, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @Column({ unique: true, name: 'token_hash' })
  tokenHash!: string;

  @Column({
    type: 'jsonb',
    name: 'device_info',
    nullable: true,
  })
  deviceInfo!: DeviceInfo | null;

  @Column({ default: false, name: 'is_revoked' })
  isRevoked!: boolean;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
