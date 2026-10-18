import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { QueryFailedError, Repository } from "typeorm";
import { StorageService } from "../storage/storage.service";
import { resolveAvatar } from "../storage/avatar-response";
import { UpdateAvatarDto } from "./dto/update-avatar.dto";
import { UserEntity } from "./user.entity";
import { RegisterUserDto } from "../auth/dto/register.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { hashSync } from "bcryptjs";
import { UpdateLocationDto } from "./dto/update-location.dto";
import { AuthorizationService } from "../authorization/authorization.service";
import type {
  AuthenticatedContext,
  AuthorizationContext,
} from "../authorization/authorization.types";
import { toUserProjection } from "../authorization/subject-projections";

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity)
    private userRepository: Repository<UserEntity>,
    private readonly authorization: AuthorizationService,
    private readonly storage: StorageService,
  ) {}

  findOneByEmail(email: string) {
    return this.userRepository.findOne({
      where: {
        email: email,
      },
    });
  }

  findOneById(userId: string) {
    return this.userRepository.findOneByOrFail({ id: userId });
  }

  async updatePassword(context: AuthenticatedContext, password: string) {
    const user = await this.findOneById(context.principal.id);
    this.authorization.assertResource(context, "changePassword", "User", {
      id: user.id,
      deletedAt: user.deletedAt,
      isLocked: user.isLocked,
    });
    await this.userRepository.save({ ...user, password });
  }

  async updateDefaultLocation(
    context: AuthenticatedContext,
    dto: UpdateLocationDto,
  ) {
    const command = this.authorization.effectivePatch({ ...dto });
    if (
      Object.keys(command).some(
        (field) => field !== "latitude" && field !== "longitude",
      )
    ) {
      throw new BadRequestException("Unknown location field");
    }
    const target = await this.userRepository.findOne({
      where: { id: context.principal.id },
      select: { id: true, isLocked: true, deletedAt: true },
    });
    if (!target || target.deletedAt) {
      throw new NotFoundException("User not found");
    }
    this.authorization.assertResource(
      context,
      "updateLocation",
      "User",
      toUserProjection({
        id: target.id,
        deletedAt: target.deletedAt,
        isLocked: target.isLocked,
      }) as unknown as Record<string, unknown>,
    );
    await this.userRepository
      .createQueryBuilder()
      .update(UserEntity)
      .set({
        location: () =>
          "ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)::geography",
      })
      .where("id = :userId", { userId: context.principal.id })
      .setParameters({ latitude: dto.latitude, longitude: dto.longitude })
      .execute();

    return dto;
  }

  async getMyProfile(context: AuthenticatedContext) {
    const user = await this.userRepository.findOne({
      where: { id: context.principal.id },
    });
    if (!user || user.deletedAt) {
      throw new NotFoundException("User not found");
    }
    this.authorization.assertResource(
      context,
      "read",
      "User",
      toUserProjection({
        id: user.id,
        deletedAt: user.deletedAt,
        isLocked: user.isLocked,
      }) as unknown as Record<string, unknown>,
    );
    return {
      ...(await this.toProfile(user)),
      isAdmin: user.isAdmin,
      hasLocation: !!user.location,
      location: user.location
        ? {
            latitude: user.location.coordinates[1],
            longitude: user.location.coordinates[0],
          }
        : null,
    };
  }

  async getUserProfile(userId: string, context: AuthorizationContext) {
    const loaded = await this.userRepository.findOne({
      where: { id: userId },
      withDeleted: true,
    });
    if (!loaded || loaded.deletedAt) {
      throw new NotFoundException("User not found");
    }
    this.authorization.assertResource(
      context,
      "read",
      "User",
      toUserProjection({
        id: loaded.id,
        deletedAt: loaded.deletedAt,
        isLocked: loaded.isLocked,
      }) as unknown as Record<string, unknown>,
    );
    return this.toProfile(loaded);
  }

  async updateMyProfile(dto: UpdateUserDto, context: AuthenticatedContext) {
    const user = await this.userRepository.findOne({
      where: { id: context.principal.id },
      select: { id: true, isLocked: true, deletedAt: true },
    });
    if (!user || user.deletedAt) {
      throw new NotFoundException("User not found");
    }
    const projection = toUserProjection({
      id: user.id,
      deletedAt: user.deletedAt,
      isLocked: user.isLocked,
    }) as unknown as Record<string, unknown>;
    const patch: Record<string, unknown> = { ...dto };
    this.authorization.assertUpdateFields(
      context,
      "update",
      "User",
      projection,
      patch,
    );
    const full = await this.userRepository.findOneByOrFail({
      id: context.principal.id,
    });
    const effective = this.authorization.effectivePatch(patch);
    if (Object.prototype.hasOwnProperty.call(effective, "avatarUrl")) {
      effective.avatarStorageKey = null;
    }
    if (Object.keys(effective).length)
      await this.userRepository.update(full.id, effective);
    return this.toProfile(
      await this.userRepository.findOneByOrFail({ id: full.id }),
    );
  }

  async updateAvatar(dto: UpdateAvatarDto, context: AuthenticatedContext) {
    if (Object.keys(dto).some((field) => field !== "key")) {
      throw new BadRequestException("Unknown avatar field");
    }
    return this.userRepository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(UserEntity);
      const user = await repository.findOne({
        where: { id: context.principal.id },
        lock: { mode: "pessimistic_write" },
      });
      if (!user || user.deletedAt)
        throw new NotFoundException("User not found");
      if (user.isLocked) throw new ForbiddenException("Account is locked");
      this.authorization.assertUpdateFields(
        context,
        "update",
        "User",
        toUserProjection(user) as unknown as Record<string, unknown>,
        { avatarUrl: dto.key },
      );
      await this.storage.verifyAvatarImage(dto.key, user.id);
      const avatar = await resolveAvatar(this.storage, {
        id: user.id,
        avatarStorageKey: dto.key,
      });
      await repository.update(user.id, {
        avatarStorageKey: dto.key,
        avatarUrl: null,
      });
      return this.toProfile(user, avatar);
    });
  }

  private async toProfile(
    user: UserEntity,
    avatar?: Awaited<ReturnType<typeof resolveAvatar>>,
  ) {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      university: user.university,
      phone: user.phone,
      ...(avatar ?? (await resolveAvatar(this.storage, user))),
      createdAt: user.createdAt,
    };
  }

  async registerUser(data: RegisterUserDto) {
    const user = this.userRepository.create({
      email: data.email,
      password: hashSync(data.password, 10),
      fullName: data.fullName,
      university: data.university ?? null,
      phone: data.phone,
    });

    try {
      return await this.userRepository.save(user);
    } catch (error) {
      if (error instanceof QueryFailedError) {
        const driverError = error.driverError as Error & {
          code?: string;
          constraint?: string;
        };
        if (
          driverError.code === "23505" &&
          driverError.constraint === "idx_user_email_active"
        ) {
          throw new ConflictException("Email already exists");
        }
      }
      throw error;
    }
  }
}
