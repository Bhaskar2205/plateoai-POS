import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Like, Repository } from 'typeorm';
import { RestaurantStatus, UserRole } from 'src/common/enums';
import { slugify, uniqueSlug } from 'src/common/utils/slug.util';
import { Category } from 'src/modules/categories/entities/category.entity';
import { Dish } from 'src/modules/dishes/entities/dish.entity';
import { Ingredient } from 'src/modules/ingredients/entities/ingredient.entity';
import { RestaurantStatsDto } from './dto/restaurant-stats.dto';
import { RestaurantUserDto } from './dto/restaurant-user.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { RestaurantUser } from './entities/restaurant-user.entity';
import { Restaurant } from './entities/restaurant.entity';

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
    input: { name: string; address?: string | null; phone?: string | null },
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
    });

    return repository.save(restaurant);
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
