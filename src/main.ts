import { ValidationPipe, VersioningType } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory, Reflector } from "@nestjs/core";
import { AppModule } from "./app.module";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { helmetConfig } from "./config/helmet.config";
import helmet from 'helmet';
import { TransformInterceptor } from "./common/interceptors/transform.interceptor";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import cookieParser from 'cookie-parser';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const reflector = app.get(Reflector);

  // Apply helmet middleware with custom config
  app.use(helmet(helmetConfig));
 
  // Config cookie (Http-only, Secure)
  app.use(cookieParser());

  // Config CORS
  app.enableCors({
    origin: config.get<string>('FE_DOMAIN'), // FE domain
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Enable global guard for JWT authentication
  app.useGlobalGuards(new JwtAuthGuard(reflector));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Tự động bỏ các field không có trong DTO
      forbidNonWhitelisted: true, // (Tùy chọn) Báo lỗi luôn nếu gửi field lạ
      transform: true,
    }),
  );

  // Transform response from controller
  app.useGlobalInterceptors(new TransformInterceptor(reflector));

  app.setGlobalPrefix("api");
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Student Marketplace API")
    .setDescription("API documentation for the Student Marketplace application")
    .setVersion("1.0")
    .addServer('http://localhost:8080', 'Development Server')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token (without Bearer prefix)',
        in: 'header',
      },
      'access-token',
    )
    .build();
  
  const document = SwaggerModule.createDocument(app, swaggerConfig);

  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true, // Remember JWT token
      tagsSorter: 'alpha', // Sort tags alphabetically
      operationsSorter: 'alpha', // Sort operations alphabetically
      docExpansion: 'none', // Collapse all sections initially
      filter: true, // Enable search filter
      showRequestHeaders: true, // Show request headers
    },
    customSiteTitle: 'API Docs', // Custom title
    customfavIcon: '/favicon.ico', // Custom favicon
  });

  app.enableShutdownHooks();
  const port = config.get<string | number>('PORT') ?? 8080;
  await app.listen(port);
}

void bootstrap();
