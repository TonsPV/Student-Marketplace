import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from "typeorm";
import { BaseEntity } from "../../common/entities/base.entity";

@Entity("categories")
@Index("idx_category_sibling_name", ["parentId", "name"], { unique: true })
@Index("idx_category_root_name", ["name"], {
  unique: true,
  where: '"parent_id" IS NULL',
})
export class CategoryEntity extends BaseEntity {
  @Column({ length: 100 })
  name!: string;

  @Column({ name: "parent_id", type: "uuid", nullable: true })
  parentId!: string | null;

  @ManyToOne(() => CategoryEntity, (category) => category.children, {
    nullable: true,
    onDelete: "RESTRICT",
  })
  @JoinColumn({ name: "parent_id" })
  parent!: CategoryEntity | null;

  @OneToMany(() => CategoryEntity, (category) => category.parent)
  children!: CategoryEntity[];
}
