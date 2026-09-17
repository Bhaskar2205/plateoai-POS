import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { IngredientsService } from 'src/modules/ingredients/ingredients.service';
import { assertIngredientsOwned, replaceRecipe, upsertRecipeLines } from './dish-recipe.writer';
import { DishesService } from './dishes.service';
import {
  DishIngredientInputDto,
  DishIngredientResponseDto,
} from './dto/dish-ingredients.dto';
import { DishIngredient } from './entities/dish-ingredient.entity';

/**
 * Recipe mapping between dishes and ingredients.
 *
 * Both ends are tenant-checked on every call: the dish must belong to the
 * active restaurant, and so must every ingredient in the payload. Without the
 * second check a restaurant could attach a competitor's ingredient row to its
 * own dish and read that row back through `GET /dishes/:id/ingredients`.
 */
@Injectable()
export class DishIngredientsService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(DishIngredient)
    private readonly dishIngredientsRepository: Repository<DishIngredient>,
    private readonly dishesService: DishesService,
    private readonly ingredientsService: IngredientsService,
  ) {}

  async findForDish(restaurantId: number, dishId: number): Promise<DishIngredientResponseDto[]> {
    await this.dishesService.getOwnedDish(restaurantId, dishId);

    const rows = await this.dishIngredientsRepository.find({
      where: { dishId },
      relations: { ingredient: true },
      order: { id: 'ASC' },
    });

    return rows.map((row) => DishIngredientsService.toResponse(row));
  }

  /**
   * Adds ingredients to a dish, updating the quantity of any that are already
   * mapped. Runs in a transaction so a partly-applied list is never persisted.
   */
  async addToDish(
    restaurantId: number,
    dishId: number,
    ingredients: DishIngredientInputDto[],
  ): Promise<DishIngredientResponseDto[]> {
    await this.dishesService.getOwnedDish(restaurantId, dishId);
    await assertIngredientsOwned(this.ingredientsService, restaurantId, ingredients);

    await this.dataSource.transaction((manager) => upsertRecipeLines(manager, dishId, ingredients));

    return this.findForDish(restaurantId, dishId);
  }

  /**
   * Replaces the dish's recipe with exactly the supplied list. The delete and
   * the inserts share one transaction, so the dish never appears with an empty
   * or half-written recipe.
   */
  async replaceForDish(
    restaurantId: number,
    dishId: number,
    ingredients: DishIngredientInputDto[],
  ): Promise<DishIngredientResponseDto[]> {
    await this.dishesService.getOwnedDish(restaurantId, dishId);
    await assertIngredientsOwned(this.ingredientsService, restaurantId, ingredients);

    await this.dataSource.transaction((manager) => replaceRecipe(manager, dishId, ingredients));

    return this.findForDish(restaurantId, dishId);
  }

  async removeFromDish(restaurantId: number, dishId: number, ingredientId: number): Promise<void> {
    await this.dishesService.getOwnedDish(restaurantId, dishId);

    const row = await this.dishIngredientsRepository.findOne({ where: { dishId, ingredientId } });

    if (!row) {
      throw new NotFoundException(`Ingredient ${ingredientId} is not mapped to dish ${dishId}.`);
    }

    await this.dishIngredientsRepository.remove(row);
  }

  private static toResponse(row: DishIngredient): DishIngredientResponseDto {
    return {
      id: row.id,
      dishId: row.dishId,
      ingredientId: row.ingredientId,
      ingredientName: row.ingredient?.name ?? '',
      allergenInfo: row.ingredient?.allergenInfo ?? null,
      quantity: row.quantity,
      unit: row.unit,
    };
  }

  /** Recipe lines for several dishes at once - used by the menu list view. */
  async findForDishes(dishIds: number[]): Promise<Map<number, DishIngredientResponseDto[]>> {
    const result = new Map<number, DishIngredientResponseDto[]>();

    if (dishIds.length === 0) {
      return result;
    }

    const rows = await this.dishIngredientsRepository.find({
      where: { dishId: In(dishIds) },
      relations: { ingredient: true },
      order: { id: 'ASC' },
    });

    for (const row of rows) {
      const list = result.get(row.dishId) ?? [];
      list.push(DishIngredientsService.toResponse(row));
      result.set(row.dishId, list);
    }

    return result;
  }
}
