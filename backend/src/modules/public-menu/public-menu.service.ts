import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Category } from 'src/modules/categories/entities/category.entity';
import { DishIngredient } from 'src/modules/dishes/entities/dish-ingredient.entity';
import { Dish } from 'src/modules/dishes/entities/dish.entity';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { RestaurantTable } from 'src/modules/tables/entities/restaurant-table.entity';
import { resolveActiveRestaurant, resolveActiveTable } from './public-lookup';
import { UploadsService } from 'src/modules/uploads/uploads.service';
import { PublicMenuCache } from './public-menu.cache';
import {
  PublicDishDto,
  PublicIngredientDto,
  PublicMenuDto,
  PublicNutritionDto,
} from './dto/public-menu.dto';

export const PUBLIC_MENU_DISCLAIMER =
  'Nutrition and allergen information is provided by the restaurant and has not been verified by ' +
  'Plateo. Please ask staff about allergies before ordering.';

/**
 * Builds the anonymous, read-only view of a restaurant's menu.
 *
 * Visibility rules, applied in the queries themselves rather than after the fact:
 *  - the restaurant must be ACTIVE (suspended looks identical to unknown: 404);
 *  - categories must be active, and are omitted when they have no available dish;
 *  - dishes must be available, and a dish in an inactive category is hidden with it;
 *  - recipe lines are re-checked to belong to the same restaurant;
 *  - a requested table must exist, belong to this restaurant and be active.
 *
 * At most five indexed queries, whatever the menu size - no per-dish lookups.
 */
@Injectable()
export class PublicMenuService {
  constructor(
    @InjectRepository(Restaurant)
    private readonly restaurantsRepository: Repository<Restaurant>,
    @InjectRepository(Category)
    private readonly categoriesRepository: Repository<Category>,
    @InjectRepository(Dish)
    private readonly dishesRepository: Repository<Dish>,
    @InjectRepository(DishIngredient)
    private readonly dishIngredientsRepository: Repository<DishIngredient>,
    @InjectRepository(RestaurantTable)
    private readonly tablesRepository: Repository<RestaurantTable>,
    private readonly cache: PublicMenuCache,
    private readonly uploadsService: UploadsService,
  ) {}

  /**
   * Menu builds currently running, by cache key.
   *
   * Not a cache - entries live only as long as the query they stand for. It exists
   * so simultaneous scans of the same menu wait on one read instead of each making
   * their own.
   */
  private readonly inFlight = new Map<string, Promise<PublicMenuDto>>();

  /** `table` is the raw `?table=` value: absent, a string, or whatever a client sent. */
  async getMenu(slug: string, table?: unknown): Promise<PublicMenuDto> {
    // Served from the cache when a scan in the last few seconds asked for the same
    // menu, which during a rush is nearly all of them. Any edit to the menu throws
    // the cache away (see MenuCacheSubscriber), so this never serves a dish the
    // kitchen has just marked sold out.
    const key = PublicMenuCache.keyFor(slug, table);
    const cached = this.cache.get(key);

    if (cached) return cached;

    // A hundred and fifty people scanning in the same second all miss an empty
    // cache, so without this they would all run the same queries and the cache
    // would have saved nothing - measured, and it was in fact slightly slower than
    // no cache at all. Sharing the in-flight promise turns the whole rush into one
    // database read, which is the entire point.
    const inFlight = this.inFlight.get(key);

    if (inFlight) return inFlight;

    const build = this.buildMenu(slug, table)
      .then((menu) => {
        this.cache.set(key, menu);

        return menu;
      })
      // Cleared whether it resolved or threw. Leaving a rejected promise here
      // would make one failed lookup permanent for this slug.
      .finally(() => this.inFlight.delete(key));

    this.inFlight.set(key, build);

    return build;
  }

  /**
   * Reads the menu from the database.
   *
   * A 404 - unknown restaurant, unknown table - throws out of here and is never
   * cached: a restaurant that has just been created should work on its first scan,
   * and the throttle already bounds slug guessing.
   */
  private async buildMenu(slug: string, table?: unknown): Promise<PublicMenuDto> {
    const restaurant = await resolveActiveRestaurant(this.restaurantsRepository, slug);
    const publicTable =
      table === undefined
        ? null
        : { name: (await resolveActiveTable(this.tablesRepository, restaurant.id, table)).name };

    const [categories, dishes] = await Promise.all([
      this.categoriesRepository.find({
        where: { restaurantId: restaurant.id, isActive: true },
        order: { sortOrder: 'ASC', name: 'ASC' },
        select: { id: true, name: true },
      }),
      this.dishesRepository.find({
        where: { restaurantId: restaurant.id, isAvailable: true },
        order: { name: 'ASC' },
      }),
    ]);

    const activeCategoryIds = new Set(categories.map((category) => category.id));

    // A dish filed under an inactive category is hidden along with the category,
    // rather than silently resurfacing as "uncategorised".
    const visibleDishes = dishes.filter(
      (dish) => dish.categoryId === null || activeCategoryIds.has(dish.categoryId),
    );

    const recipes = await this.loadRecipes(
      restaurant.id,
      visibleDishes.map((dish) => dish.id),
    );

    const toPublic = (dish: Dish) =>
      PublicMenuService.toPublicDish(dish, recipes.get(dish.id) ?? [], (url) =>
        this.uploadsService.thumbnailFor(url),
      );

    return {
      restaurant: {
        name: restaurant.name,
        slug: restaurant.slug,
        description: restaurant.description,
        address: restaurant.address,
        logoUrl: restaurant.logoUrl,
      },
      table: publicTable,
      currency: 'INR',
      categories: categories
        .map((category) => ({
          id: category.id,
          name: category.name,
          dishes: visibleDishes.filter((dish) => dish.categoryId === category.id).map(toPublic),
        }))
        .filter((category) => category.dishes.length > 0),
      uncategorisedDishes: visibleDishes.filter((dish) => dish.categoryId === null).map(toPublic),
      disclaimer: PUBLIC_MENU_DISCLAIMER,
    };
  }

  private async loadRecipes(
    restaurantId: number,
    dishIds: number[],
  ): Promise<Map<number, PublicIngredientDto[]>> {
    const recipes = new Map<number, PublicIngredientDto[]>();

    if (dishIds.length === 0) {
      return recipes;
    }

    const lines = await this.dishIngredientsRepository.find({
      where: { dishId: In(dishIds) },
      relations: { ingredient: true },
      order: { id: 'ASC' },
    });

    for (const line of lines) {
      // Defence in depth: writes already reject foreign ingredients, but a public
      // endpoint should never depend on that alone.
      if (!line.ingredient || line.ingredient.restaurantId !== restaurantId) continue;

      const list = recipes.get(line.dishId) ?? [];
      list.push({
        name: line.ingredient.name,
        allergenInfo: line.ingredient.allergenInfo,
      });
      recipes.set(line.dishId, list);
    }

    return recipes;
  }

  private static toPublicDish(
    dish: Dish,
    ingredients: PublicIngredientDto[],
    thumbnailFor: (url: string) => string,
  ): PublicDishDto {
    const allergens = [
      ...new Set(
        ingredients
          .map((ingredient) => ingredient.allergenInfo?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    ].sort((a, b) => a.localeCompare(b));

    return {
      id: dish.id,
      name: dish.name,
      description: dish.description,
      price: dish.price,
      imageUrl: dish.imageUrl,
      thumbnailUrl: dish.imageUrl ? thumbnailFor(dish.imageUrl) : null,
      preparationTimeMinutes: dish.preparationTimeMinutes,
      dietType: dish.dietType,
      nutrition: PublicMenuService.toNutrition(dish),
      ingredients,
      allergens,
    };
  }

  private static toNutrition(dish: Dish): PublicNutritionDto | null {
    const { calories, proteinGrams, carbsGrams, fatGrams } = dish;

    if ([calories, proteinGrams, carbsGrams, fatGrams].every((value) => value === null)) {
      return null;
    }

    return { calories, proteinGrams, carbsGrams, fatGrams, source: 'RESTAURANT_DECLARED' };
  }


}
