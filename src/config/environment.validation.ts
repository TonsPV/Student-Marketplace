import { plainToInstance, Transform } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  validateSync,
} from "class-validator";

const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

function toNumber(value: unknown): unknown {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value !== "string" || !DECIMAL_NUMBER.test(value.trim())) {
    return value;
  }

  return Number(value);
}

class EnvironmentVariables {
  @IsIn(["development", "test"])
  NODE_ENV = "development";

  @Transform(({ value }) => toNumber(value))
  @IsInt()
  @Min(0)
  @Max(65535)
  PORT = 3000;

  @IsString()
  @IsNotEmpty()
  POSTGRES_HOST = "127.0.0.1";

  @Transform(({ value }) => toNumber(value))
  @IsInt()
  @Min(0)
  @Max(65535)
  POSTGRES_PORT = 5432;

  @IsString()
  @IsNotEmpty()
  POSTGRES_USER!: string;

  @IsString()
  @IsNotEmpty()
  POSTGRES_PASSWORD!: string;

  @IsString()
  @IsNotEmpty()
  POSTGRES_DB!: string;
}

export function validateEnvironment(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    exposeDefaultValues: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const messages = errors.flatMap((error) =>
      Object.values(error.constraints ?? {}),
    );

    throw new Error(`Environment validation failed: ${messages.join("; ")}`);
  }

  return { ...config, ...validatedConfig };
}
