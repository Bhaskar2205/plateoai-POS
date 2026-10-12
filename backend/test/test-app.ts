import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';
import { Module } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { resolve } from 'node:path';
import { configureApp, serveUploads } from 'src/bootstrap';
import { ClientIpThrottlerGuard } from 'src/common/guards/client-ip-throttler.guard';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { buildThrottlerOptions } from 'src/common/throttling';
import { configuration, type AppConfig } from 'src/config/configuration';
import { entities } from 'src/database/data-source';
import { mysqlSslConnectionOptions } from 'src/database/mysql-ssl';
import { mysqlUtcConnectionOptions } from 'src/database/mysql-utc';
import { HealthController } from 'src/health/health.controller';
import { AuthController } from 'src/modules/auth/auth.controller';
import { AuthService } from 'src/modules/auth/auth.service';
import { JwtStrategy } from 'src/modules/auth/jwt.strategy';
import { CategoriesModule } from 'src/modules/categories/categories.module';
import { DishesModule } from 'src/modules/dishes/dishes.module';
import { IngredientsModule } from 'src/modules/ingredients/ingredients.module';
import { InventoryModule } from 'src/modules/inventory/inventory.module';
import { BookingsModule } from 'src/modules/bookings/bookings.module';
import { PlatformModule } from 'src/modules/platform/platform.module';
import { PublicMenuModule } from 'src/modules/public-menu/public-menu.module';
import { RestaurantsModule } from 'src/modules/restaurants/restaurants.module';
import { OrdersModule } from 'src/modules/orders/orders.module';
import { ReportsModule } from 'src/modules/reports/reports.module';
import { TaxesModule } from 'src/modules/taxes/taxes.module';
import { AuditModule } from 'src/modules/audit/audit.module';
import { IdempotencyModule } from 'src/modules/idempotency/idempotency.module';
import { PaymentsModule } from 'src/modules/payments/payments.module';
import { UploadsModule } from 'src/modules/uploads/uploads.module';
import { TablesModule } from 'src/modules/tables/tables.module';
import { UsersModule } from 'src/modules/users/users.module';
import { User } from 'src/modules/users/entities/user.entity';
import { UserRole } from 'src/common/enums';
import { hashPassword } from 'src/common/security/password';

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

  // dropSchema wipes the target. DB_DATABASE may come from backend/.env (the dev
  // database), so refuse anything that is not explicitly a throwaway *_test database.
  const database = process.env.DB_DATABASE ?? 'plateo_test';
  if (!/_test$/.test(database)) {
    throw new Error(`Refusing to run the MySQL e2e suite against "${database}": it drops the schema. Set DB_DATABASE to a *_test database.`);
  }

  return {
    type: 'mysql',
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number.parseInt(process.env.DB_PORT ?? '3306', 10),
    username: process.env.DB_USERNAME ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    database,
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
    // Same DB_SSL* handling as production, so TLS can be exercised against MySQL too.
    ...mysqlSslConnectionOptions(configuration().database.ssl),
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
    InventoryModule,
    BookingsModule,
    PlatformModule,
    DishesModule,
    PublicMenuModule,
    TablesModule,
    AuditModule,
    IdempotencyModule,
    OrdersModule,
    PaymentsModule,
    TaxesModule,
    ReportsModule,
    UploadsModule,
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
  providers: [{ provide: APP_GUARD, useClass: ClientIpThrottlerGuard }],
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

  // rawBody matches production: webhook signatures are verified over the exact
  // bytes received, so the suite has to receive them the same way.
  const app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
  configureApp(app);
  // Same static route as production, so the suite covers the headers a browser
  // needs before it will paint a photo from another origin.
  serveUploads(app, resolve(configuration().uploads.directory));
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
/**
 * A Plateo administrator token for this app, created once and reused.
 *
 * There is no public registration any more: a restaurant is opened by somebody
 * at Plateo. So the helper every test leans on has to go through that path -
 * which is the right thing anyway, because it means 130 call sites exercise the
 * real endpoint rather than a shortcut that could drift away from it.
 *
 * The admin row is inserted directly rather than seeded through the environment:
 * the bootstrap only runs when no administrator exists, and suites share a
 * process.
 */
const platformTokens = new WeakMap<INestApplication, Promise<string>>();

export function platformAdminToken(app: INestApplication): Promise<string> {
  const existing = platformTokens.get(app);
  if (existing) return existing;

  const created = (async () => {
    const email = `platform-${Math.random().toString(36).slice(2, 8)}@plateo.test`;
    const password = 'PlatformAdmin123!';

    const users = app.get(DataSource).getRepository(User);
    await users.save(
      users.create({
        name: 'Test platform admin',
        email,
        passwordHash: await hashPassword(password),
        role: UserRole.SUPER_ADMIN,
      }),
    );

    const login = await api(app).post('/auth/platform/login').send({ email, password }).expect(200);

    return login.body.accessToken as string;
  })();

  platformTokens.set(app, created);

  return created;
}

/**
 * Opens a restaurant with an owner, the way Plateo now does it.
 *
 * Signature unchanged, so every existing test reads the same; only the path
 * underneath moved from `/auth/register` to the platform endpoint.
 */
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
  const email = overrides.email ?? `owner-${suffix}@example.com`;
  const password = overrides.password ?? 'StrongPassword123!';

  const token = await platformAdminToken(app);

  const created = await api(app)
    .post('/platform/restaurants')
    .set('Authorization', `Bearer ${token}`)
    .send({
      restaurantName: overrides.restaurantName ?? `Test Kitchen ${suffix}`,
      address: overrides.address ?? 'Jaipur, Rajasthan',
      ownerName: overrides.name ?? 'Test Owner',
      ownerEmail: email,
      ownerPassword: password,
    })
    .expect(201);

  // The owner signs in for themselves, exactly as a real one would with the
  // credentials they were handed.
  const login = await api(app)
    .post('/auth/login')
    .send({ email, password, restaurantId: created.body.id })
    .expect(200);

  return {
    accessToken: login.body.accessToken,
    userId: login.body.user.id,
    restaurantId: created.body.id,
    email,
    password,
  };
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Reads the configured app settings the same way the runtime does. */
export const testConfig = (): AppConfig => configuration();
