import { MigrationInterface, QueryRunner } from "typeorm";

export class PostTimestampAndReviewInvariant1791780000000 implements MigrationInterface {
  name = "PostTimestampAndReviewInvariant1791780000000";

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
    const postColumns = (await queryRunner.query(
      `SELECT column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = 'posts'
          AND column_name IN ('created_at', 'updated_at')`,
      [schema],
    )) as Array<{ column_name: string; data_type: string }>;

    for (const column of postColumns) {
      if (column.data_type === "timestamp without time zone") {
        await queryRunner.query(
          `ALTER TABLE "${schema}"."posts"
             ALTER COLUMN "${column.column_name}" TYPE timestamptz
             USING "${column.column_name}" AT TIME ZONE 'UTC'`,
        );
      }
    }

    const duplicateReviews = (await queryRunner.query(
      `SELECT post_id, COUNT(*) AS count
         FROM "${schema}"."reviews"
        GROUP BY post_id
       HAVING COUNT(*) > 1`,
    )) as Array<{ post_id: string; count: string }>;
    if (duplicateReviews.length > 0) {
      const detail = duplicateReviews
        .map((row) => `post_id=${row.post_id} count=${row.count}`)
        .join(", ");
      throw new Error(
        `Cannot enforce UNIQUE(post_id) on reviews; manual deduplication required: ${detail}`,
      );
    }
    await queryRunner.query(
      `DROP INDEX IF EXISTS "${schema}"."idx_reviews_post_id_active"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "${schema}"."uq_reviews_post_id"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_reviews_post_id
         ON "${schema}"."reviews" (post_id)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const schema = this.schema(queryRunner);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "${schema}"."uq_reviews_post_id"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_reviews_post_id
         ON "${schema}"."reviews" (post_id)`,
    );

    const postColumns = (await queryRunner.query(
      `SELECT column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = 'posts'
          AND column_name IN ('created_at', 'updated_at')`,
      [schema],
    )) as Array<{ column_name: string; data_type: string }>;
    for (const column of postColumns) {
      if (column.data_type === "timestamp with time zone") {
        await queryRunner.query(
          `ALTER TABLE "${schema}"."posts"
             ALTER COLUMN "${column.column_name}" TYPE timestamp
             USING "${column.column_name}" AT TIME ZONE 'UTC'`,
        );
      }
    }
  }
}
