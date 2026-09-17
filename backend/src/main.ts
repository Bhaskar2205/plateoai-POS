import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { configureApp, setupSwagger } from './bootstrap';
import type { AppConfig } from './config/configuration';

const SWAGGER_PATH = 'api/docs';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const configService = app.get(ConfigService);

  const port = configService.get<number>('port')!;
  const corsOrigins = configService.get<string[]>('corsOrigins')!;
  const swaggerEnabled = configService.get<boolean>('swaggerEnabled')!;
  const nodeEnv = configService.get<AppConfig['nodeEnv']>('nodeEnv')!;

  app.use(
    helmet({
      // The Swagger UI loads its own inline assets; CSP would block them.
      contentSecurityPolicy: swaggerEnabled ? false : undefined,
    }),
  );

  // The admin app sends the token in an Authorization header, not a cookie, so
  // credentials stay off and the allow-list only needs to cover the origins.
  app.enableCors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
    maxAge: 86400,
  });

  configureApp(app);

  if (swaggerEnabled) {
    setupSwagger(app, SWAGGER_PATH);
  }

  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`Plateo API (${nodeEnv}) listening on http://localhost:${port}`);
  logger.log(`CORS origins: ${corsOrigins.join(', ')}`);

  if (swaggerEnabled) {
    logger.log(`API documentation: http://localhost:${port}/${SWAGGER_PATH}`);
  }
}

void bootstrap();
