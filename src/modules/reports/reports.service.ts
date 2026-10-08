import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";

import { PostEntity, PostStatus } from "../posts/post.entity";
import { UserEntity } from "../user/user.entity";
import { CreateReportDto } from "./dto/create-report.dto";
import { FilterReportDto } from "./dto/filter-report.dto";
import { HandleReportAction, HandleReportDto } from "./dto/handle-report.dto";
import { ReportEntity, ReportStatus, ReportTargetType } from "./report.entity";
import { AuthorizationService } from "../authorization/authorization.service";
import type { AuthenticatedContext } from "../authorization/authorization.types";
import {
  toPostProjection,
  toReportProjection,
  toUserProjection,
} from "../authorization/subject-projections";
import { AccountLifecycleService } from "../../common/account-lifecycle/account-lifecycle.service";

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(ReportEntity)
    private readonly reportsRepository: Repository<ReportEntity>,
    @InjectRepository(PostEntity)
    private readonly postsRepository: Repository<PostEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    private readonly dataSource: DataSource,
    private readonly authorization: AuthorizationService,
    private readonly accountLifecycle: AccountLifecycleService,
  ) {}

  async createReport(dto: CreateReportDto, context: AuthenticatedContext) {
    this.authorization.assertCreate(context, "Report", {
      reporterId: context.principal.id,
      targetType: dto.targetType,
      targetId: dto.targetId,
      status: ReportStatus.PENDING,
    });
    const reporterId = context.principal.id;
    const { targetType, targetId, reason, description, evidenceUrls } = dto;

    if (targetType === ReportTargetType.POST) {
      const post = await this.postsRepository.findOneBy({ id: targetId });
      if (!post) throw new NotFoundException("Post not found");

      if (post.sellerId === reporterId) {
        throw new BadRequestException("You cannot report your own post");
      }
    } else {
      const user = await this.usersRepository.findOneBy({ id: targetId });
      if (!user) throw new NotFoundException("User not found");

      if (targetId === reporterId) {
        throw new BadRequestException("You cannot report yourself");
      }
    }

    const existing = await this.reportsRepository.findOne({
      where: {
        reporterId,
        targetType,
        targetId,
        status: ReportStatus.PENDING,
      },
    });
    if (existing) {
      throw new BadRequestException(
        "You already have a pending report for this target",
      );
    }

    const report = this.reportsRepository.create({
      reporterId,
      targetType,
      targetId,
      reason,
      description,
      evidenceUrls: evidenceUrls ?? [],
      status: ReportStatus.PENDING,
    });

    return this.reportsRepository.save(report);
  }

  async handleAction(
    reportId: string,
    dto: HandleReportDto,
    context: AuthenticatedContext,
  ) {
    this.authorization.assertRoute(context, "resolve", "Report");
    const { action, adminNote } = dto;

    let bannedUserId: string | null = null;
    const result = await this.dataSource.transaction(async (manager) => {
      const header = await manager.findOne(ReportEntity, {
        where: { id: reportId },
      });
      if (!header) throw new NotFoundException("Report not found");

      await manager.query(
        "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
        [`report-moderation:${header.targetType}`, header.targetId],
      );

      const report = await manager
        .getRepository(ReportEntity)
        .createQueryBuilder("r")
        .setLock("pessimistic_write")
        .where("r.id = :id", { id: reportId })
        .getOne();
      if (!report) throw new NotFoundException("Report not found");
      if (
        report.targetType !== header.targetType ||
        report.targetId !== header.targetId
      ) {
        throw new BadRequestException("Report target mismatch");
      }

      this.authorization.assertResource(
        context,
        "resolve",
        "Report",
        toReportProjection({
          id: report.id,
          reporterId: report.reporterId,
          targetType: report.targetType,
          targetId: report.targetId,
          status: report.status,
        }) as unknown as Record<string, unknown>,
      );

      if (report.status !== ReportStatus.PENDING) {
        throw new BadRequestException("B�o c�o n�y d� du?c x? l� tru?c d�");
      }

      const resolvedMeta = {
        resolvedById: context.principal.id,
        resolvedAt: new Date(),
        adminNote: adminNote ?? null,
      };

      if (action === HandleReportAction.DISMISS) {
        await manager.update(ReportEntity, report.id, {
          status: ReportStatus.DISMISSED,
          ...resolvedMeta,
        });
        return manager.findOneOrFail(ReportEntity, {
          where: { id: report.id },
        });
      }

      if (action === HandleReportAction.RESOLVE_HIDE_POST) {
        if (report.targetType !== ReportTargetType.POST) {
          throw new BadRequestException(
            "RESOLVE_HIDE_POST action requires a POST report",
          );
        }

        const post = await manager
          .getRepository(PostEntity)
          .createQueryBuilder("p")
          .setLock("pessimistic_write")
          .where("p.id = :id", { id: report.targetId })
          .getOne();
        if (!post || post.deletedAt)
          throw new NotFoundException("Target post not found");

        this.authorization.assertResource(
          context,
          "hide",
          "Post",
          toPostProjection({
            id: post.id,
            sellerId: post.sellerId,
            status: post.status,
            deletedAt: post.deletedAt,
          }) as unknown as Record<string, unknown>,
        );

        await manager.update(PostEntity, post.id, {
          status: PostStatus.HIDDEN,
        });

        await manager.update(
          ReportEntity,
          {
            targetType: ReportTargetType.POST,
            targetId: post.id,
            status: ReportStatus.PENDING,
          },
          { status: ReportStatus.RESOLVED, ...resolvedMeta },
        );

        return manager.findOneOrFail(ReportEntity, {
          where: { id: report.id },
        });
      }

      if (action === HandleReportAction.RESOLVE_BAN_USER) {
        if (report.targetType !== ReportTargetType.USER) {
          throw new BadRequestException(
            "RESOLVE_BAN_USER action requires a USER report",
          );
        }
        if (
          report.targetId.toLowerCase() === context.principal.id.toLowerCase()
        ) {
          throw new ForbiddenException(
            "Admin cannot ban own account via report",
          );
        }

        const outcome = await this.accountLifecycle.lockWithManager(
          manager,
          context,
          report.targetId,
        );
        bannedUserId = outcome.targetId;

        await manager.update(
          ReportEntity,
          {
            targetType: ReportTargetType.USER,
            targetId: outcome.targetId,
            status: ReportStatus.PENDING,
          },
          { status: ReportStatus.RESOLVED, ...resolvedMeta },
        );

        return manager.findOneOrFail(ReportEntity, {
          where: { id: report.id },
        });
      }

      throw new BadRequestException("Unknown action");
    });

    if (bannedUserId) {
      this.accountLifecycle.invalidateCommittedAccount(
        bannedUserId,
        "report-ban",
      );
    }
    return result;
  }

  async findAllForAdmin(query: FilterReportDto, context: AuthenticatedContext) {
    this.authorization.assertRoute(context, "read", "Report");
    const { page, limit, status } = query;

    const [items, total] = await this.reportsRepository.findAndCount({
      where: {
        ...(status ? { status } : {}),
      },
      relations: {
        reporter: true,
      },
      select: {
        reporter: {
          id: true,
          fullName: true,
          email: true,
          avatarUrl: true,
        },
      },
      order: { createdAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOneForAdmin(id: string, context: AuthenticatedContext) {
    this.authorization.assertRoute(context, "read", "Report");
    const report = await this.reportsRepository.findOne({
      where: { id },
      relations: { reporter: true, resolvedBy: true },
      select: {
        reporter: {
          id: true,
          fullName: true,
          email: true,
          avatarUrl: true,
        },
        resolvedBy: {
          id: true,
          fullName: true,
          email: true,
        },
      },
    });

    if (!report) throw new NotFoundException("Report not found");
    this.authorization.assertResource(
      context,
      "read",
      "Report",
      toReportProjection({
        id: report.id,
        reporterId: report.reporterId,
        targetType: report.targetType,
        targetId: report.targetId,
        status: report.status,
      }) as unknown as Record<string, unknown>,
    );

    let target: Record<string, unknown> | null = null;

    if (report.targetType === ReportTargetType.POST) {
      const post = await this.postsRepository.findOne({
        where: { id: report.targetId },
        select: {
          id: true,
          title: true,
          status: true,
          price: true,
          sellerId: true,
        },
      });
      target = post as unknown as Record<string, unknown>;
    } else {
      const user = await this.usersRepository.findOne({
        where: { id: report.targetId },
        select: {
          id: true,
          fullName: true,
          email: true,
          avatarUrl: true,
          isLocked: true,
        },
      });
      void toUserProjection;
      target = user as unknown as Record<string, unknown>;
    }

    return { ...report, target };
  }
}
