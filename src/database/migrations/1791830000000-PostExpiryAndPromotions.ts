import { MigrationInterface, QueryRunner, Table, TableColumn } from "typeorm";

/**
 * Phase 4 Step 2 — Post Expiration + Post Promotion data sources.
 *
 * Expiration: nullable `posts.expires_at`. NO backfill — existing rows stay
 * NULL and NULL means "still valid" (a backfill policy has not been agreed).
 * New posts get expires_at from POST_EXPIRATION_DAYS (see
 * src/config/post-expiration.config.ts).
 *
 * Promotion: `post_promotions` keeps full campaign history (Option B).
 * Status is derived from timestamps, never stored. Eligibility for listing:
 *   post.expires_at IS NULL OR post.expires_at > now().
 */
export class PostExpiryAndPromotions1791830000000
  implements MigrationInterface
{
  name = "PostExpiryAndPromotions1791830000000";

  private schema(queryRunner: QueryRunner): string {
    const schema =
      (queryRunner.connection.options as { schema?: string }).schema ??
      "public";
    if (!/^[a-z][a-z0-9_]*$/.test(schema)) {
      throw new Error("Invalid POSTGRES_SCHEMA");
    }
    return schema;
  }

  async up(queryRunner: QueryRunner): Promise<void> {
    const schema = this.schema(queryRunner);
    await queryRunner.addColumn(
      `${schema}.posts`,
      new TableColumn({
        name: "expires_at",
        type: "timestamptz",
        isNullable: true,
      }),
    );
    await queryRunner.createTable(this.postPromotionsTable(schema), true);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const schema = this.schema(queryRunner);
    // Never destroy ranking source data on rollback.
    const promotionRows = (await queryRunner.query(
      `SELECT 1 FROM "${schema}"."post_promotions" LIMIT 1`,
    )) as unknown[];
    if (promotionRows.length) {
      throw new Error("Cannot downgrade while post_promotions contains data");
    }
    const expiryRows = (await queryRunner.query(
      `SELECT 1 FROM "${schema}"."posts" WHERE "expires_at" IS NOT NULL LIMIT 1`,
    )) as unknown[];
    if (expiryRows.length) {
      throw new Error(
        "Cannot downgrade while posts.expires_at contains non-null values",
      );
    }
    if (await queryRunner.hasTable(`${schema}.post_promotions`)) {
      await queryRunner.dropTable(`${schema}.post_promotions`);
    }
    const postsColumns = (await queryRunner.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'posts' AND column_name = 'expires_at'`,
      [schema],
    )) as unknown[];
    if (postsColumns.length) {
      await queryRunner.query(
        `ALTER TABLE "${schema}"."posts" DROP COLUMN "expires_at"`,
      );
    }
  }

  private postPromotionsTable(schema: string): Table {
    return new Table({
      name: `${schema}.post_promotions`,
      columns: [
        { name: "id", type: "uuid", isPrimary: true },
        { name: "post_id", type: "uuid" },
        { name: "starts_at", type: "timestamptz" },
        { name: "ends_at", type: "timestamptz" },
        { name: "created_by_id", type: "uuid" },
        { name: "cancelled_at", type: "timestamptz", isNullable: true },
        { name: "cancelled_by_id", type: "uuid", isNullable: true },
        {
          name: "created_at",
          type: "timestamptz",
          default: "CURRENT_TIMESTAMP",
        },
      ],
      checks: [
        {
          name: "chk_post_promotions_window",
          expression: `"ends_at" > "starts_at"`,
        },
        {
          name: "chk_post_promotions_cancel",
          expression: `("cancelled_at" IS NULL AND "cancelled_by_id" IS NULL) OR ("cancelled_at" IS NOT NULL AND "cancelled_by_id" IS NOT NULL)`,
        },
      ],
      indices: [
        {
          name: "idx_post_promotions_post_id",
          columnNames: ["post_id"],
        },
      ],
      foreignKeys: [
        {
          name: "fk_post_promotions_post",
          columnNames: ["post_id"],
          referencedTableName: `${schema}.posts`,
          referencedColumnNames: ["id"],
          onDelete: "RESTRICT",
        },
        {
          name: "fk_post_promotions_created_by",
          columnNames: ["created_by_id"],
          referencedTableName: `${schema}.user`,
          referencedColumnNames: ["id"],
          onDelete: "RESTRICT",
        },
        {
          name: "fk_post_promotions_cancelled_by",
          columnNames: ["cancelled_by_id"],
          referencedTableName: `${schema}.user`,
          referencedColumnNames: ["id"],
          onDelete: "RESTRICT",
        },
      ],
    });
  }
}

