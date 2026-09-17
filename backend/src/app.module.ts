import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { buildThrottlerOptions } from './common/throttling';
import { configuration, validateConfig } from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { AuthModule } from './modules/auth/auth.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { DishesModule } from './modules/dishes/dishes.module';
import { IngredientsModule } from './modules/ingredients/ingredients.module';
import { PublicMenuModule } from './modules/public-menu/public-menu.module';
import { RestaurantsModule } from './modules/restaurants/restaurants.module';
import { UsersModule } from './modules/users/users.module';

/**
 * Three guards run globally, in this order:
 *  1. ThrottlerGuard  - 120 req/min per route per IP; credential routes tighter
 *                       (see common/throttling.ts).
 *  2. JwtAuthGuard    - authentication, deny-by-default except `@Public()`.
 *  3. RolesGuard      - authorisation for routes carrying `@Roles(...)`.
 *
 * Tenant scoping is *not* a guard: it comes from `@ActiveRestaurantId()`, which
 * reads the server-validated restaurant off the request and is passed into every
 * service query. That makes the tenant filter part of the query itself rather
 * than a check a new endpoint could forget to add.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
      load: [() => validateConfig(configuration())],
    }),
    ThrottlerModule.forRoot(buildThrottlerOptions()),
    DatabaseModule,
    UsersModule,
    RestaurantsModule,
    AuthModule,
    CategoriesModule,
    IngredientsModule,
    DishesModule,
    PublicMenuModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
