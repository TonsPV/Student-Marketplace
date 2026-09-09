// user.entity.ts
import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, OneToMany, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, Index } from 'typeorm';
import { RefreshTokenEntity } from '../refresh-tokens/refresh-token.entity';


@Entity('user')
export class UserEntity extends BaseEntity {
  @Index('idx_user_email_active', { unique: true, where: '"deleted_at" IS NULL' })
  @Column()
  email!: string;

  @Column()
  password!: string;

  @Column({name: 'full_name'})
  fullName!: string;

  @Column({ nullable: true })
  phone!: string | null;

  @Column({ nullable: true, name: 'avatar_url' })
  avatarUrl!: string | null;

  @Column({
    type: 'geography',
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: true,
  })
  location!: string;

  @Column({ default: false })
  is_locked!: boolean;

  @OneToMany(() => RefreshTokenEntity, (rt) => rt.user)
  refreshTokens!: RefreshTokenEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt!: Date;
}
