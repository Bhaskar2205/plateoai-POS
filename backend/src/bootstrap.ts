import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ClassSerializerInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Express } from 'express';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import type { TrustProxySetting } from './config/configuration';

/**
 * Global HTTP wiring shared by `main.ts` and the e2e test harness, so the tests
 * exercise the same pipes, filters and serialisation rules as production.
 */
export function configureApp(app: INestApplication): INestApplication {
  // Behind a load balancer or reverse proxy, `req.ip` is the proxy unless Express
  // is told how many hops to trust - and the rate limiter keys on `req.ip`.
  const trustProxy = app.get(ConfigService).get<TrustProxySetting>('trustProxy') ?? false;
  (app.getHttpAdapter().getInstance() as Express).set('trust proxy', trustProxy);

  app.useGlobalPipes(
    new ValidationPipe({
      // Strip properties with no decorator, and reject requests that send them -
      // this is what stops a client smuggling `restaurantId` into a create body.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // Honours @Exclude() on entities, so `passwordHash` can never be serialised.
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  app.useGlobalFilters(new AllExceptionsFilter());

  return app;
}

export function setupSwagger(app: INestApplication, path = 'api/docs'): void {
  const config = new DocumentBuilder()
    .setTitle('Plateo API')
    .setDescription(
      [
        'Multi-restaurant QR ordering platform - Week 1 (restaurant management).',
        '',
        '**Multi-tenancy.** Every endpoint operates on the restaurant encoded in the access token ' +
          'and re-validated against the membership table on each request. Request bodies never ' +
          'carry a restaurant id.',
        '',
        '**Nutrition.** Values on dishes are entered by the restaurant and stored verbatim. ' +
          'Plateo does not generate, calculate or verify them, and they are not medical or ' +
          'nutritional advice. Calculating nutrition from ingredient quantities against a ' +
          'verified food database is planned for a later release.',
        '',
        'Authorise once with a token from `POST /auth/login` or `POST /auth/register`.',
      ].join('\n'),
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Paste the accessToken returned by /auth/login.',
      },
      'access-token',
    )
    .addTag('Health', 'Liveness probe')
    .addTag('Authentication', 'Registration, login, session context')
    .addTag('Restaurants', 'Profile, members and dashboard counters')
    .addTag('Categories', 'Menu sections')
    .addTag('Dishes', 'Menu items, nutrition and recipes')
    .addTag('Ingredients', 'Reusable per-restaurant pantry')
    .addTag('Public menu', 'Anonymous, read-only menu by restaurant slug')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup(path, app, document, {
    swaggerOptions: { persistAuthorization: true },
    customSiteTitle: 'Plateo API docs',
  });
}
