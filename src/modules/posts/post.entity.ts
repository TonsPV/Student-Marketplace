import { BaseEntity } from "../../common/entities/base.entity";
import { CategoryEntity } from "../categories/category.entity";
import { UserEntity } from "../user/user.entity";
import {
  Column,
  Check,
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
  HIDDEN = "hidden",
  EXPIRED = "expired",
}

@Entity("posts")
@Index("idx_posts_seller_id", ["sellerId"])
@Index("idx_posts_category_id", ["categoryId"])
@Index("idx_posts_location", ["location"], { spatial: true })
@Index("idx_posts_created_at", ["createdAt"])
@Index("idx_posts_seller_status_expires", ["sellerId", "status", "expiresAt"], {
  where: '"deleted_at" IS NULL',
})
@Index("idx_posts_status_expires", ["status", "expiresAt"], {
  where: '"deleted_at" IS NULL',
})
@Check(
  "chk_posts_lifetime",
  '"expires_at" > "published_at" AND "renewal_count" >= 0',
)
@Index("idx_posts_title_unaccent_trgm", { synchronize: false })
@Index("idx_posts_description_unaccent_trgm", { synchronize: false })
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

  @ManyToOne(() => CategoryEntity, (category) => category.posts, {
    onDelete: "RESTRICT",
  })
  @JoinColumn({ name: "category_id" })
  category!: CategoryEntity;

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

  /** Start of the current display cycle; createdAt remains the original date. */
  @Column({
    name: "published_at",
    type: "timestamptz",
    default: () => "CURRENT_TIMESTAMP",
  })
  publishedAt!: Date;

  @Column({
    name: "expires_at",
    type: "timestamptz",
    // TypeORM normalizes expressions containing CURRENT_TIMESTAMP to now(),
    // dropping the interval. Use now() explicitly so synchronize preserves it.
    default: () => "(now() + interval '336 hours')",
  })
  expiresAt!: Date;

  @Column({ name: "renewal_count", type: "integer", default: 0 })
  renewalCount!: number;

  @Column({
    type: "geography",
    spatialFeatureType: "Point",
    srid: 4326,
    nullable: true,
  })
  location!: Point | null;

  @Column({
    name: "location_name",
    type: "varchar",
    length: 255,
    nullable: true,
  })
  locationName!: string | null;

  @OneToMany(() => PostImageEntity, (image) => image.post)
  images!: PostImageEntity[];

  /**
   * Người mua đã xác nhận trên nền tảng. NULL nếu chưa bán hoặc bán ngoài app.
   * Không dùng buyer_id IS NULL làm dấu hiệu duy nhất để kết luận chưa bán;
   * phải kiểm tra status = 'sold'.
   */
  @Column({ name: "buyer_id", type: "uuid", nullable: true })
  buyerId!: string | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: "RESTRICT" })
  @JoinColumn({ name: "buyer_id" })
  buyer!: UserEntity | null;

  /** Thời điểm xác nhận bán. NULL nếu chưa bán. Lưu dạng timestamptz. */
  @Column({ name: "sold_at", type: "timestamptz", nullable: true })
  soldAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @DeleteDateColumn({ name: "deleted_at" })
  deletedAt!: Date | null;
}
