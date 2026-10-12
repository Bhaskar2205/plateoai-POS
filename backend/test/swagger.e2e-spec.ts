import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { createTestApp, type TestContext } from './test-app';

/**
 * Guards the API contract: a bad `@Api*` decorator or a DTO that Swagger cannot
 * reflect over shows up here rather than as a blank /api/docs page.
 */
describe('OpenAPI document', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let document: ReturnType<typeof SwaggerModule.createDocument>;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;

    document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Plateo API')
        .setVersion('1.0')
        .addBearerAuth(
          { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          'access-token',
        )
        .build(),
    );
  });

  afterAll(async () => {
    await ctx.close();
  });

  it.each([
    ['/auth/platform/login', 'post'],
    ['/platform/restaurants', 'post'],
    ['/auth/login', 'post'],
    ['/auth/me', 'get'],
    ['/auth/logout', 'post'],
    ['/auth/switch-restaurant', 'post'],
    ['/restaurants/me', 'get'],
    ['/restaurants/me', 'patch'],
    ['/restaurants/me/users', 'get'],
    ['/restaurants/me/stats', 'get'],
    ['/categories', 'post'],
    ['/categories', 'get'],
    ['/categories/{id}', 'get'],
    ['/categories/{id}', 'patch'],
    ['/categories/{id}', 'delete'],
    ['/dishes', 'post'],
    ['/dishes', 'get'],
    ['/dishes/{id}', 'get'],
    ['/dishes/{id}', 'patch'],
    ['/dishes/{id}', 'delete'],
    ['/dishes/{id}/ingredients', 'post'],
    ['/dishes/{id}/ingredients', 'get'],
    ['/dishes/{id}/ingredients', 'patch'],
    ['/dishes/{id}/ingredients/{ingredientId}', 'delete'],
    ['/ingredients', 'post'],
    ['/ingredients', 'get'],
    ['/ingredients/{id}', 'get'],
    ['/ingredients/{id}', 'patch'],
    ['/ingredients/{id}', 'delete'],
    ['/health', 'get'],
  ])('documents %s %s', (path, method) => {
    expect(document.paths[path]).toBeDefined();
    expect(document.paths[path][method as 'get']).toBeDefined();
  });

  it('marks protected endpoints as requiring the bearer token', () => {
    expect(document.paths['/dishes'].post!.security).toEqual([{ 'access-token': [] }]);
    expect(document.paths['/restaurants/me'].get!.security).toEqual([{ 'access-token': [] }]);
  });

  it('leaves the two sign-in routes unauthenticated, and nothing else', () => {
    expect(document.paths['/auth/login'].post!.security).toBeUndefined();
    expect(document.paths['/auth/platform/login'].post!.security).toBeUndefined();
  });

  it('no longer documents a public registration endpoint', () => {
    // Registration is gone: a restaurant exists because somebody at Plateo opened
    // the account. Swagger advertising it would be advertising a door that is
    // bricked up.
    expect(document.paths['/auth/register']).toBeUndefined();
  });

  it('requires the bearer token on every platform route', () => {
    const platform = Object.entries(document.paths).filter(([path]) =>
      path.startsWith('/platform'),
    );

    expect(platform.length).toBeGreaterThan(0);

    for (const [path, item] of platform) {
      for (const [method, operation] of Object.entries(item)) {
        if (!['get', 'post', 'patch', 'put', 'delete'].includes(method)) continue;

        expect({ path, method, security: (operation as { security?: unknown }).security }).toEqual({
          path,
          method,
          security: [{ 'access-token': [] }],
        });
      }
    }
  });

  it('documents error responses on protected endpoints', () => {
    const responses = document.paths['/dishes'].post!.responses;

    expect(responses['400']).toBeDefined();
    expect(responses['401']).toBeDefined();
    expect(responses['403']).toBeDefined();
  });

  it('never exposes passwordHash in any schema', () => {
    expect(JSON.stringify(document.components!.schemas)).not.toContain('passwordHash');
  });

  it('describes request bodies for the write endpoints', () => {
    expect(document.paths['/dishes'].post!.requestBody).toBeDefined();
    expect(document.components!.schemas!.CreateDishDto).toBeDefined();
    expect(document.components!.schemas!.CreateRestaurantAccountDto).toBeDefined();
  });
});
