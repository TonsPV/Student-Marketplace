import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { UserEntity } from "../../modules/user/user.entity";
import { RefreshTokenEntity } from "../../modules/refresh-token/refresh-token.entity";
import { AuthorizationService } from "../../modules/authorization/authorization.service";
import type { AuthenticatedContext } from "../../modules/authorization/authorization.types";
import { toUserProjection } from "../../modules/authorization/subject-projections";
import { SessionRegistryService } from "../session-registry/session-registry.service";

export interface AccountMutationOutcome {
  targetId: string;
  locked: boolean;
}

@Injectable()
export class AccountLifecycleService {
  private readonly logger = new Logger(AccountLifecycleService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly authorization: AuthorizationService,
    private readonly sessions: SessionRegistryService,
  ) {}

  async lockWithManager(
    manager: EntityManager,
    context: AuthenticatedContext,
    targetId: string,
  ): Promise<AccountMutationOutcome> {
    const normalized = targetId.toLowerCase();
    const target = await manager
      .getRepository(UserEntity)
      .createQueryBuilder("u")
      .setLock("pessimistic_write")
      .where("u.id = :id", { id: normalized })
      .getOne();
    if (!target || target.deletedAt) {
      throw new NotFoundException("User not found");
    }
    this.authorization.assertResource(
      context,
      "lock",
      "User",
      toUserProjection({
        id: target.id,
        deletedAt: target.deletedAt,
        isLocked: target.isLocked,
      }) as unknown as Record<string, unknown>,
    );
    if (target.id.toLowerCase() === context.principal.id.toLowerCase()) {
      throw new ForbiddenException("Admin cannot lock or unlock own account");
    }
    await manager.update(UserEntity, target.id, { isLocked: true });
    await manager.update(
      RefreshTokenEntity,
      { user: { id: target.id } as UserEntity, isRevoked: false },
      { isRevoked: true },
    );
    return { targetId: target.id, locked: true };
  }

  async unlockWithManager(
    manager: EntityManager,
    context: AuthenticatedContext,
    targetId: string,
  ): Promise<AccountMutationOutcome> {
    const normalized = targetId.toLowerCase();
    const target = await manager
      .getRepository(UserEntity)
      .createQueryBuilder("u")
      .setLock("pessimistic_write")
      .where("u.id = :id", { id: normalized })
      .getOne();
    if (!target || target.deletedAt) {
      throw new NotFoundException("User not found");
    }
    this.authorization.assertResource(
      context,
      "unlock",
      "User",
      toUserProjection({
        id: target.id,
        deletedAt: target.deletedAt,
        isLocked: target.isLocked,
      }) as unknown as Record<string, unknown>,
    );
    if (target.id.toLowerCase() === context.principal.id.toLowerCase()) {
      throw new ForbiddenException("Admin cannot lock or unlock own account");
    }
    await manager.update(UserEntity, target.id, { isLocked: false });
    return { targetId: target.id, locked: false };
  }

  async lockAccount(
    context: AuthenticatedContext,
    targetId: string,
  ): Promise<boolean> {
    const outcome = await this.dataSource.transaction(async (manager) => {
      const result = await this.lockWithManager(manager, context, targetId);
      return result;
    });
    this.invalidateCommittedAccount(outcome.targetId, "lock");
    return outcome.locked;
  }

  async unlockAccount(
    context: AuthenticatedContext,
    targetId: string,
  ): Promise<boolean> {
    const outcome = await this.dataSource.transaction(async (manager) => {
      return this.unlockWithManager(manager, context, targetId);
    });
    return outcome.locked;
  }

  async deleteOwnAccount(context: AuthenticatedContext): Promise<void> {
    const targetId = await this.dataSource.transaction(async (manager) => {
      const target = await manager
        .getRepository(UserEntity)
        .createQueryBuilder("u")
        .setLock("pessimistic_write")
        .where("u.id = :id", { id: context.principal.id.toLowerCase() })
        .getOne();
      if (!target || target.deletedAt) {
        throw new NotFoundException("User not found");
      }
      this.authorization.assertResource(
        context,
        "delete",
        "User",
        toUserProjection({
          id: target.id,
          deletedAt: target.deletedAt,
          isLocked: target.isLocked,
        }) as unknown as Record<string, unknown>,
      );
      await manager.update(
        RefreshTokenEntity,
        { user: { id: target.id } as UserEntity, isRevoked: false },
        { isRevoked: true },
      );
      await manager.softDelete(UserEntity, target.id);
      return target.id;
    });
    this.invalidateCommittedAccount(targetId, "delete");
  }

  invalidateCommittedAccount(targetId: string, reason: string): void {
    try {
      this.sessions.invalidateUser(targetId);
    } catch (err) {
      this.logger.error(
        `invalidateCommittedAccount failed committed=true user=${targetId} reason=${reason}: ${err instanceof Error ? err.message : err}`,
      );
      throw err;
    }
  }
}
