import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  Unique,
} from "typeorm";
import { BaseEntity } from "../../common/entities/base.entity";
import { PostEntity } from "../posts/post.entity";
import { UserEntity } from "../user/user.entity";

@Entity("favorites")
@Unique("uq_favorites_user_post", ["userId", "postId"])
@Index("idx_favorites_user_created", ["userId", "createdAt", "id"])
@Index("idx_favorites_post_id", ["postId"])
export class FavoriteEntity extends BaseEntity {
  @Column({ name: "user_id", type: "uuid" })
  userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: UserEntity;

  @Column({ name: "post_id", type: "uuid" })
  postId!: string;

  @ManyToOne(() => PostEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "post_id" })
  post!: PostEntity;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;
}
