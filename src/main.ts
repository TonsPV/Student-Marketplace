import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { helmetConfig } from "./config/helmet.config";
import helmet from 'helmet';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Apply helmet middleware with custom config
  app.use(helmet(helmetConfig));

  app.setGlobalPrefix("api");
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );

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
  await app.listen(port, "0.0.0.0");
}

void bootstrap();
