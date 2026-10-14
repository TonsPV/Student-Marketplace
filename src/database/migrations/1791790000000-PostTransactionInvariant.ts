import { MigrationInterface, QueryRunner } from "typeorm";

export class PostTransactionInvariant1791790000000 implements MigrationInterface {
  name = "PostTransactionInvariant1791790000000";

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
    const invalidRows = (await queryRunner.query(
      `SELECT id, status, buyer_id, sold_at
         FROM "${schema}"."posts"
        WHERE
          ("buyer_id" IS NOT NULL AND "buyer_id" = "seller_id")
          OR
          ("status" = 'sold' AND "sold_at" IS NULL)
          OR ("status" = 'active'
              AND ("buyer_id" IS NOT NULL OR "sold_at" IS NOT NULL))
          OR ("status" = 'hidden'
              AND "sold_at" IS NULL AND "buyer_id" IS NOT NULL)`,
    )) as Array<{
      id: string;
      status: string;
      buyer_id: string | null;
      sold_at: Date | null;
    }>;

    if (invalidRows.length > 0) {
      const detail = invalidRows
        .map(
          (row) =>
            `id=${row.id} status=${row.status} ` +
            `buyer_id=${row.buyer_id ?? "NULL"} ` +
            `sold_at=${row.sold_at?.toISOString() ?? "NULL"}`,
        )
        .join(", ");
      throw new Error(
        "Cannot enforce post transaction invariant; invalid rows found: " +
          detail,
      );
    }

    await queryRunner.query(
      `ALTER TABLE "${schema}"."posts"
         ADD CONSTRAINT chk_posts_transaction_state
         CHECK (
           ("buyer_id" IS NULL OR "buyer_id" <> "seller_id")
           AND
           (
             ("status" = 'sold' AND "sold_at" IS NOT NULL)
             OR
             ("status" = 'active'
              AND "buyer_id" IS NULL
              AND "sold_at" IS NULL)
             OR
             ("status" = 'hidden'
              AND ("sold_at" IS NOT NULL OR "buyer_id" IS NULL))
           )
         )`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const schema = this.schema(queryRunner);
    await queryRunner.query(
      `ALTER TABLE "${schema}"."posts"
         DROP CONSTRAINT IF EXISTS chk_posts_transaction_state`,
    );
  }
}
