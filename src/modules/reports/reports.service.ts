import {
  BadRequestException,
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
  ) {}

  // ── Tạo report ──────────────────────────────────────────────────────────────

  async createReport(dto: CreateReportDto, reporterId: string) {
    const { targetType, targetId, reason, description, evidenceUrls } = dto;

    // Kiểm tra target tồn tại
    if (targetType === ReportTargetType.POST) {
      const post = await this.postsRepository.findOneBy({ id: targetId });
      if (!post) throw new NotFoundException("Post not found");

      // Chặn report bài mình
      if (post.sellerId === reporterId) {
        throw new BadRequestException("You cannot report your own post");
      }
    } else {
      const user = await this.usersRepository.findOneBy({ id: targetId });
      if (!user) throw new NotFoundException("User not found");

      // Chặn tự report
      if (targetId === reporterId) {
        throw new BadRequestException("You cannot report yourself");
      }
    }

    // Chặn duplicate pending report
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

  // ── Admin: xử lý report ─────────────────────────────────────────────────────

  async handleAction(reportId: string, dto: HandleReportDto, adminId: string) {
    const { action, adminNote } = dto;

    return this.dataSource.transaction(async (manager) => {
      const report = await manager.findOne(ReportEntity, {
        where: { id: reportId },
      });
      if (!report) throw new NotFoundException("Report not found");

      if (report.status !== ReportStatus.PENDING) {
        throw new BadRequestException("Báo cáo này đã được xử lý trước đó");
      }

      const resolvedMeta = {
        resolvedById: adminId,
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

        const post = await manager.findOne(PostEntity, {
          where: { id: report.targetId },
        });
        if (!post) throw new NotFoundException("Target post not found");

        // Ẩn post
        await manager.update(PostEntity, post.id, {
          status: PostStatus.HIDDEN,
        });

        // Resolve toàn bộ pending reports cùng post
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

        const user = await manager.findOne(UserEntity, {
          where: { id: report.targetId },
        });
        if (!user) throw new NotFoundException("Target user not found");

        // Ban user
        await manager.update(UserEntity, user.id, { isLocked: true });

        // Resolve toàn bộ pending reports cùng user
        await manager.update(
          ReportEntity,
          {
            targetType: ReportTargetType.USER,
            targetId: user.id,
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
  }

  // ── Admin: danh sách reports ─────────────────────────────────────────────────

  async findAllForAdmin(query: FilterReportDto) {
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

  // ── Admin: chi tiết report ───────────────────────────────────────────────────

  async findOneForAdmin(id: string) {
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

    // Fetch target object
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
      target = user as unknown as Record<string, unknown>;
    }

    return { ...report, target };
  }
}
