import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, QueryFailedError, Repository } from "typeorm";
import { CategoryEntity } from "./category.entity";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { UpdateCategoryDto } from "./dto/update-category.dto";
import { AuthorizationService } from "../authorization/authorization.service";
import type {
  AuthenticatedContext,
  AuthorizationContext,
} from "../authorization/authorization.types";

@Injectable()
export class CategoryService {
  constructor(
    @InjectRepository(CategoryEntity)
    private readonly categories: Repository<CategoryEntity>,
    private readonly authorization: AuthorizationService,
  ) {}

  async findAll(context: AuthorizationContext) {
    {
      this.authorization.assertRoute(context, "read", "Category");
    }
    return this.categories.find({ order: { name: "ASC", id: "ASC" } });
  }

  async findOne(id: string, context: AuthorizationContext) {
    const category = await this.categories.findOneBy({ id: id.toLowerCase() });
    if (!category) throw new NotFoundException("Category not found");
    {
      this.authorization.assertResource(context, "read", "Category", {
        id: category.id,
      });
    }
    return category;
  }

  private async mutate<T>(
    action: (repository: Repository<CategoryEntity>) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.categories.manager.transaction(
        "READ COMMITTED",
        async (manager: EntityManager) => {
          await manager.query("SELECT pg_advisory_xact_lock(1937006964, 1)");
          return action(manager.getRepository(CategoryEntity));
        },
      );
    } catch (error) {
      if (error instanceof QueryFailedError) {
        const { code } = error.driverError as { code?: string };
        if (code === "23505")
          throw new ConflictException(
            "Category name already exists under this parent",
          );
        if (code === "23503" || code === "23001")
          throw new ConflictException(
            "Category is in use or its parent no longer exists",
          );
      }
      throw error;
    }
  }

  private async validateParent(
    repository: Repository<CategoryEntity>,
    parentId: string | null,
    id?: string,
  ) {
    const visited = new Set<string>();
    let currentId = parentId?.toLowerCase() ?? null;
    while (currentId !== null) {
      if (currentId === id?.toLowerCase() || visited.has(currentId))
        throw new BadRequestException(
          "Category hierarchy cannot contain a cycle",
        );
      visited.add(currentId);
      const parent = await repository.findOneBy({ id: currentId });
      if (!parent) throw new NotFoundException("Parent category not found");
      currentId = parent.parentId;
    }
  }

  create(dto: CreateCategoryDto, context: AuthenticatedContext) {
    this.authorization.assertCreate(context, "Category", {});
    return this.mutate(async (repository) => {
      const parentId = dto.parentId?.toLowerCase() ?? null;
      await this.validateParent(repository, parentId);
      return repository.save(
        repository.create({ name: dto.name.trim(), parentId }),
      );
    });
  }

  update(id: string, dto: UpdateCategoryDto, context: AuthenticatedContext) {
    return this.mutate(async (repository) => {
      const category = await repository.findOneBy({ id: id.toLowerCase() });
      if (!category) throw new NotFoundException("Category not found");
      const patch: Record<string, unknown> = { ...dto };
      this.authorization.assertUpdateFields(
        context,
        "update",
        "Category",
        { id: category.id },
        patch,
      );
      if (dto.parentId !== undefined) {
        await this.validateParent(repository, dto.parentId, id);
        category.parentId = dto.parentId?.toLowerCase() ?? null;
      }
      if (dto.name !== undefined) category.name = dto.name.trim();
      return repository.save(category);
    });
  }

  remove(id: string, context: AuthenticatedContext) {
    return this.mutate(async (repository) => {
      const category = await repository.findOneBy({ id: id.toLowerCase() });
      if (!category) throw new NotFoundException("Category not found");
      this.authorization.assertResource(context, "delete", "Category", {
        id: category.id,
      });
      if (await repository.existsBy({ parentId: id.toLowerCase() }))
        throw new ConflictException("Delete child categories first");
      await repository.delete(id.toLowerCase());
      return { id };
    });
  }
}
