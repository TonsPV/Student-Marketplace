import { BaseEntity } from "../../common/entities/base.entity";
import { PostEntity } from "../posts/post.entity";
import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@Entity("post_image")
@Index("idx_post_image_post_id", ["postId"])
@Check("chk_post_image_source", '("url" IS NULL) <> ("storage_key" IS NULL)')
export class PostImageEntity extends BaseEntity {
  @Column({ name: "post_id", type: "uuid" })
  postId!: string;

  @ManyToOne(() => PostEntity, (post) => post.images, { onDelete: "CASCADE" })
  @JoinColumn({ name: "post_id" })
  post!: PostEntity;

  @Column({ type: "varchar", length: 2048, nullable: true })
  url!: string | null;

  @Column({ name: "storage_key", type: "varchar", length: 256, nullable: true })
  storageKey!: string | null;
}
