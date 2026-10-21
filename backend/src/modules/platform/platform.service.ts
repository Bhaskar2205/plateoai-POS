import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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
  /**
   * Deleting a restaurant destroys its own audit trail, so the only durable
   * record of that act is here.
   */
  private readonly logger = new Logger(PlatformService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Restaurant) private readonly restaurants: Repository<Restaurant>,
    @InjectRepository(RestaurantUser) private readonly memberships: Repository<RestaurantUser>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly restaurantsService: RestaurantsService,
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Everything Plateo holds for one restaurant, as a file they can keep.
   *
   * Produced before a deletion, because a deletion takes the restaurant's bills
   * with it and a restaurant is required to keep those for years after it stops
   * trading. Handing the data back is the difference between closing an account
   * and destroying somebody's records.
   *
   * Raw queries by restaurant id rather than entity graphs: this runs once, on
   * an account that is about to cease to exist, and loading the whole object
   * tree of a busy restaurant through TypeORM would be slower and no clearer.
   * Password hashes are never included - the people are named, not reissuable.
   */
  async exportRestaurant(id: number): Promise<Record<string, unknown>> {
    const restaurant = await this.restaurants.findOne({ where: { id } });

    if (!restaurant) throw new NotFoundException(`Restaurant ${id} was not found.`);

    const q = <T = Record<string, unknown>>(sql: string): Promise<T[]> =>
      this.dataSource.query(sql, [id]) as Promise<T[]>;

    const [staff, categories, dishes, tables, orders, items, charges, bookings, ingredients, payments] =
      await Promise.all([
        q(`SELECT u.id, u.name, u.email, u.staff_code AS staffCode, u.role, u.is_active AS isActive
             FROM users u JOIN restaurant_users ru ON ru.user_id = u.id WHERE ru.restaurant_id = ?`),
        q('SELECT * FROM categories WHERE restaurant_id = ?'),
        q('SELECT * FROM dishes WHERE restaurant_id = ?'),
        q('SELECT * FROM restaurant_tables WHERE restaurant_id = ?'),
        q('SELECT * FROM orders WHERE restaurant_id = ? ORDER BY id'),
        q(`SELECT oi.* FROM order_items oi JOIN orders o ON o.id = oi.order_id
             WHERE o.restaurant_id = ? ORDER BY oi.id`),
        q(`SELECT oc.* FROM order_charges oc JOIN orders o ON o.id = oc.order_id
             WHERE o.restaurant_id = ? ORDER BY oc.id`),
        q('SELECT * FROM table_bookings WHERE restaurant_id = ? ORDER BY id'),
        q('SELECT * FROM ingredients WHERE restaurant_id = ?'),
        q('SELECT * FROM payment_intents WHERE restaurant_id = ? ORDER BY id'),
      ]);

    return {
      exportedAt: new Date().toISOString(),
      note:
        'A complete copy of this restaurant as held by Plateo at the time of export. ' +
        'Passwords are not included and cannot be recovered from this file.',
      restaurant,
      staff,
      menu: { categories, dishes },
      tables,
      orders,
      orderItems: items,
      orderCharges: charges,
      bookings,
      ingredients,
      payments,
    };
  }

  /**
   * What a deletion would destroy, so the panel can say so before it happens.
   *
   * `alsoWorkElsewhere` is the one that matters. Deleting a restaurant deletes
   * the accounts of everybody who worked there, and somebody who also works at
   * another Plateo restaurant loses that job too - a consequence nobody should
   * meet for the first time afterwards.
   */
  async describeDeletion(id: number): Promise<{
    name: string;
    bills: number;
    staff: number;
    alsoWorkElsewhere: string[];
  }> {
    const restaurant = await this.restaurants.findOne({ where: { id } });

    if (!restaurant) throw new NotFoundException(`Restaurant ${id} was not found.`);

    const members = await this.memberships.find({ where: { restaurantId: id }, relations: { user: true } });
    const ids = members.map((m) => m.userId);

    const elsewhere = ids.length
      ? await this.memberships.find({ where: { userId: In(ids) } })
      : [];

    const otherByUser = new Set(
      elsewhere.filter((m) => m.restaurantId !== id).map((m) => m.userId),
    );

    const [{ bills }] = (await this.dataSource.query(
      'SELECT COUNT(*) AS bills FROM orders WHERE restaurant_id = ?',
      [id],
    )) as Array<{ bills: number | string }>;

    return {
      name: restaurant.name,
      bills: Number(bills),
      staff: members.length,
      alsoWorkElsewhere: members
        .filter((m) => otherByUser.has(m.userId))
        .map((m) => m.user?.name ?? `User ${m.userId}`),
    };
  }

  /**
   * Erases a restaurant and everyone who worked there.
   *
   * Irreversible, and genuinely total: every bill, payment, ticket, booking and
   * stock movement goes with the row through the database's own cascades.
   *
   * The name has to be typed back. A list of restaurants with similar names is
   * exactly where a mis-click lands on the wrong row, and this is the one action
   * in Plateo with nothing behind it to undo with.
   *
   * The audit trail cannot record this. `audit_logs.restaurant_id` is NOT NULL
   * and cascades, so any row written here would be deleted by the very statement
   * it describes. The record is therefore the server log - which outlives the
   * database row - and the export the panel takes first.
   */
  async deleteRestaurant(
    id: number,
    confirmName: string,
    actorId: number,
  ): Promise<{ name: string; staffDeleted: number }> {
    const restaurant = await this.restaurants.findOne({ where: { id } });

    if (!restaurant) throw new NotFoundException(`Restaurant ${id} was not found.`);

    if (confirmName.trim() !== restaurant.name) {
      throw new BadRequestException(
        'The name does not match. Type the restaurant name exactly to confirm.',
      );
    }

    const members = await this.memberships.find({ where: { restaurantId: id } });
    const userIds = members.map((member) => member.userId);

    // Written before anything is destroyed, and to the log rather than the audit
    // table, because the audit table is one of the things about to be destroyed.
    this.logger.warn(
      `Deleting restaurant ${restaurant.id} "${restaurant.name}" (slug ${restaurant.slug}) ` +
        `and ${userIds.length} account(s), requested by user ${actorId}.`,
    );

    await this.dataSource.transaction(async (manager) => {
      // The restaurant first: its cascades clear the membership rows, which is
      // what would otherwise hold the user rows in place.
      await manager.getRepository(Restaurant).delete({ id });

      if (userIds.length > 0) {
        await manager.getRepository(User).delete({ id: In(userIds) });
      }
    });

    this.logger.warn(`Deleted restaurant ${id} "${restaurant.name}".`);

    return { name: restaurant.name, staffDeleted: userIds.length };
  }

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
