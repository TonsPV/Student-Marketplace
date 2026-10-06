import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  UpdateDateColumn,
} from "typeorm";
import { BaseEntity } from "../../common/entities/base.entity";
import { PostEntity } from "../posts/post.entity";
import { UserEntity } from "../user/user.entity";

@Entity("reviews")
@Index("uq_reviews_reviewer_post", ["reviewerId", "postId"], {
  unique: true,
})
@Index("idx_reviews_post_created_at", ["postId", "createdAt"])
export class ReviewEntity extends BaseEntity {
  @Column({ name: "reviewer_id", type: "uuid" })
  reviewerId!: string;

  @ManyToOne(() => UserEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "reviewer_id" })
  reviewer!: UserEntity;

  @Column({ name: "post_id", type: "uuid" })
  postId!: string;

  @ManyToOne(() => PostEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "post_id" })
  post!: PostEntity;

  @Column({ type: "integer" })
  rating!: number;

  @Column({ type: "text", nullable: true })
  comment!: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt!: Date;
}
