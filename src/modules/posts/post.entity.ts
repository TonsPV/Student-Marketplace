import { BaseEntity } from "../../common/entities/base.entity";
import { UserEntity } from "../user/user.entity";
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  Point,
  UpdateDateColumn,
} from "typeorm";
import { PostImageEntity } from "../post-images/post-image.entity";

export enum PostCondition {
  NEW = "new",
  LIKE_NEW = "like_new",
  GOOD = "good",
  USED = "used",
}

export enum PostStatus {
  ACTIVE = "active",
  SOLD = "sold",
}

@Entity("posts")
@Index("idx_posts_seller_id", ["sellerId"])
@Index("idx_posts_category_id", ["categoryId"])
@Index("idx_posts_location", ["location"], { spatial: true })
export class PostEntity extends BaseEntity {
  @Column({ name: "seller_id", type: "uuid" })
  sellerId!: string;

  @ManyToOne(() => UserEntity, (user) => user.posts, {
    onDelete: "RESTRICT",
  })
  @JoinColumn({ name: "seller_id" })
  seller!: UserEntity;

  @Column({ name: "category_id", type: "uuid" })
  categoryId!: string;

  @Column({ type: "varchar", length: 150 })
  title!: string;

  @Column({ type: "text" })
  description!: string;

  @Column({
    type: "numeric",
    precision: 15,
    scale: 0,
  })
  price!: string;

  @Column({
    type: "enum",
    enum: PostCondition,
  })
  condition!: PostCondition;

  @Column({
    type: "enum",
    enum: PostStatus,
    default: PostStatus.ACTIVE,
  })
  status!: PostStatus;

  @Column({
    type: "geography",
    spatialFeatureType: "Point",
    srid: 4326,
    nullable: true,
  })
  location!: Point | null;

  @OneToMany(() => PostImageEntity, (image) => image.post)
  images!: PostImageEntity[];

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt!: Date;

  @DeleteDateColumn({ name: "deleted_at" })
  deletedAt!: Date | null;
}
