import { BaseEntity } from "../../common/entities/base.entity";
import { PostEntity } from "../posts/post.entity";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@Entity("post_image")
@Index("idx_post_image_post_id", ["postId"])
export class PostImageEntity extends BaseEntity {
  @Column({ name: "post_id", type: "uuid" })
  postId!: string;

  @ManyToOne(() => PostEntity, (post) => post.images, { onDelete: "CASCADE" })
  @JoinColumn({ name: "post_id" })
  post!: PostEntity;

  @Column({ type: "varchar", length: 2048 })
  url!: string;
}
