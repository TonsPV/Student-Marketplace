import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule, TypeOrmModuleOptions } from "@nestjs/typeorm";
import * as Joi from "joi";
import { AppController } from "./app.controller";
import { DatabaseService } from "./database.service";
import { TemporaryModule } from "./database/temporary.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid("development", "test")
          .default("development"),
        PORT: Joi.number().port().default(3000),
        POSTGRES_HOST: Joi.string().min(1).default("127.0.0.1"),
        POSTGRES_PORT: Joi.number().port().default(5432),
        POSTGRES_USER: Joi.string().min(1).required(),
        POSTGRES_PASSWORD: Joi.string().min(1).required(),
        POSTGRES_DB: Joi.string().min(1).required(),
      }),
      validationOptions: {
        abortEarly: false,
        allowUnknown: true,
      },
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): TypeOrmModuleOptions => ({
        type: "postgres",
        host: config.getOrThrow<string>("POSTGRES_HOST"),
        port: config.getOrThrow<number>("POSTGRES_PORT"),
        username: config.getOrThrow<string>("POSTGRES_USER"),
        password: config.getOrThrow<string>("POSTGRES_PASSWORD"),
        database: config.getOrThrow<string>("POSTGRES_DB"),
        autoLoadEntities: true,
        // Local development only; migration strategy will be decided later.
        synchronize: true,
      }),
    }),
    TemporaryModule,
  ],
  controllers: [AppController, HealthController],
  providers: [DatabaseService],
})
export class AppModule {}
