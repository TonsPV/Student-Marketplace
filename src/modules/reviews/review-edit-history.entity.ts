import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from "typeorm";
import { BaseEntity } from "../../common/entities/base.entity";
import { ReviewEntity } from "./review.entity";
import { UserEntity } from "../user/user.entity";

@Entity("review_edit_histories")
@Index("uq_review_edit_histories_review_revision", ["reviewId", "revision"], {
  unique: true,
})
export class ReviewEditHistoryEntity extends BaseEntity {
  @Column({ name: "review_id", type: "uuid" })
  reviewId!: string;

  @ManyToOne(() => ReviewEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "review_id" })
  review!: ReviewEntity;

  @Column({ name: "editor_id", type: "uuid" })
  editorId!: string;

  @ManyToOne(() => UserEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "editor_id" })
  editor!: UserEntity;

  @Column({ name: "old_rating", type: "integer" })
  oldRating!: number;

  @Column({ name: "new_rating", type: "integer" })
  newRating!: number;

  @Column({ name: "old_comment", type: "text", nullable: true })
  oldComment!: string | null;

  @Column({ name: "new_comment", type: "text", nullable: true })
  newComment!: string | null;

  @Column({ type: "integer" })
  revision!: number;

  @CreateDateColumn({ name: "edited_at", type: "timestamptz" })
  editedAt!: Date;
}
