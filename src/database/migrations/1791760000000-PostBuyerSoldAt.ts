import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Thêm buyer_id (nullable FK → user) và sold_at (nullable timestamptz) vào posts.
 * Đồng thời thêm UNIQUE(post_id) constraint trên reviews (thay thế uq_reviews_reviewer_post)
 * và thêm soft-delete cho reviews.
 *
 * Quy tắc:
 * - buyer_id IS NULL không đồng nghĩa chưa bán; phải xem status='sold'.
 * - Buyer khác seller được enforce bằng CHECK constraint ở DB.
 * - reviewed.deleted_at cho phép soft-delete giữ dấu vết.
 * - UNIQUE(post_id) giữ dấu vết review trong toàn bộ vòng đời post.
 */
export class PostBuyerSoldAt1791760000000 implements MigrationInterface {
  name = "PostBuyerSoldAt1791760000000";

  private schema(queryRunner: QueryRunner): string {
    const schema =
      (queryRunner.connection.options as { schema?: string }).schema ??
      "public";
    if (!/^[a-z][a-z0-9_]*$/.test(schema))
      throw new Error("Invalid POSTGRES_SCHEMA");
    return schema;
  }

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = this.schema(queryRunner);

    // ── 1. posts: thêm buyer_id và sold_at ────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "${s}"."posts"
         ADD COLUMN IF NOT EXISTS "buyer_id" uuid REFERENCES "${s}"."user"(id) ON DELETE RESTRICT,
         ADD COLUMN IF NOT EXISTS "sold_at" timestamptz`,
    );

    // CHECK: buyer khác seller khi buyer_id IS NOT NULL
    await queryRunner.query(
      `DO $$ BEGIN
         IF NOT EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conname = 'chk_posts_buyer_ne_seller'
             AND conrelid = '"${s}"."posts"'::regclass
         ) THEN
           ALTER TABLE "${s}"."posts"
             ADD CONSTRAINT chk_posts_buyer_ne_seller
             CHECK (buyer_id IS NULL OR buyer_id <> seller_id);
         END IF;
       END $$`,
    );

    // Index hỗ trợ query lịch sử mua của buyer
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_posts_buyer_id
         ON "${s}"."posts" (buyer_id) WHERE buyer_id IS NOT NULL`,
    );

    // ── 2. reviews: thêm soft-delete (deleted_at) ────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "${s}"."reviews"
         ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz`,
    );

    // Kiểm tra toàn bộ dữ liệu review trước khi áp unique(post_id).
    // Không bỏ qua review đã soft-delete vì quy tắc là một review suốt vòng đời post.
    const duplicates = (await queryRunner.query(
      `SELECT post_id, COUNT(*) AS cnt
         FROM "${s}"."reviews"
        GROUP BY post_id
        HAVING COUNT(*) > 1`,
    )) as Array<{ post_id: string; cnt: string }>;

    if (duplicates.length > 0) {
      const detail = duplicates
        .map((r) => `post_id=${r.post_id} count=${r.cnt}`)
        .join(", ");
      // Không tự xóa dữ liệu — dừng migration, báo cáo để xử lý thủ công
      throw new Error(
        `Cannot apply UNIQUE(post_id) on reviews: duplicate post_id found. ` +
          `Manual deduplication required: ${detail}`,
      );
    }

    // Thay unique(reviewer_id, post_id) bằng unique(post_id).
    await queryRunner.query(
      `DROP INDEX IF EXISTS "${s}"."uq_reviews_reviewer_post"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_reviews_post_id
         ON "${s}"."reviews" (post_id)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = this.schema(queryRunner);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "${s}"."idx_reviews_post_id_active"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "${s}"."uq_reviews_post_id"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_reviews_reviewer_post
         ON "${s}"."reviews" (reviewer_id, post_id)`,
    );
    await queryRunner.query(
      `ALTER TABLE "${s}"."reviews" DROP COLUMN IF EXISTS "deleted_at"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "${s}"."idx_posts_buyer_id"`);
    await queryRunner.query(
      `ALTER TABLE "${s}"."posts"
         DROP CONSTRAINT IF EXISTS chk_posts_buyer_ne_seller`,
    );
    await queryRunner.query(
      `ALTER TABLE "${s}"."posts"
         DROP COLUMN IF EXISTS "sold_at",
         DROP COLUMN IF EXISTS "buyer_id"`,
    );
  }
}
