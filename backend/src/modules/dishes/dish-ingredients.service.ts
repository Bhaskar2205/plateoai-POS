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
import { canConvert, recipeLineCostPaise, UNIT_LABELS } from 'src/modules/inventory/inventory-units';
import { parseRecipeUnit } from 'src/modules/inventory/recipe-consumption';
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
      ...DishIngredientsService.costOf(row),
    };
  }

  /**
   * What one recipe line costs, at today's ingredient cost.
   *
   * Worked out on read rather than stored, because a stored dish cost would go
   * stale the moment a supplier changed their price and nobody would know which
   * figures were old. A settled bill is a different matter: it keeps the cost
   * recorded on its movements and is never recalculated.
   *
   * Returns a note instead of a number when it genuinely cannot be worked out,
   * which is better than a zero that reads as "free".
   */
  private static costOf(row: DishIngredient): { costPaise: number | null; costNote: string | null } {
    const ingredient = row.ingredient;

    if (!ingredient) return { costPaise: null, costNote: null };

    const recipeUnit = parseRecipeUnit(row.unit);

    if (!recipeUnit) {
      return {
        costPaise: null,
        costNote: `${row.unit} is not a fixed amount, so this line cannot be costed or deducted from stock.`,
      };
    }

    if (!canConvert(recipeUnit, ingredient.unit)) {
      return {
        costPaise: null,
        costNote: `This line is in ${row.unit} but ${ingredient.name} is stocked in ${UNIT_LABELS[ingredient.unit]}, which cannot be compared.`,
      };
    }

    const cost = Number(ingredient.costPerUnitPaise);

    if (cost === 0) {
      return {
        costPaise: 0,
        costNote: `No cost has been recorded for ${ingredient.name} yet.`,
      };
    }

    return {
      costPaise: recipeLineCostPaise(row.quantity, recipeUnit, ingredient.unit, cost),
      costNote: null,
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
