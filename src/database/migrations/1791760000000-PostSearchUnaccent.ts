import { MigrationInterface, QueryRunner } from "typeorm";

const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

export class PostSearchUnaccent1791760000000 implements MigrationInterface {
  name = "PostSearchUnaccent1791760000000";

  private schema(queryRunner: QueryRunner): string {
    const schema =
      (queryRunner.connection.options as { schema?: string }).schema ??
      "public";
    if (!/^[a-z][a-z0-9_]*$/.test(schema))
      throw new Error("Invalid POSTGRES_SCHEMA");
    return quoteIdentifier(schema);
  }

  async up(queryRunner: QueryRunner): Promise<void> {
    const schema = this.schema(queryRunner);
    // Extensions are shared by the database; keep them outside application/test schemas.
    await queryRunner.query(
      "CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public",
    );
    await queryRunner.query(
      "CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public",
    );
    const extensions: { extname: string; schema: string }[] =
      await queryRunner.query(
        `SELECT e.extname, n.nspname AS schema FROM pg_extension e
       JOIN pg_namespace n ON n.oid = e.extnamespace
       WHERE e.extname IN ('unaccent', 'pg_trgm')`,
      );
    const extensionSchema = (name: string) => {
      const extension = extensions.find((row) => row.extname === name);
      if (!extension) throw new Error(`Missing ${name} extension`);
      return quoteIdentifier(extension.schema);
    };
    const unaccent = extensionSchema("unaccent");
    const dictionary = `${unaccent}."unaccent"`.replace(/'/g, "''");
    // IMMUTABLE assumes the explicitly selected dictionary rules remain unchanged.
    // Rebuild both indexes if those rules or this function's behavior ever change.
    await queryRunner.query(`
      CREATE FUNCTION ${schema}.post_search_unaccent(text) RETURNS text
      LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
      SET search_path = pg_catalog
      AS $function$
        SELECT ${unaccent}.unaccent('${dictionary}'::regdictionary, $1)
      $function$
    `);
    for (const column of ["title", "description"]) {
      await queryRunner.query(`
        CREATE INDEX "idx_posts_${column}_unaccent_trgm" ON ${schema}."posts"
        USING gin (${schema}.post_search_unaccent("${column}") ${extensionSchema("pg_trgm")}.gin_trgm_ops)
        WHERE status = 'active' AND deleted_at IS NULL
      `);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const schema = this.schema(queryRunner);
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_posts_description_unaccent_trgm"`,
    );
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_posts_title_unaccent_trgm"`,
    );
    await queryRunner.query(
      `DROP FUNCTION ${schema}.post_search_unaccent(text)`,
    );
    // Do not remove shared extensions or any post data.
  }
}
