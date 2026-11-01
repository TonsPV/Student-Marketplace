import { DataSource } from "typeorm";
import { HttpException } from "@nestjs/common";
import { AuthorizationService } from "../../src/modules/authorization/authorization.service";
import { CaslAbilityFactory } from "../../src/modules/authorization/casl-ability.factory";
import type { AuthenticatedContext } from "../../src/modules/authorization/authorization.types";
import { CategoryEntity } from "../../src/modules/categories/category.entity";
import { PostCondition, PostEntity } from "../../src/modules/posts/post.entity";
import { PostsService } from "../../src/modules/posts/posts.service";
import { StorageService } from "../../src/modules/storage/storage.service";
import { ModerationService } from "../../src/modules/moderation/moderation.service";
import { UserEntity } from "../../src/modules/user/user.entity";
import {
  createTestDataSource,
  disposeTestDatabase,
  initializeTestDatabase,
} from "./database";
import { createReadyTestUser, createTestCategory } from "./fixtures";

export const HOUR = 3_600_000;

/**
 * Real-DB harness for posting restriction tests. Everything runs in the
 * per-process `message_test_<uuid>` schema created by createTestDataSource.
 */
export class ModerationHarness {
  readonly ds: DataSource = createTestDataSource();
  readonly authorization = new AuthorizationService(new CaslAbilityFactory());
  readonly moderation = new ModerationService(this.ds, this.authorization);
  readonly posts = new PostsService(
    this.ds.getRepository(PostEntity),
    this.ds.getRepository(CategoryEntity),
    this.authorization,
    this.ds,
    {} as StorageService,
    this.moderation,
  );
  category!: CategoryEntity;

  async init(): Promise<void> {
    await initializeTestDatabase(this.ds);
    this.category = await createTestCategory(this.ds);
  }

  async dispose(): Promise<void> {
    await disposeTestDatabase(this.ds);
  }

  newUser(isAdmin = false): Promise<UserEntity> {
    return createReadyTestUser(this.ds, { isAdmin });
  }

  ctx(user: UserEntity): AuthenticatedContext {
    return this.authorization.createAuthenticatedContext({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      isAdmin: user.isAdmin,
      hasLocation: true,
    });
  }

  postInput() {
    return {
      categoryId: this.category.id,
      title: "Sách Giải tích 1",
      description: "Sách còn mới, có ghi chú bằng bút chì.",
      price: "50000",
      condition: PostCondition.LIKE_NEW,
    };
  }

  createPost(user: UserEntity) {
    return this.posts.create(this.postInput(), this.ctx(user));
  }

  postCount(user: UserEntity): Promise<number> {
    return this.ds
      .getRepository(PostEntity)
      .count({ where: { sellerId: user.id }, withDeleted: true });
  }

  async reload(user: UserEntity): Promise<UserEntity> {
    return this.ds.getRepository(UserEntity).findOneByOrFail({ id: user.id });
  }
}

/** Resolves to the thrown error (or null), so assertions can inspect it. */
export async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

export function httpBody(error: unknown): Record<string, unknown> {
  if (!(error instanceof HttpException)) {
    throw new Error(`Expected HttpException, got ${String(error)}`);
  }
  const body = error.getResponse();
  return typeof body === "string" ? { message: body } : (body as never);
}
