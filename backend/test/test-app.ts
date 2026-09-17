import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';
import { Module } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { configureApp } from 'src/bootstrap';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { buildThrottlerOptions } from 'src/common/throttling';
import { configuration, type AppConfig } from 'src/config/configuration';
import { entities } from 'src/database/data-source';
import { mysqlUtcConnectionOptions } from 'src/database/mysql-utc';
import { HealthController } from 'src/health/health.controller';
import { AuthController } from 'src/modules/auth/auth.controller';
import { AuthService } from 'src/modules/auth/auth.service';
import { JwtStrategy } from 'src/modules/auth/jwt.strategy';
import { CategoriesModule } from 'src/modules/categories/categories.module';
import { DishesModule } from 'src/modules/dishes/dishes.module';
import { IngredientsModule } from 'src/modules/ingredients/ingredients.module';
import { PublicMenuModule } from 'src/modules/public-menu/public-menu.module';
import { RestaurantsModule } from 'src/modules/restaurants/restaurants.module';
import { UsersModule } from 'src/modules/users/users.module';

/**
 * Test harness.
 *
 * Production runs on MySQL 8 via migrations; these tests run the same entities,
 * guards, pipes and exception filter against an in-memory SQLite database so the
 * suite needs no server and no cleanup between files. Entity column types are
 * kept driver-portable specifically so this substitution is faithful - see the
 * note on `User`.
 *
 * `ThrottlerGuard` is deliberately left out: rate limits are exercised in a
 * dedicated spec, and a shared 5-requests-per-minute budget would otherwise make
 * unrelated tests fail depending on execution order.
 */

process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? 'test-secret-value-that-is-at-least-32-characters-long';
process.env.NODE_ENV = 'test';

/**
 * SQLite by default so the suite runs anywhere. Set `TEST_DB_DRIVER=mysql` to
 * run the identical suite against a real MySQL 8 server instead - that is the
 * only way to exercise the behaviour SQLite cannot reproduce, notably DECIMAL
 * columns arriving as strings from mysql2 (see `NumericTransformer`) and the
 * case-insensitive `utf8mb4_unicode_ci` collation behind the per-restaurant
 * unique name indexes.
 *
 * The MySQL path builds its schema by running the real migration, never
 * `synchronize` - so the tests exercise the same DDL that production gets.
 */
export const isMysqlTestRun = process.env.TEST_DB_DRIVER === 'mysql';

function testDatabaseOptions(): TypeOrmModuleOptions {
  if (!isMysqlTestRun) {
    return {
      type: 'sqlite',
      database: ':memory:',
      entities,
      synchronize: true,
      dropSchema: true,
      logging: false,
    };
  }

  return {
    type: 'mysql',
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number.parseInt(process.env.DB_PORT ?? '3306', 10),
    username: process.env.DB_USERNAME ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_DATABASE ?? 'plateo_test',
    entities,
    migrations: [__dirname + '/../src/database/migrations/*{.ts,.js}'],
    migrationsTableName: 'plateo_migrations',
    // Rebuild from the migration for every suite: same DDL as production, and
    // each spec file starts from a known-empty schema.
    dropSchema: true,
    migrationsRun: true,
    synchronize: false,
    logging: false,
    charset: 'utf8mb4',
    // Same UTC session setup as production - see src/database/mysql-utc.ts.
    ...mysqlUtcConnectionOptions,
  };
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      load: [configuration],
    }),
    TypeOrmModule.forRoot(testDatabaseOptions()),
    UsersModule,
    RestaurantsModule,
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '1d' as JwtSignOptions['expiresIn'], issuer: 'plateo' },
    }),
    CategoriesModule,
    IngredientsModule,
    DishesModule,
    PublicMenuModule,
  ],
  controllers: [AuthController, HealthController],
  providers: [
    AuthService,
    JwtStrategy,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class TestAppModule {}

/**
 * Same graph, plus the global `ThrottlerGuard`. Kept separate so only the
 * rate-limit spec pays the shared request budget.
 */
@Module({
  imports: [
    TestAppModule,
    // The production configuration, not a copy - see common/throttling.ts.
    ThrottlerModule.forRoot(buildThrottlerOptions()),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
class ThrottledTestAppModule {}

export interface TestContext {
  app: INestApplication;
  dataSource: DataSource;
  close: () => Promise<void>;
}

export async function createTestApp(
  options: { throttle?: boolean } = {},
): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({
    imports: [options.throttle ? ThrottledTestAppModule : TestAppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  const dataSource = app.get(DataSource);

  return {
    app,
    dataSource,
    close: async () => {
      await app.close();
    },
  };
}

export const api = (app: INestApplication) => request(app.getHttpServer());

export interface RegisteredOwner {
  accessToken: string;
  userId: number;
  restaurantId: number;
  email: string;
  password: string;
}

/** Registers an owner + restaurant and returns everything a test needs. */
export async function registerOwner(
  app: INestApplication,
  overrides: Partial<{
    name: string;
    email: string;
    password: string;
    restaurantName: string;
    address: string;
  }> = {},
): Promise<RegisteredOwner> {
  const suffix = Math.random().toString(36).slice(2, 8);
  const payload = {
    name: overrides.name ?? 'Test Owner',
    email: overrides.email ?? `owner-${suffix}@example.com`,
    password: overrides.password ?? 'StrongPassword123!',
    restaurantName: overrides.restaurantName ?? `Test Kitchen ${suffix}`,
    address: overrides.address ?? 'Jaipur, Rajasthan',
  };

  const response = await api(app).post('/auth/register').send(payload).expect(201);

  return {
    accessToken: response.body.accessToken,
    userId: response.body.user.id,
    restaurantId: response.body.restaurant.id,
    email: payload.email,
    password: payload.password,
  };
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Reads the configured app settings the same way the runtime does. */
export const testConfig = (): AppConfig => configuration();
