import {
  Column,
  Entity,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { BaseEntity } from "../../common/entities/base.entity";
@Entity("payment_orders")
@Index("uq_payment_pending_post", ["postId"], {
  unique: true,
  where: "status = 'pending'",
})
@Index(["ownerId", "idempotencyKey"], { unique: true })
export class PaymentOrder extends BaseEntity {
  @Column("uuid") ownerId!: string;
  @Column("uuid") postId!: string;
  @Column() packageCode!: string;
  @Column("int") amount!: number;
  @Column("int") hours!: number;
  @Column({ unique: true }) txnRef!: string;
  @Column() idempotencyKey!: string;
  @Column({ default: "pending" }) status!: string;
  @Column({ default: "pending" }) fulfillment!: string;
  @Column({ type: "text", nullable: true }) reason!: string | null;
  @Column({ type: "varchar", nullable: true, unique: true }) transactionNo!:
    string | null;
  @Column({ type: "text" }) paymentUrl!: string;
  @Column({ type: "timestamptz" }) expiresAt!: Date;
  @CreateDateColumn({ type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ type: "timestamptz" }) updatedAt!: Date;
}

@Entity("payment_requests")
@Index(["ownerId", "key"], { unique: true })
export class PaymentRequest extends BaseEntity {
  @Column("uuid") ownerId!: string;
  @Column() key!: string;
  @Column("uuid") orderId!: string;
  @Column("uuid") postId!: string;
  @Column() packageCode!: string;
}
