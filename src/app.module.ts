import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule, TypeOrmModuleOptions } from "@nestjs/typeorm";
import { AppController } from "./app.controller";
import { validateEnvironment } from "./config/environment.validation";
import { DatabaseService } from "./database.service";
import { TemporaryModule } from "./database/temporary.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
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
