import 'reflect-metadata';
import { ALLOWED_METHODS, ALLOWED_REQUEST_HEADERS } from './common/cors';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { configureApp, serveUploads, setupSwagger } from './bootstrap';
import { installShutdownHandlers } from './shutdown';
import type { AppConfig } from './config/configuration';

const SWAGGER_PATH = 'api/docs';

async function bootstrap(): Promise<void> {
  // rawBody keeps the exact bytes of each request alongside the parsed body.
  // Payment webhook signatures are computed over those bytes, and re-serialising
  // JSON can reorder keys or change number formatting - so a signature checked
  // against a re-serialised body would never match.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
    rawBody: true,
  });
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
    methods: [...ALLOWED_METHODS],
    // Defined in common/cors.ts, with a spec that checks it against what the
    // frontend actually sends: a header missing from this list blocks the whole
    // request rather than merely dropping the header.
    allowedHeaders: [...ALLOWED_REQUEST_HEADERS],
    credentials: false,
    maxAge: 86400,
  });

  configureApp(app);

  const uploads = configService.get<AppConfig['uploads']>('uploads')!;
  serveUploads(app, resolve(uploads.directory));

  if (swaggerEnabled) {
    setupSwagger(app, SWAGGER_PATH);
  }

  // Deliberately NOT app.enableShutdownHooks(): Nest's own signal handler ends by
  // re-raising the signal at itself (`process.kill(process.pid, signal)`), so the
  // process dies *by* SIGTERM and exits non-zero - the very thing that makes a
  // normal rollover look like a crash. installShutdownHandlers below runs the same
  // lifecycle hooks through `app.close()` and then exits 0.
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`Plateo API (${nodeEnv}) listening on http://localhost:${port}`);
  logger.log(`CORS origins: ${corsOrigins.join(', ')}`);
  logger.log(`Trust proxy: ${String(configService.get<AppConfig['trustProxy']>('trustProxy'))}`);
  logger.log(`Database TLS: ${configService.get<AppConfig['database']>('database')!.ssl.enabled ? 'on' : 'off'}`);
  logger.log(`Dish photos: ${resolve(uploads.directory)} served at ${uploads.publicApiUrl}/uploads`);

  if (nodeEnv === 'production' && !resolve(uploads.directory).startsWith('/')) {
    logger.warn('UPLOADS_DIR is not absolute: dish photos will be lost on the next deploy.');
  }

  if (nodeEnv === 'production' && !configService.get<string>('internalProxySecret')) {
    logger.warn(
      'INTERNAL_PROXY_SECRET is not set: server-rendered public menus are rate limited by the ' +
        'frontend server IP, so busy restaurants can hit 429s. Set the same secret on the frontend.',
    );
  }

  if (swaggerEnabled) {
    logger.log(`API documentation: http://localhost:${port}/${SWAGGER_PATH}`);
  }

  installShutdownHandlers(app, logger);
}

void bootstrap();
