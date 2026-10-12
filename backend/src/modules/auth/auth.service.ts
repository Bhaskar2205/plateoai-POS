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
import { AuthResponseDto, PlatformAuthResponseDto, AuthUserDto, MeResponseDto } from './dto/auth-response.dto';
import { kitchenCodeFingerprint } from 'src/modules/restaurants/kitchen-code';
import { KitchenSessionDto, KitchenSessionResponseDto } from './dto/kitchen-session.dto';
import { LoginDto } from './dto/login.dto';

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

  /**
   * Signs in a Plateo administrator - the people who run the platform.
   *
   * Its own endpoint rather than a branch inside `login`, because the two have
   * opposite invariants: a restaurant login must end up scoped to exactly one
   * tenant, and this one must end up scoped to none. Folding them together would
   * mean the tenant check became conditional, and a conditional tenant check is
   * how a tenant check stops happening.
   *
   * The failure message does not distinguish "no such account" from "not an
   * administrator": knowing which is which tells somebody probing the endpoint
   * when they have found a real email.
   */
  async platformLogin(dto: LoginDto): Promise<PlatformAuthResponseDto> {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      await burnTimingDecoy();
      throw new UnauthorizedException('Invalid email or password.');
    }

    const passwordMatches = await verifyPassword(user.passwordHash, dto.password);

    if (!passwordMatches || user.role !== UserRole.SUPER_ADMIN) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      scope: 'platform',
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: AuthService.expiresInSeconds(this.jwtConfig.expiresIn),
      user: AuthService.toAuthUser(user),
    };
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
    // A platform administrator has no active restaurant, and asking for one by a
    // null id would throw rather than return nothing.
    const active =
      currentUser.restaurantId === null
        ? null
        : (restaurants.find((restaurant) => restaurant.id === currentUser.restaurantId) ??
          (await this.restaurantsService.findById(currentUser.restaurantId)));

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

  /**
   * Signs a kitchen screen in with the restaurant's kitchen code.
   *
   * Every wrong code gets the same refusal and the same timing, so the endpoint
   * cannot be used to learn which codes exist; the rate limit on the route is
   * what makes walking the code space impractical.
   */
  async kitchenSession(dto: KitchenSessionDto): Promise<KitchenSessionResponseDto> {
    const restaurant = await this.restaurantsService.findByKitchenCode(dto.code);

    if (!restaurant) {
      await burnTimingDecoy();
      throw new UnauthorizedException('That kitchen code was not recognised.');
    }

    if (restaurant.status === RestaurantStatus.INACTIVE) {
      throw new UnauthorizedException('That kitchen code was not recognised.');
    }

    const accessToken = await this.jwtService.signAsync({
      rid: restaurant.id,
      scope: 'kitchen',
      // Ties the screen to the code it signed in with, so issuing a new code
      // signs every existing screen out on its next request.
      kcv: kitchenCodeFingerprint(restaurant.kitchenCode),
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: AuthService.expiresInSeconds(this.jwtConfig.expiresIn),
      restaurantName: restaurant.name,
    };
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
