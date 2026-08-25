import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity({ name: "temporary_records" })
export class TemporaryRecordEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ default: "local development placeholder", length: 255 })
  message!: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
