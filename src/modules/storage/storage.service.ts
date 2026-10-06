import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigType } from "@nestjs/config";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { uuidv7 } from "uuidv7";
import { r2Config, uploadConfig } from "../../config/r2.config";
import {
  CONTENT_TYPE_TO_EXTENSION,
  MESSAGE_IMAGE_CONTENT_TYPES,
  MESSAGE_IMAGE_KEY_REGEX,
  MessageImageContentType,
} from "./storage.constants";

export type HeadObjectResult = {
  contentLength: number;
  contentType: string | undefined;
} | null;

export type PresignedGetResult = {
  url: string;
  expiresAt: string;
};

@Injectable()
export class StorageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StorageService.name);
  private client!: S3Client;

  constructor(
    @Inject(r2Config.KEY)
    private readonly r2: ConfigType<typeof r2Config>,
    @Inject(uploadConfig.KEY)
    private readonly upload: ConfigType<typeof uploadConfig>,
  ) {}

  onModuleInit(): void {
    // Startup validation: config factories đã throw khi env sai;
    // ở đây kiểm chứng client khởi tạo được với endpoint/credentials đó.
    try {
      this.client = new S3Client({
        region: "auto",
        endpoint: this.r2.endpointUrl,
        credentials: {
          accessKeyId: this.r2.accessKeyId,
          secretAccessKey: this.r2.secretAccessKey,
        },
        forcePathStyle: false,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown S3 client error";
      throw new InternalServerErrorException(
        `Invalid R2 configuration: ${message}`,
      );
    }
  }

  onModuleDestroy(): void {
    this.client?.destroy();
  }

  // ── Key helpers (thuần, dùng được trong unit test) ────────────────────────

  /** true khi key đúng định dạng messages/<uuid>/<uuid>.<ext>. */
  static isMessageImageKey(key: unknown): boolean {
    return typeof key === "string" && MESSAGE_IMAGE_KEY_REGEX.test(key);
  }

  /**
   * true khi key đúng format và segment owner trùng userId (normalize
   * lowercase cả hai, cùng cách JWT userId được so sánh).
   */
  static isMessageImageKeyOwnedBy(key: unknown, userId: string): boolean {
    if (!StorageService.isMessageImageKey(key)) return false;
    const owner = (key as string).split("/")[1]?.toLowerCase();
    return owner === userId.toLowerCase();
  }

  static extensionForContentType(contentType: string): string | null {
    if (
      (MESSAGE_IMAGE_CONTENT_TYPES as readonly string[]).includes(contentType)
    ) {
      return CONTENT_TYPE_TO_EXTENSION[contentType as MessageImageContentType];
    }
    return null;
  }

  // ── Presign PUT (FE upload trực tiếp) ─────────────────────────────────────

  async presignPut(
    userId: string,
    purpose: string,
    contentType: string,
    size: number,
  ): Promise<{ uploadUrl: string; key: string; expiresIn: number }> {
    if (purpose !== "message") {
      throw new BadRequestException(
        "Unsupported upload purpose (phase 1 supports only 'message')",
      );
    }
    const ext = StorageService.extensionForContentType(contentType);
    if (!ext) {
      throw new BadRequestException("Unsupported content type");
    }
    if (!Number.isInteger(size) || size < 1) {
      throw new BadRequestException("Size must be a positive integer");
    }
    if (size > this.upload.maxFileSizeBytes) {
      throw new BadRequestException(
        `File size exceeds the limit of ${this.upload.maxFileSizeBytes} bytes`,
      );
    }

    const key = `messages/${userId}/${uuidv7()}.${ext}`;
    const command = new PutObjectCommand({
      Bucket: this.r2.bucketName,
      Key: key,
      ContentType: contentType,
      ContentLength: size,
    });
    let uploadUrl: string;
    try {
      uploadUrl = await getSignedUrl(this.client, command, {
        expiresIn: this.upload.putSignedUrlExpiresSec,
      });
    } catch (err) {
      this.logger.error(
        `presignPut failed: ${err instanceof Error ? err.message : err}`,
      );
      throw new InternalServerErrorException("Failed to create upload URL");
    }
    return {
      uploadUrl,
      key,
      expiresIn: this.upload.putSignedUrlExpiresSec,
    };
  }

  // ── HEAD (kiểm chứng object thật trước khi gắn vào message) ───────────────

  /**
   * Trả metadata khi object tồn tại; null khi chắc chắn không tồn tại
   * (NotFound/NoSuchKey/HTTP 404). 403/5xx/network error được throw
   * để caller phân biệt — không biến thành null (spec §10.3).
   */
  async headObject(key: string): Promise<HeadObjectResult> {
    let output;
    try {
      output = await this.client.send(
        new HeadObjectCommand({ Bucket: this.r2.bucketName, Key: key }),
      );
    } catch (err) {
      if (StorageService.isNotFoundError(err)) return null;
      const message = err instanceof Error ? err.message : "Unknown R2 error";
      this.logger.error(`headObject(${key}) failed: ${message}`);
      throw new InternalServerErrorException(
        "Failed to verify uploaded object",
      );
    }
    return {
      contentLength: output.ContentLength ?? 0,
      contentType: output.ContentType,
    };
  }

  private static isNotFoundError(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;
    const record = err as Record<string, unknown>;
    const name = record.name;
    const code = record.Code ?? record.code;
    const status = record.$metadata as { httpStatusCode?: number } | undefined;
    return (
      name === "NotFound" ||
      name === "NoSuchKey" ||
      code === "NotFound" ||
      code === "NoSuchKey" ||
      status?.httpStatusCode === 404
    );
  }

  // ── Presign GET private (server ký sau authorization) ─────────────────────

  /**
   * Signing không gọi R2 network nhưng vẫn async và có thể throw;
   * caller chuẩn bị URLs trước commit (spec §5.3).
   */
  async presignGet(key: string): Promise<PresignedGetResult> {
    const now = Date.now();
    let url: string;
    try {
      url = await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.r2.bucketName, Key: key }),
        { expiresIn: this.upload.getSignedUrlExpiresSec },
      );
    } catch (err) {
      this.logger.error(
        `presignGet failed: ${err instanceof Error ? err.message : err}`,
      );
      throw new InternalServerErrorException("Failed to sign image URL");
    }
    return {
      url,
      expiresAt: new Date(
        now + this.upload.getSignedUrlExpiresSec * 1000,
      ).toISOString(),
    };
  }

  /**
   * Ký nhiều key song song, giữ đúng thứ tự đầu vào.
   * expiresAt chung = sớm nhất trong nhóm (spec §5.8).
   */
  async presignGetMany(keys: string[]): Promise<{
    urls: string[];
    expiresAt: string | null;
  }> {
    if (keys.length === 0) return { urls: [], expiresAt: null };
    const signed = await Promise.all(keys.map((key) => this.presignGet(key)));
    const urls = signed.map((s) => s.url);
    let earliest = signed[0].expiresAt;
    for (const s of signed) {
      if (s.expiresAt < earliest) earliest = s.expiresAt;
    }
    return { urls, expiresAt: earliest };
  }

  get maxFileSizeBytes(): number {
    return this.upload.maxFileSizeBytes;
  }
}
