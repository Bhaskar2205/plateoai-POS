import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AuditAction, AuditEntity, RestaurantStatus, UserRole } from 'src/common/enums';
import { hashPassword } from 'src/common/security/password';
import { AuditContext, AuditService } from 'src/modules/audit/audit.service';
import { RestaurantUser } from 'src/modules/restaurants/entities/restaurant-user.entity';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { RestaurantsService } from 'src/modules/restaurants/restaurants.service';
import { User } from 'src/modules/users/entities/user.entity';
import { UsersService } from 'src/modules/users/users.service';
import {
  CreateRestaurantAccountDto,
  ResetOwnerPasswordDto,
  UpdateRestaurantStatusDto,
} from './dto/platform.dto';

/**
 * Running Plateo, as opposed to running a restaurant.
 *
 * Restaurants are created here and nowhere else. Self-registration is gone: a
 * restaurant on Plateo is an account somebody at Plateo opened, which means the
 * list of tenants is the list of customers rather than whoever found the sign-up
 * form. It also means nobody can take a slug or a name by registering first.
 *
 * Every method here reaches across tenants by design, which is exactly why this
 * module is the only one that may, and why `PlatformController` is guarded on
 * SUPER_ADMIN at the controller rather than per route - a new method added to it
 * is locked down by default rather than by somebody remembering.
 *
 * **Known gap: platform actions are not attributed.** `audit_logs` belongs to a
 * restaurant - it is that tenant's record of what its own staff did - so writing
 * "Plateo suspended you" into it would put an employee's name inside a customer's
 * log, and give every new restaurant a history before anything had happened.
 * These actions therefore record *that* they happened but not *who* did them.
 * Attribution needs a platform-level log of its own; until that exists, who
 * suspended a restaurant is not recoverable from Plateo.
 */

/** A restaurant as the platform list shows it, with who owns it. */
export interface PlatformRestaurantRow {
  id: number;
  name: string;
  slug: string;
  publicSlug: string;
  status: RestaurantStatus;
  address: string | null;
  phone: string | null;
  /** Shown in the panel so Plateo can see which restaurants can bill properly. */
  taxNumber: string | null;
  createdAt: Date;
  owners: Array<{ id: number; name: string; email: string; role: UserRole }>;
}

@Injectable()
export class PlatformService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Restaurant) private readonly restaurants: Repository<Restaurant>,
    @InjectRepository(RestaurantUser) private readonly memberships: Repository<RestaurantUser>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly restaurantsService: RestaurantsService,
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
  ) {}

  /** Every restaurant on the platform, newest first, with its people. */
  async listRestaurants(): Promise<PlatformRestaurantRow[]> {
    const restaurants = await this.restaurants.find({ order: { createdAt: 'DESC' }, take: 500 });

    if (restaurants.length === 0) return [];

    // One query for the memberships and one for the users, rather than a query
    // per restaurant - the list is the platform's home screen.
    const memberships = await this.memberships.find({
      where: { restaurantId: In(restaurants.map((restaurant) => restaurant.id)) },
    });

    const userIds = [...new Set(memberships.map((membership) => membership.userId))];
    const users = userIds.length > 0 ? await this.users.find({ where: { id: In(userIds) } }) : [];
    const byId = new Map(users.map((user) => [user.id, user]));

    const byRestaurant = new Map<number, PlatformRestaurantRow['owners']>();
    for (const membership of memberships) {
      const user = byId.get(membership.userId);
      if (!user) continue;

      const list = byRestaurant.get(membership.restaurantId) ?? [];
      list.push({ id: user.id, name: user.name, email: user.email, role: user.role });
      byRestaurant.set(membership.restaurantId, list);
    }

    return restaurants.map((restaurant) => ({
      id: restaurant.id,
      name: restaurant.name,
      slug: restaurant.slug,
      publicSlug: restaurant.publicSlug,
      status: restaurant.status,
      address: restaurant.address,
      phone: restaurant.phone,
      taxNumber: restaurant.taxNumber,
      createdAt: restaurant.createdAt,
      owners: byRestaurant.get(restaurant.id) ?? [],
    }));
  }

  /**
   * Opens a restaurant account, with the owner who will sign in to it.
   *
   * One transaction: a restaurant with no owner is an orphan nobody can reach,
   * and an owner with no restaurant cannot log in at all. Either both exist or
   * neither does.
   *
   * The password is hashed outside the transaction - it takes ~100ms and would
   * otherwise hold a database connection open for no reason.
   */
  async createRestaurantAccount(
    dto: CreateRestaurantAccountDto,
  ): Promise<PlatformRestaurantRow> {
    if (await this.usersService.emailExists(dto.ownerEmail)) {
      throw new ConflictException('An account with this email already exists.');
    }

    const passwordHash = await hashPassword(dto.ownerPassword);

    const created = await this.dataSource.transaction(async (manager) => {
      // Re-checked inside the transaction: two administrators creating the same
      // owner at once both passed the check above.
      if (await this.usersService.emailExists(dto.ownerEmail, manager)) {
        throw new ConflictException('An account with this email already exists.');
      }

      const restaurant = await this.restaurantsService.createRestaurant(
        {
          name: dto.restaurantName,
          address: dto.address ?? null,
          phone: dto.phone ?? null,
          taxNumber: dto.taxNumber ?? null,
        },
        manager,
      );

      const owner = await this.usersService.create(
        {
          name: dto.ownerName,
          email: dto.ownerEmail,
          passwordHash,
          role: UserRole.RESTAURANT_OWNER,
        },
        manager,
      );

      await manager
        .getRepository(RestaurantUser)
        .save(
          manager.getRepository(RestaurantUser).create({
            userId: owner.id,
            restaurantId: restaurant.id,
          }),
        );

      return { restaurant, owner };
    });

    return {
      id: created.restaurant.id,
      name: created.restaurant.name,
      slug: created.restaurant.slug,
      publicSlug: created.restaurant.publicSlug,
      status: created.restaurant.status,
      address: created.restaurant.address,
      phone: created.restaurant.phone,
      taxNumber: created.restaurant.taxNumber,
      createdAt: created.restaurant.createdAt,
      owners: [
        {
          id: created.owner.id,
          name: created.owner.name,
          email: created.owner.email,
          role: created.owner.role,
        },
      ],
    };
  }

  /**
   * Suspends or restores a restaurant.
   *
   * Suspension bites immediately rather than when tokens expire: `JwtStrategy`
   * re-reads the status on every request, so a suspended restaurant's staff are
   * out on their next click.
   */
  async setStatus(
    restaurantId: number,
    dto: UpdateRestaurantStatusDto,
    context?: AuditContext,
  ): Promise<PlatformRestaurantRow> {
    const restaurant = await this.restaurants.findOne({ where: { id: restaurantId } });

    if (!restaurant) throw new NotFoundException(`Restaurant ${restaurantId} was not found.`);

    const before = restaurant.status;

    if (before === dto.status) {
      throw new ConflictException(`That restaurant is already ${dto.status.toLowerCase()}.`);
    }

    restaurant.status = dto.status;
    await this.restaurants.save(restaurant);

    await this.auditService.record({
      restaurantId,
      // Null rather than the operator: this log is read by the restaurant, and
      // the query joins user names, so naming the actor would show a customer
      // which Plateo employee touched their account.
      userId: null,
      action: AuditAction.RESTAURANT_STATUS_CHANGED,
      entityType: AuditEntity.RESTAURANT,
      entityId: restaurantId,
      oldValue: { status: before },
      newValue: { status: dto.status },
      context,
    });

    return this.getRestaurant(restaurantId);
  }

  /**
   * Sets a new password for somebody at a restaurant.
   *
   * Owners cannot reset their own password anywhere in Plateo yet, so this is how
   * somebody locked out gets back in. The new password is given to them out of
   * band; it is never stored or returned in plain text.
   */
  async resetPassword(
    restaurantId: number,
    dto: ResetOwnerPasswordDto,
    context?: AuditContext,
  ): Promise<{ email: string }> {
    const user = await this.users.findOne({ where: { email: dto.email } });

    if (!user) throw new NotFoundException('No account with that email.');

    // Scoped to the restaurant named in the URL, so a mistyped id cannot reset
    // somebody at a different tenant.
    const membership = await this.memberships.findOne({
      where: { userId: user.id, restaurantId },
    });

    if (!membership) {
      throw new NotFoundException('That account does not belong to this restaurant.');
    }

    user.passwordHash = await hashPassword(dto.newPassword);
    await this.users.save(user);

    await this.auditService.record({
      restaurantId,
      userId: null,
      action: AuditAction.OWNER_PASSWORD_RESET,
      entityType: AuditEntity.RESTAURANT,
      entityId: restaurantId,
      newValue: { email: user.email },
      context,
    });

    return { email: user.email };
  }

  async getRestaurant(restaurantId: number): Promise<PlatformRestaurantRow> {
    const rows = await this.listRestaurants();
    const found = rows.find((row) => row.id === restaurantId);

    if (!found) throw new NotFoundException(`Restaurant ${restaurantId} was not found.`);

    return found;
  }

  /** The numbers on the platform's own home screen. */
  async stats(): Promise<{ restaurants: number; active: number; suspended: number; owners: number }> {
    const [restaurants, active, owners] = await Promise.all([
      this.restaurants.count(),
      this.restaurants.count({ where: { status: RestaurantStatus.ACTIVE } }),
      this.users.count({ where: { role: UserRole.RESTAURANT_OWNER } }),
    ]);

    return { restaurants, active, suspended: restaurants - active, owners };
  }
}
