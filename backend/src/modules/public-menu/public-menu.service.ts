import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { RestaurantStatus } from 'src/common/enums';
import { Category } from 'src/modules/categories/entities/category.entity';
import { DishIngredient } from 'src/modules/dishes/entities/dish-ingredient.entity';
import { Dish } from 'src/modules/dishes/entities/dish.entity';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import {
  PublicDishDto,
  PublicIngredientDto,
  PublicMenuDto,
  PublicNutritionDto,
} from './dto/public-menu.dto';

/** Slugs are generated server-side as lowercase a-z, 0-9 and hyphens. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 190;

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
 *  - recipe lines are re-checked to belong to the same restaurant.
 *
 * Four indexed queries in total, whatever the menu size - no per-dish lookups.
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
  ) {}

  async getMenu(slug: string): Promise<PublicMenuDto> {
    const restaurant = await this.findActiveRestaurant(slug);

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

    const toPublic = (dish: Dish) => PublicMenuService.toPublicDish(dish, recipes.get(dish.id) ?? []);

    return {
      restaurant: {
        name: restaurant.name,
        slug: restaurant.slug,
        description: restaurant.description,
        address: restaurant.address,
        logoUrl: restaurant.logoUrl,
      },
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

  /**
   * Unknown, malformed and suspended restaurants all produce the same 404, so
   * the endpoint cannot be used to discover which slugs exist or are suspended.
   */
  private async findActiveRestaurant(slug: string): Promise<Restaurant> {
    const normalised = slug.trim().toLowerCase();

    if (normalised.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(normalised)) {
      throw PublicMenuService.notFound();
    }

    const restaurant = await this.restaurantsRepository.findOne({
      where: { slug: normalised, status: RestaurantStatus.ACTIVE },
      select: { id: true, name: true, slug: true, description: true, address: true, logoUrl: true },
    });

    if (!restaurant) {
      throw PublicMenuService.notFound();
    }

    return restaurant;
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
        quantity: line.quantity,
        unit: line.unit,
        allergenInfo: line.ingredient.allergenInfo,
      });
      recipes.set(line.dishId, list);
    }

    return recipes;
  }

  private static toPublicDish(dish: Dish, ingredients: PublicIngredientDto[]): PublicDishDto {
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

  private static notFound(): NotFoundException {
    return new NotFoundException('This menu is not available.');
  }
}
