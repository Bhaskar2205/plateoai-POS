import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { IngredientsService } from 'src/modules/ingredients/ingredients.service';
import { DishIngredientInputDto } from './dto/dish-ingredients.dto';
import { DishIngredient } from './entities/dish-ingredient.entity';

/**
 * Recipe-line persistence shared by `DishesService` (dish + recipe in one
 * request) and `DishIngredientsService` (recipe-only endpoints).
 *
 * Every write function takes the transaction's `EntityManager`, so callers
 * decide the transaction boundary and a dish is never visible with a
 * half-written recipe.
 */

/**
 * Rejects the whole payload if an ingredient is listed twice, unknown, or owned
 * by another restaurant. Unknown and foreign ids produce the same error, so the
 * API never confirms that another tenant's id exists.
 */
export async function assertIngredientsOwned(
  ingredientsService: IngredientsService,
  restaurantId: number,
  lines: DishIngredientInputDto[],
): Promise<void> {
  const ids = [...new Set(lines.map((line) => line.ingredientId))];

  if (ids.length !== lines.length) {
    throw new BadRequestException('The same ingredient was listed more than once.');
  }

  if (ids.length === 0) {
    return;
  }

  const owned = await ingredientsService.findAllByIdsInRestaurant(restaurantId, ids);

  if (owned.length !== ids.length) {
    const ownedIds = new Set(owned.map((ingredient) => ingredient.id));
    const missing = ids.filter((id) => !ownedIds.has(id));

    throw new BadRequestException(
      `These ingredients do not belong to this restaurant: ${missing.join(', ')}.`,
    );
  }
}

/** Replaces a dish's recipe with exactly `lines`. An empty list clears it. */
export async function replaceRecipe(
  manager: EntityManager,
  dishId: number,
  lines: DishIngredientInputDto[],
): Promise<void> {
  const repository = manager.getRepository(DishIngredient);

  await repository.delete({ dishId });

  if (lines.length > 0) {
    await repository.save(
      lines.map((line) =>
        repository.create({
          dishId,
          ingredientId: line.ingredientId,
          quantity: line.quantity,
          unit: line.unit,
        }),
      ),
    );
  }
}

/** Adds lines to a recipe, updating quantity and unit for ingredients already on it. */
export async function upsertRecipeLines(
  manager: EntityManager,
  dishId: number,
  lines: DishIngredientInputDto[],
): Promise<void> {
  const repository = manager.getRepository(DishIngredient);
  const existing = await repository.find({ where: { dishId } });
  const byIngredientId = new Map(existing.map((row) => [row.ingredientId, row]));

  for (const line of lines) {
    const current = byIngredientId.get(line.ingredientId);

    if (current) {
      current.quantity = line.quantity;
      current.unit = line.unit;
      await repository.save(current);
    } else {
      await repository.save(
        repository.create({
          dishId,
          ingredientId: line.ingredientId,
          quantity: line.quantity,
          unit: line.unit,
        }),
      );
    }
  }
}
