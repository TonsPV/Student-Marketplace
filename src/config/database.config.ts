import type { PostgresConnectionOptions } from "typeorm/driver/postgres/PostgresConnectionOptions";

export function databaseOptions(
  env: Record<string, string | undefined> = process.env,
): PostgresConnectionOptions {
  const schema = env.POSTGRES_SCHEMA ?? "public";
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) {
    throw new Error("Invalid POSTGRES_SCHEMA");
  }
  const synchronize = env.POSTGRES_SYNCHRONIZE === "true";
  if (synchronize && !["development", "test"].includes(env.NODE_ENV ?? "")) {
    throw new Error(
      "POSTGRES_SYNCHRONIZE requires NODE_ENV=development or test",
    );
  }
  return {
    type: "postgres",
    host: env.POSTGRES_HOST,
    port: Number(env.POSTGRES_PORT ?? "5432"),
    username: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    database: env.POSTGRES_DB,
    schema,
    // Supabase installs uuid-ossp/PostGIS in the extensions schema.
    extra: { options: `-c search_path=${schema},public,extensions` },
    synchronize,
  };
}
