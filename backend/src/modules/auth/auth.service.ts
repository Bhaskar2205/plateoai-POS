import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RestaurantStatus, UserRole } from 'src/common/enums';
import { burnTimingDecoy, hashPassword, verifyPassword } from 'src/common/security/password';
import type { AppConfig } from 'src/config/configuration';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-request.interface';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { RestaurantUser } from 'src/modules/restaurants/entities/restaurant-user.entity';
import { RestaurantsService } from 'src/modules/restaurants/restaurants.service';
import { User } from 'src/modules/users/entities/user.entity';
import { UsersService } from 'src/modules/users/users.service';
import { AuthResponseDto, AuthUserDto, MeResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  private readonly jwtConfig: AppConfig['jwt'];

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly usersService: UsersService,
    private readonly restaurantsService: RestaurantsService,
    private readonly jwtService: JwtService,
    configService: ConfigService,
  ) {
    this.jwtConfig = configService.get<AppConfig['jwt']>('jwt')!;
  }

  /**
   * Onboards an owner and their restaurant atomically.
   *
   * The user row, the restaurant row and the membership linking them are
   * written in one transaction: a failure at any step leaves no orphan
   * restaurant and no account that cannot reach one.
   */
  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    if (await this.usersService.emailExists(dto.email)) {
      throw new ConflictException('An account with this email already exists.');
    }

    // Hashing is deliberately outside the transaction - it takes ~100ms and
    // would otherwise hold a database connection open for no reason.
    const passwordHash = await hashPassword(dto.password);

    const { user, restaurant } = await this.dataSource.transaction(async (manager) => {
      if (await this.usersService.emailExists(dto.email, manager)) {
        throw new ConflictException('An account with this email already exists.');
      }

      const createdRestaurant = await this.restaurantsService.createRestaurant(
        { name: dto.restaurantName, address: dto.address ?? null, phone: dto.phone ?? null },
        manager,
      );

      const createdUser = await this.usersService.create(
        {
          name: dto.name,
          email: dto.email,
          passwordHash,
          role: UserRole.RESTAURANT_OWNER,
        },
        manager,
      );

      await manager.getRepository(RestaurantUser).save(
        manager.getRepository(RestaurantUser).create({
          userId: createdUser.id,
          restaurantId: createdRestaurant.id,
        }),
      );

      return { user: createdUser, restaurant: createdRestaurant };
    });

    return this.buildAuthResponse(user, restaurant, [restaurant]);
  }

  /**
   * Verifies credentials and issues a token scoped to one restaurant.
   *
   * The password is compared even when no account matched, so response timing
   * does not reveal which emails are registered.
   */
  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      await burnTimingDecoy();
      throw new UnauthorizedException('Invalid email or password.');
    }

    const passwordMatches = await verifyPassword(user.passwordHash, dto.password);

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const restaurants = await this.restaurantsService.findRestaurantsForUser(user.id);

    if (restaurants.length === 0) {
      throw new ForbiddenException('This account is not linked to any restaurant.');
    }

    const active = this.resolveActiveRestaurant(restaurants, dto.restaurantId);
    AuthService.assertRestaurantReachable(active, user);

    return this.buildAuthResponse(user, active, restaurants);
  }

  /** Issues a token for a different restaurant the user belongs to. */
  async switchRestaurant(
    currentUser: AuthenticatedUser,
    restaurantId: number,
  ): Promise<AuthResponseDto> {
    const user = await this.usersService.getById(currentUser.id);
    const restaurants = await this.restaurantsService.findRestaurantsForUser(user.id);
    const target = restaurants.find((restaurant) => restaurant.id === restaurantId);

    if (!target) {
      throw new ForbiddenException('You are not a member of that restaurant.');
    }

    AuthService.assertRestaurantReachable(target, user);

    return this.buildAuthResponse(user, target, restaurants);
  }

  async getProfile(currentUser: AuthenticatedUser): Promise<MeResponseDto> {
    const user = await this.usersService.getById(currentUser.id);
    const restaurants = await this.restaurantsService.findRestaurantsForUser(user.id);
    const active =
      restaurants.find((restaurant) => restaurant.id === currentUser.restaurantId) ??
      (await this.restaurantsService.findById(currentUser.restaurantId));

    return {
      user: AuthService.toAuthUser(user),
      restaurant: active,
      restaurants,
    };
  }

  /**
   * Picks the tenant for a session.
   *
   * A client-supplied id is only ever used to *select from* memberships loaded
   * server-side - it is never trusted as the tenant itself.
   */
  private resolveActiveRestaurant(restaurants: Restaurant[], requestedId?: number): Restaurant {
    if (requestedId === undefined) {
      return restaurants[0];
    }

    const requested = restaurants.find((restaurant) => restaurant.id === requestedId);

    if (!requested) {
      throw new ForbiddenException('You are not a member of that restaurant.');
    }

    return requested;
  }

  /**
   * A suspended restaurant is closed to its own team - the same rule
   * `JwtStrategy` applies per request, so login and existing tokens agree.
   * SUPER_ADMIN is exempt so platform support can get in to lift the suspension.
   */
  private static assertRestaurantReachable(restaurant: Restaurant, user: User): void {
    if (restaurant.status === RestaurantStatus.INACTIVE && user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('This restaurant is inactive. Contact Plateo support.');
    }
  }

  private async buildAuthResponse(
    user: User,
    restaurant: Restaurant,
    restaurants: Restaurant[],
  ): Promise<AuthResponseDto> {
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      rid: restaurant.id,
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: AuthService.expiresInSeconds(this.jwtConfig.expiresIn),
      user: AuthService.toAuthUser(user),
      restaurant,
      restaurants,
    };
  }

  /** Strips credential material before a user ever reaches the transport layer. */
  private static toAuthUser(user: User): AuthUserDto {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };
  }

  /** Converts `15m` / `1d` / `3600` into seconds for the client. */
  private static expiresInSeconds(expiresIn: string): number {
    const match = /^(\d+)\s*([smhd])?$/.exec(expiresIn.trim());

    if (!match) {
      return 86400;
    }

    const amount = Number.parseInt(match[1], 10);
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

    return amount * (multipliers[match[2] ?? 's'] ?? 1);
  }
}
