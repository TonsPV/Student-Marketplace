import "reflect-metadata";
import { DataSource } from "typeorm";
import { uuidv7 } from "uuidv7";
import {
  PostCondition,
  PostStatus,
  PostEntity,
} from "src/modules/posts/post.entity";
import { UserEntity } from "src/modules/user/user.entity";
import { CategoryEntity } from "../../src/modules/categories/category.entity";
import { ownedTestSchema } from "./database";

/**
 * Fixtures cho I-series (mỗi test tự tạo + dọn dữ liệu của mình).
 * Chỉ dùng trong test/integration với DB test riêng.
 */
export async function createTestUser(
  ds: DataSource,
  overrides: Partial<UserEntity> = {},
): Promise<UserEntity> {
  const repo = ds.getRepository(UserEntity);
  const user = repo.create({
    id: uuidv7(),
    email: `test-${uuidv7()}@example.com`,
    password: "not-a-real-hash",
    fullName: "Test User",
    phone: null,
    avatarUrl: null,
    location: null as unknown as string,
    isLocked: false,
    isAdmin: false,
    ...overrides,
  });
  return repo.save(user);
}

export async function createTestPost(
  ds: DataSource,
  sellerId: string,
  categoryId: string,
  overrides: Partial<PostEntity> = {},
): Promise<PostEntity> {
  const repo = ds.getRepository(PostEntity);
  const post = repo.create({
    id: uuidv7(),
    sellerId,
    categoryId,
    title: "Xe đạp cũ",
    description: "Còn tốt",
    price: "500000",
    condition: PostCondition.USED,
    status: PostStatus.ACTIVE,
    location: null,
    ...overrides,
  });
  return repo.save(post);
}

/** Xóa toàn bộ dữ liệu chat/user/post do fixture tạo (theo thứ tự FK). */
export async function cleanFixtures(ds: DataSource): Promise<void> {
  const schema = ownedTestSchema(ds);
  await ds.query(
    `TRUNCATE TABLE "${schema}"."user", "${schema}".categories CASCADE`,
  );
}

export async function createTestCategory(
  ds: DataSource,
): Promise<CategoryEntity> {
  return ds
    .getRepository(CategoryEntity)
    .save({ id: uuidv7(), name: `Test ${uuidv7()}`, parentId: null });
}
