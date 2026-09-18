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
  logger.log(`Trust proxy: ${String(configService.get<AppConfig['trustProxy']>('trustProxy'))}`);
  logger.log(`Database TLS: ${configService.get<AppConfig['database']>('database')!.ssl.enabled ? 'on' : 'off'}`);

  if (nodeEnv === 'production' && !configService.get<string>('internalProxySecret')) {
    logger.warn(
      'INTERNAL_PROXY_SECRET is not set: server-rendered public menus are rate limited by the ' +
        'frontend server IP, so busy restaurants can hit 429s. Set the same secret on the frontend.',
    );
  }

  if (swaggerEnabled) {
    logger.log(`API documentation: http://localhost:${port}/${SWAGGER_PATH}`);
  }
}

void bootstrap();
