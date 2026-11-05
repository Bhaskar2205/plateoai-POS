import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Like, Repository } from 'typeorm';
import {
  AuditAction,
  AuditEntity,
  RestaurantStatus,
  UserRole,
} from 'src/common/enums';
import { slugify, uniqueSlug } from 'src/common/utils/slug.util';
import { Category } from 'src/modules/categories/entities/category.entity';
import { Dish } from 'src/modules/dishes/entities/dish.entity';
import { Ingredient } from 'src/modules/ingredients/entities/ingredient.entity';
import { PrintSettingsDto, UpdatePrintSettingsDto } from './dto/print-settings.dto';
import { RestaurantStatsDto } from './dto/restaurant-stats.dto';
import { RestaurantUserDto } from './dto/restaurant-user.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { RestaurantUser } from './entities/restaurant-user.entity';
import { AuditService, type AuditContext } from 'src/modules/audit/audit.service';
import { UploadsService } from 'src/modules/uploads/uploads.service';
import { Restaurant } from './entities/restaurant.entity';
import {
  generateKitchenCode,
  isWellFormedKitchenCode,
  normaliseKitchenCode,
} from './kitchen-code';

@Injectable()
export class RestaurantsService {
  constructor(
    @InjectRepository(Restaurant)
    private readonly restaurantsRepository: Repository<Restaurant>,
    @InjectRepository(RestaurantUser)
    private readonly membershipsRepository: Repository<RestaurantUser>,
    @InjectRepository(Category)
    private readonly categoriesRepository: Repository<Category>,
    @InjectRepository(Dish)
    private readonly dishesRepository: Repository<Dish>,
    @InjectRepository(Ingredient)
    private readonly ingredientsRepository: Repository<Ingredient>,
    private readonly auditService: AuditService,
    private readonly uploadsService: UploadsService,
  ) {}

  async findById(id: number): Promise<Restaurant> {
    const restaurant = await this.restaurantsRepository.findOne({ where: { id } });

    if (!restaurant) {
      throw new NotFoundException(`Restaurant ${id} was not found.`);
    }

    return restaurant;
  }

  /**
   * Builds a slug that does not collide with any other restaurant.
   *
   * `slug` and `publicSlug` share one namespace: a value that is another
   * restaurant's current slug *or* permanent public slug is taken, so a menu URL
   * can never match two restaurants. The restaurant being renamed
   * (`ownRestaurantId`) does not block itself - renaming back to its original
   * name reclaims its own slug instead of getting a `-2` suffix.
   *
   * Only rows starting with the base are loaded (both columns are indexed). The
   * unique indexes remain the real guarantee - a concurrent insert that wins the
   * race surfaces as a 409 from the exception filter.
   */
  async generateUniqueSlug(
    name: string,
    manager?: EntityManager,
    ownRestaurantId?: number,
  ): Promise<string> {
    const repository = manager ? manager.getRepository(Restaurant) : this.restaurantsRepository;
    const base = slugify(name);

    const conflicts = await repository.find({
      where: [{ slug: Like(`${base}%`) }, { publicSlug: Like(`${base}%`) }],
      select: { id: true, slug: true, publicSlug: true },
    });

    return uniqueSlug(
      base,
      conflicts
        .filter((row) => row.id !== ownRestaurantId)
        .flatMap((row) => [row.slug, row.publicSlug]),
    );
  }

  /** Creates the restaurant row. Called inside the registration transaction. */
  async createRestaurant(
    input: { name: string; address?: string | null; phone?: string | null; taxNumber?: string | null },
    manager: EntityManager,
  ): Promise<Restaurant> {
    const repository = manager.getRepository(Restaurant);
    const name = input.name.trim();
    const slug = await this.generateUniqueSlug(name, manager);

    const restaurant = repository.create({
      name,
      slug,
      // Fixed for the life of the restaurant; nothing ever writes it again.
      publicSlug: slug,
      address: input.address?.trim() || null,
      phone: input.phone?.trim() || null,
      status: RestaurantStatus.ACTIVE,
      // A new restaurant bills exactly what its menu says until an owner
      // configures tax, so this is 0 rather than any regional default.
      taxRate: 0,
      // Set when Plateo opens the account for a restaurant that is already
      // registered, so its very first bill is a valid tax invoice. A bill
      // issued without it is not one, and reissuing a week of them because a
      // profile field went unfilled is a bad first week.
      taxNumber: input.taxNumber?.trim() || null,
      kitchenCode: await this.unusedKitchenCode(manager),
    });

    return repository.save(restaurant);
  }

  /**
   * A kitchen code no other restaurant holds.
   *
   * The unique index is the real guarantee; this only avoids handing back a code
   * that is already taken, which at 887 million possibilities is rare enough that
   * a handful of attempts is plenty.
   */
  private async unusedKitchenCode(manager?: EntityManager): Promise<string> {
    const repository = manager ? manager.getRepository(Restaurant) : this.restaurantsRepository;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateKitchenCode();

      if (!(await repository.exists({ where: { kitchenCode: code } }))) return code;
    }

    throw new ConflictException('Could not allocate a kitchen code. Please try again.');
  }

  /** The restaurant a kitchen code belongs to, or null. Codes are case-insensitive. */
  async findByKitchenCode(code: string): Promise<Restaurant | null> {
    const normalised = normaliseKitchenCode(code);

    if (!isWellFormedKitchenCode(normalised)) return null;

    const restaurant = await this.restaurantsRepository.findOne({
      where: { kitchenCode: normalised },
    });

    // Exact comparison as well: SQLite (tests) and a case-insensitive MySQL
    // collation would both otherwise let a near-miss through.
    return restaurant?.kitchenCode === normalised ? restaurant : null;
  }

  /** The current kitchen code, for the owner to read off and type into a screen. */
  async kitchenCode(restaurantId: number): Promise<string> {
    return (await this.findById(restaurantId)).kitchenCode;
  }

  /**
   * Issues a new code and retires the old one immediately.
   *
   * This is how a restaurant removes a screen it no longer controls - a tablet
   * that walked out of the kitchen - so the old code has to stop working at once
   * rather than when some session expires.
   */
  async regenerateKitchenCode(
    restaurantId: number,
    userId?: number,
    context?: AuditContext,
  ): Promise<string> {
    const restaurant = await this.findById(restaurantId);

    restaurant.kitchenCode = await this.unusedKitchenCode();
    await this.restaurantsRepository.save(restaurant);

    // Neither the old code nor the new one is recorded: the code is the kitchen's
    // credential, and a log holding it would hand kitchen access to anyone who
    // can read the log. That it changed, and when, is the auditable fact.
    await this.auditService.record({
      restaurantId,
      userId: userId ?? null,
      action: AuditAction.KITCHEN_CODE_REGENERATED,
      entityType: AuditEntity.RESTAURANT,
      entityId: restaurantId,
      reason: 'Previous kitchen screens signed out',
      context,
    });

    return restaurant.kitchenCode;
  }

  // --- What goes on the printed bill ------------------------------------

  async getPrintSettings(restaurantId: number): Promise<PrintSettingsDto> {
    return toPrintSettings(await this.findById(restaurantId));
  }

  /**
   * Changes the label under the QR, or whether it is printed at all.
   *
   * The image itself is not settable here: it arrives as a file and is stored by
   * us, so there is no way for a caller to point a bill at a URL of their
   * choosing. See `setPaymentQr`.
   */
  async updatePrintSettings(
    restaurantId: number,
    dto: UpdatePrintSettingsDto,
    userId: number,
    context: AuditContext,
  ): Promise<PrintSettingsDto> {
    const restaurant = await this.findById(restaurantId);
    const wasPrinting = restaurant.printPaymentQr;

    if (dto.paymentQrLabel !== undefined) {
      restaurant.paymentQrLabel = dto.paymentQrLabel === '' ? null : dto.paymentQrLabel;
    }

    if (dto.printPaymentQr !== undefined) {
      // Switching it on with nothing to print is the one combination that would
      // silently do nothing, so it is refused rather than stored.
      if (dto.printPaymentQr && !restaurant.paymentQrUrl) {
        throw new ConflictException('Upload a payment QR before switching printing on.');
      }

      restaurant.printPaymentQr = dto.printPaymentQr;
    }

    if (dto.paperWidthMm !== undefined) {
      restaurant.printPaperWidthMm = dto.paperWidthMm;
    }

    await this.restaurantsRepository.save(restaurant);

    if (dto.printPaymentQr !== undefined && dto.printPaymentQr !== wasPrinting) {
      await this.recordQrChange(
        restaurantId,
        userId,
        dto.printPaymentQr ? 'Printing on bills switched on' : 'Printing on bills switched off',
        context,
      );
    }

    return toPrintSettings(restaurant);
  }

  /**
   * Stores an uploaded payment code and puts it on the restaurant.
   *
   * One step on purpose. A dish photo is uploaded first and saved second, so a
   * half-filled form never changes the live menu - but a payment code has no
   * form, and splitting it would mean accepting a URL from the caller. The
   * difference matters: this image tells a guest where to send money, and an
   * endpoint that took any URL would let whoever reached it print their own.
   */
  async setPaymentQr(
    restaurantId: number,
    file: Express.Multer.File,
    userId: number,
    context: AuditContext,
  ): Promise<PrintSettingsDto> {
    const restaurant = await this.findById(restaurantId);
    const previous = restaurant.paymentQrUrl;

    const stored = await this.uploadsService.storePaymentQr(restaurantId, file);

    restaurant.paymentQrUrl = stored.url;
    await this.restaurantsRepository.save(restaurant);

    // Only once the new code is safely the live one. The other order leaves a
    // restaurant with no QR at all if the upload fails.
    await this.uploadsService.removeStored(previous);

    await this.recordQrChange(
      restaurantId,
      userId,
      previous ? 'Payment QR replaced' : 'Payment QR added',
      context,
    );

    return toPrintSettings(restaurant);
  }

  /**
   * Stores the restaurant's logo and puts it on the profile.
   *
   * One step, like the payment code: the endpoint takes a file and never a URL,
   * so nothing can point a printed bill at an image somebody else controls.
   */
  async setLogo(
    restaurantId: number,
    file: Express.Multer.File,
    userId: number,
    context: AuditContext,
  ): Promise<PrintSettingsDto> {
    const restaurant = await this.findById(restaurantId);
    const previous = restaurant.logoUrl;

    const stored = await this.uploadsService.storeLogo(restaurantId, file);

    restaurant.logoUrl = stored.url;
    await this.restaurantsRepository.save(restaurant);

    // Only once the new logo is safely the live one.
    await this.uploadsService.removeStored(previous);

    await this.recordQrChange(
      restaurantId,
      userId,
      previous ? 'Bill logo replaced' : 'Bill logo added',
      context,
    );

    return toPrintSettings(restaurant);
  }

  /** Removes the logo. Bills fall back to printing the restaurant's name alone. */
  async clearLogo(
    restaurantId: number,
    userId: number,
    context: AuditContext,
  ): Promise<PrintSettingsDto> {
    const restaurant = await this.findById(restaurantId);
    const previous = restaurant.logoUrl;

    restaurant.logoUrl = null;
    await this.restaurantsRepository.save(restaurant);
    await this.uploadsService.removeStored(previous);

    if (previous) {
      await this.recordQrChange(restaurantId, userId, 'Bill logo removed', context);
    }

    return toPrintSettings(restaurant);
  }

  /** Removes the code and stops printing it - there is nothing left to print. */
  async clearPaymentQr(
    restaurantId: number,
    userId: number,
    context: AuditContext,
  ): Promise<PrintSettingsDto> {
    const restaurant = await this.findById(restaurantId);
    const previous = restaurant.paymentQrUrl;

    restaurant.paymentQrUrl = null;
    restaurant.printPaymentQr = false;
    await this.restaurantsRepository.save(restaurant);

    await this.uploadsService.removeStored(previous);

    if (previous) {
      await this.recordQrChange(restaurantId, userId, 'Payment QR removed', context);
    }

    return toPrintSettings(restaurant);
  }

  /**
   * Records that the code changed, never what it was.
   *
   * The URL is deliberately left out. An audit trail that carried it would be a
   * list of payment codes, and the question an owner actually asks months later
   * is who changed it and when.
   */
  private recordQrChange(
    restaurantId: number,
    userId: number,
    reason: string,
    context: AuditContext,
  ): Promise<unknown> {
    return this.auditService.record({
      restaurantId,
      userId,
      action: AuditAction.PAYMENT_QR_CHANGED,
      entityType: AuditEntity.RESTAURANT,
      entityId: restaurantId,
      reason,
      context,
    });
  }

  /** Links a user to a restaurant. The unique index blocks duplicate links. */
  async addMember(
    userId: number,
    restaurantId: number,
    manager?: EntityManager,
  ): Promise<RestaurantUser> {
    const repository = manager
      ? manager.getRepository(RestaurantUser)
      : this.membershipsRepository;

    const existing = await repository.findOne({ where: { userId, restaurantId } });

    if (existing) {
      throw new ConflictException('This user is already a member of the restaurant.');
    }

    return repository.save(repository.create({ userId, restaurantId }));
  }

  /** The membership check every authenticated request runs. */
  async isMember(userId: number, restaurantId: number): Promise<boolean> {
    const count = await this.membershipsRepository.count({ where: { userId, restaurantId } });
    return count > 0;
  }

  /**
   * Resolves the tenant for an authenticated request: the restaurant behind a
   * live membership, in one round trip.
   *
   * Returns `null` when the membership has been revoked, so the caller can
   * reject the token immediately rather than waiting for it to expire. The
   * restaurant is returned rather than a boolean so the caller can also act on
   * `status` without a second query.
   */
  async findMembershipRestaurant(userId: number, restaurantId: number): Promise<Restaurant | null> {
    const membership = await this.membershipsRepository.findOne({
      where: { userId, restaurantId },
      relations: { restaurant: true },
    });

    return membership?.restaurant ?? null;
  }

  /** Restaurants the user may act on, used for the post-login tenant picker. */
  async findRestaurantsForUser(userId: number): Promise<Restaurant[]> {
    const memberships = await this.membershipsRepository.find({
      where: { userId },
      order: { id: 'ASC' },
    });

    if (memberships.length === 0) {
      return [];
    }

    return this.restaurantsRepository.find({
      where: { id: In(memberships.map((membership) => membership.restaurantId)) },
      order: { name: 'ASC' },
    });
  }

  /**
   * Updates the active restaurant's profile. Renaming regenerates `slug`, the
   * canonical menu URL that tracks the display name. `publicSlug` is never
   * touched, so QR codes and links already handed out keep working.
   */
  async updateRestaurant(
    restaurantId: number,
    dto: UpdateRestaurantDto,
    actorRole: UserRole,
  ): Promise<Restaurant> {
    const restaurant = await this.findById(restaurantId);

    // Suspension is a platform action. Letting an owner set INACTIVE would lock
    // their entire team out permanently - an inactive tenant rejects both login
    // and existing tokens, and only SUPER_ADMIN can reach it to undo.
    if (
      dto.status !== undefined &&
      dto.status !== restaurant.status &&
      actorRole !== UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        'Restaurant status is managed by Plateo support. Contact support to change it.',
      );
    }

    if (dto.name !== undefined && dto.name !== restaurant.name) {
      restaurant.name = dto.name;
      restaurant.slug = await this.generateUniqueSlug(dto.name, undefined, restaurant.id);
    }

    if (dto.description !== undefined) restaurant.description = dto.description || null;
    if (dto.address !== undefined) restaurant.address = dto.address || null;
    if (dto.phone !== undefined) restaurant.phone = dto.phone || null;
    if (dto.logoUrl !== undefined) restaurant.logoUrl = dto.logoUrl || null;
    if (dto.taxRate !== undefined) restaurant.taxRate = dto.taxRate;
    // An empty string clears the number; the column is nullable, not blank.
    if (dto.taxNumber !== undefined) restaurant.taxNumber = dto.taxNumber || null;
    if (dto.status !== undefined) restaurant.status = dto.status;

    return this.restaurantsRepository.save(restaurant);
  }

  /** Members of the restaurant. Password hashes are never selected. */
  async findMembers(restaurantId: number): Promise<RestaurantUserDto[]> {
    const memberships = await this.membershipsRepository.find({
      where: { restaurantId },
      relations: { user: true },
      order: { createdAt: 'ASC' },
    });

    return memberships.map((membership) => ({
      id: membership.user.id,
      name: membership.user.name,
      email: membership.user.email,
      role: membership.user.role,
      joinedAt: membership.createdAt,
    }));
  }

  /** Dashboard counters, each scoped to the active restaurant. */
  async getStats(restaurantId: number): Promise<RestaurantStatsDto> {
    const restaurant = await this.findById(restaurantId);

    const [
      totalCategories,
      activeCategories,
      totalDishes,
      availableDishes,
      totalIngredients,
      totalUsers,
    ] = await Promise.all([
      this.categoriesRepository.count({ where: { restaurantId } }),
      this.categoriesRepository.count({ where: { restaurantId, isActive: true } }),
      this.dishesRepository.count({ where: { restaurantId } }),
      this.dishesRepository.count({ where: { restaurantId, isAvailable: true } }),
      this.ingredientsRepository.count({ where: { restaurantId } }),
      this.membershipsRepository.count({ where: { restaurantId } }),
    ]);

    return {
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      status: restaurant.status,
      totalCategories,
      activeCategories,
      totalDishes,
      availableDishes,
      totalIngredients,
      totalUsers,
    };
  }
}

/** The three printed-bill fields, without the rest of the restaurant row. */
function toPrintSettings(restaurant: Restaurant): PrintSettingsDto {
  return {
    logoUrl: restaurant.logoUrl,
    paymentQrUrl: restaurant.paymentQrUrl,
    paymentQrLabel: restaurant.paymentQrLabel,
    printPaymentQr: restaurant.printPaymentQr,
    paperWidthMm: restaurant.printPaperWidthMm,
  };
}
