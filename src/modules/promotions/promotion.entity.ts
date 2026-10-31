import { Column, Entity, Index } from "typeorm";
import { BaseEntity } from "../../common/entities/base.entity";
@Entity("post_promotions")
@Index(["postId", "endsAt"])
export class Promotion extends BaseEntity {
  @Column("uuid") postId!: string;
  @Column({ type: "uuid", unique: true }) orderId!: string;
  @Column({ type: "timestamptz" }) startsAt!: Date;
  @Column({ type: "timestamptz" }) endsAt!: Date;
}
