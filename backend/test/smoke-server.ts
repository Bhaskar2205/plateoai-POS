/**
 * Manual smoke test: boots a real HTTP server with the production bootstrap
 * (helmet, CORS, global pipes/filters, Swagger) and drives it over the wire.
 *
 * It swaps MySQL for in-memory SQLite so it runs on a machine with no database
 * server. Not part of `npm test`; run it with:
 *   npx ts-node -r tsconfig-paths/register test/smoke-server.ts
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { configureApp, setupSwagger } from 'src/bootstrap';
import { TestAppModule } from './test-app';

const PORT = 4321;
const BASE = `http://localhost:${PORT}`;

const results: string[] = [];
let failures = 0;

function check(label: string, ok: boolean, extra = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ` - ${extra}` : ''}`);
  if (!ok) failures += 1;
}

async function main(): Promise<void> {
  const app = await NestFactory.create(TestAppModule, { logger: false });

  app.use(helmet({ contentSecurityPolicy: false }));
  app.enableCors({
    origin: ['http://localhost:3000'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  configureApp(app);
  setupSwagger(app, 'api/docs');

  await app.listen(PORT);

  try {
    // --- Swagger UI + JSON ---------------------------------------------------
    const docs = await fetch(`${BASE}/api/docs`);
    const docsHtml = await docs.text();
    check('GET /api/docs serves the Swagger UI', docs.ok && docsHtml.includes('swagger'));

    const spec = await fetch(`${BASE}/api/docs-json`);
    const specJson = (await spec.json()) as { openapi: string; paths: Record<string, unknown> };
    check(
      'GET /api/docs-json serves the OpenAPI spec',
      spec.ok && specJson.openapi.startsWith('3.'),
      `${Object.keys(specJson.paths).length} paths`,
    );

    // --- Security headers + CORS --------------------------------------------
    const health = await fetch(`${BASE}/health`);
    check('GET /health responds 200', health.status === 200);
    check(
      'helmet sets security headers',
      health.headers.get('x-content-type-options') === 'nosniff',
    );

    const preflight = await fetch(`${BASE}/categories`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    check(
      'CORS allows the admin origin',
      preflight.headers.get('access-control-allow-origin') === 'http://localhost:3000',
    );

    const blocked = await fetch(`${BASE}/health`, { headers: { Origin: 'http://evil.test' } });
    check(
      'CORS rejects an unlisted origin',
      blocked.headers.get('access-control-allow-origin') !== 'http://evil.test',
    );

    // --- Real request flow ---------------------------------------------------
    const registerResponse = await fetch(`${BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Smoke Owner',
        email: 'smoke@example.com',
        password: 'StrongPassword123!',
        restaurantName: 'Smoke Test Kitchen',
        address: 'Jaipur, Rajasthan',
      }),
    });
    const registered = (await registerResponse.json()) as {
      accessToken: string;
      restaurant: { slug: string };
    };
    check(
      'POST /auth/register creates a restaurant over HTTP',
      registerResponse.status === 201 && registered.restaurant.slug === 'smoke-test-kitchen',
    );

    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${registered.accessToken}`,
    };

    const categoryResponse = await fetch(`${BASE}/categories`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Signature Bowls', sortOrder: 1 }),
    });
    const category = (await categoryResponse.json()) as { id: number };
    check('POST /categories works with a bearer token', categoryResponse.status === 201);

    const dishResponse = await fetch(`${BASE}/dishes`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        categoryId: category.id,
        name: 'Paneer Tikka Bowl',
        description: 'Grilled paneer with fresh vegetables and mint dressing',
        price: 299,
        proteinGrams: 22,
        calories: 380,
        carbsGrams: 24,
        fatGrams: 19,
        isAvailable: true,
      }),
    });
    const dish = (await dishResponse.json()) as { id: number; price: number };
    check(
      'POST /dishes stores the documented example payload',
      dishResponse.status === 201 && dish.price === 299,
    );

    const ingredientResponse = await fetch(`${BASE}/ingredients`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Paneer', allergenInfo: 'Contains milk' }),
    });
    const ingredient = (await ingredientResponse.json()) as { id: number };
    check('POST /ingredients works', ingredientResponse.status === 201);

    const recipeResponse = await fetch(`${BASE}/dishes/${dish.id}/ingredients`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        ingredients: [{ ingredientId: ingredient.id, quantity: 100, unit: 'g' }],
      }),
    });
    const recipe = (await recipeResponse.json()) as unknown[];
    check(
      'POST /dishes/:id/ingredients maps the recipe',
      recipeResponse.status === 201 && recipe.length === 1,
    );

    const stats = await fetch(`${BASE}/restaurants/me/stats`, { headers: authHeaders });
    const statsBody = (await stats.json()) as { totalDishes: number; totalIngredients: number };
    check(
      'GET /restaurants/me/stats returns dashboard counters',
      stats.status === 200 && statsBody.totalDishes === 1 && statsBody.totalIngredients === 1,
    );

    const unauthorized = await fetch(`${BASE}/dishes`);
    check('Unauthenticated GET /dishes is rejected', unauthorized.status === 401);

    const badRequest = await fetch(`${BASE}/dishes`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'No price' }),
    });
    const errorBody = (await badRequest.json()) as { statusCode: number; details?: string[] };
    check(
      'Validation errors use the shared error envelope',
      badRequest.status === 400 && Array.isArray(errorBody.details),
    );
  } finally {
    await app.close();
  }

  console.log(results.join('\n'));
  console.log(`\n${results.length - failures}/${results.length} checks passed.`);
  process.exitCode = failures > 0 ? 1 : 0;
}

void main().catch((error) => {
  console.error('Smoke test crashed:', error);
  process.exitCode = 1;
});
