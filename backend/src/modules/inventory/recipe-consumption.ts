import { IngredientUnit } from 'src/common/enums';
import { convertQuantity, IncompatibleUnitsError, roundQuantity } from './inventory-units';

/**
 * Working out what a bill took off the shelves.
 *
 * Deliberately pure: given lines sold and the recipes behind them, it returns
 * quantities. No database, no transaction, no clock. Everything about this
 * calculation that can be wrong can therefore be tested directly, which matters
 * because it is the part a restaurant will check against a physical count and
 * believe or not believe.
 *
 * It never throws on bad data. A recipe line nobody can interpret must not stop a
 * bill being settled - the food has already been eaten - so unusable lines come
 * back as `skipped`, with a reason a person can read, and the sale goes through.
 */

/**
 * The unit text on an existing recipe line, read as a unit if possible.
 *
 * `dish_ingredients.unit` has been free text since long before stock tracking:
 * real rows say `g`, `gm`, `ml`, `piece`, and also `tbsp` and `to taste`. Those
 * last ones have no fixed size - a tablespoon of salt and a tablespoon of cream
 * are different weights - so they are returned as null rather than guessed at.
 *
 * Lines written through the inventory screen store the enum value itself, which
 * this accepts too, so both generations of row work.
 */
export function parseRecipeUnit(text: string | null | undefined): IngredientUnit | null {
  if (!text) return null;

  switch (text.trim().toLowerCase()) {
    case 'kg':
    case 'kgs':
    case 'kilo':
    case 'kilos':
    case 'kilogram':
    case 'kilograms':
      return IngredientUnit.KG;
    case 'g':
    case 'gm':
    case 'gms':
    case 'gram':
    case 'grams':
      return IngredientUnit.GRAM;
    case 'l':
    case 'ltr':
    case 'ltrs':
    case 'litre':
    case 'litres':
    case 'liter':
    case 'liters':
      return IngredientUnit.LITRE;
    case 'ml':
    case 'mls':
    case 'millilitre':
    case 'millilitres':
      return IngredientUnit.ML;
    case 'pc':
    case 'pcs':
    case 'no':
    case 'nos':
    case 'piece':
    case 'pieces':
    case 'unit':
    case 'units':
      return IngredientUnit.PIECE;
    case 'pack':
    case 'packs':
    case 'packet':
    case 'packets':
      return IngredientUnit.PACK;
    case 'box':
    case 'boxes':
      return IngredientUnit.BOX;
    case 'bottle':
    case 'bottles':
      return IngredientUnit.BOTTLE;
    default:
      // tbsp, tsp, pinch, "to taste", a handful - all real entries, none of them
      // a fixed quantity.
      return null;
  }
}

/** One dish sold, and how many of it. */
export interface SoldLine {
  dishId: number;
  dishName: string;
  quantity: number;
}

/** One line of a recipe, as it is stored. */
export interface RecipeLine {
  dishId: number;
  ingredientId: number;
  ingredientName: string;
  /** What the recipe says, which may not be a unit anybody can measure. */
  quantity: number;
  recipeUnit: string;
  /** The unit the ingredient is stocked in. */
  stockUnit: IngredientUnit;
  costPerUnitPaise: number;
}

export interface RequiredQuantity {
  ingredientId: number;
  ingredientName: string;
  /** Total needed, in the ingredient's own stocking unit. */
  quantity: number;
  unit: IngredientUnit;
  /** What that much was worth, in whole paise, at today's cost. */
  valuePaise: number;
}

export interface SkippedLine {
  dishId: number;
  dishName: string;
  ingredientId: number;
  ingredientName: string;
  reason: string;
}

export interface ConsumptionPlan {
  required: RequiredQuantity[];
  skipped: SkippedLine[];
}

/**
 * What the sold lines need, totalled per ingredient.
 *
 * Totalled, not listed per dish: two dishes both using onion produce one movement
 * for onion, because the ledger answers "where did the onions go" and ten rows of
 * forty grams answers it worse than one row of four hundred.
 *
 * A dish with no recipe contributes nothing and is not an error - most restaurants
 * will write recipes for their main dishes and never bother for a bottle of water.
 */
export function planConsumption(sold: SoldLine[], recipes: RecipeLine[]): ConsumptionPlan {
  const byIngredient = new Map<number, RequiredQuantity>();
  const skipped: SkippedLine[] = [];

  const recipesByDish = new Map<number, RecipeLine[]>();
  for (const line of recipes) {
    const existing = recipesByDish.get(line.dishId);
    if (existing) existing.push(line);
    else recipesByDish.set(line.dishId, [line]);
  }

  for (const soldLine of sold) {
    const recipe = recipesByDish.get(soldLine.dishId);
    if (!recipe || recipe.length === 0) continue;

    for (const line of recipe) {
      const recipeUnit = parseRecipeUnit(line.recipeUnit);

      if (!recipeUnit) {
        skipped.push({
          dishId: soldLine.dishId,
          dishName: soldLine.dishName,
          ingredientId: line.ingredientId,
          ingredientName: line.ingredientName,
          reason:
            `The recipe asks for ${line.quantity} ${line.recipeUnit} of ${line.ingredientName}, ` +
            `which is not a measurable amount. Change it to a weight, a volume or a count to ` +
            `have it deducted from stock.`,
        });
        continue;
      }

      let perDish: number;
      try {
        perDish = convertQuantity(line.quantity, recipeUnit, line.stockUnit);
      } catch (error) {
        if (!(error instanceof IncompatibleUnitsError)) throw error;

        skipped.push({
          dishId: soldLine.dishId,
          dishName: soldLine.dishName,
          ingredientId: line.ingredientId,
          ingredientName: line.ingredientName,
          reason: error.message,
        });
        continue;
      }

      // Multiplied after the conversion, not before: converting once per recipe
      // line and scaling keeps the rounding in one place.
      const needed = roundQuantity(perDish * soldLine.quantity);
      const existing = byIngredient.get(line.ingredientId);

      if (existing) {
        existing.quantity = roundQuantity(existing.quantity + needed);
      } else {
        byIngredient.set(line.ingredientId, {
          ingredientId: line.ingredientId,
          ingredientName: line.ingredientName,
          quantity: needed,
          unit: line.stockUnit,
          valuePaise: 0,
        });
      }
    }
  }

  // Costed once, on the total. Costing each dish's share and adding the results
  // would round several times and drift away from quantity x cost.
  const costs = new Map<number, number>();
  for (const line of recipes) costs.set(line.ingredientId, line.costPerUnitPaise);

  const required = [...byIngredient.values()].filter((entry) => entry.quantity > 0);
  for (const entry of required) {
    entry.valuePaise = Math.round(entry.quantity * (costs.get(entry.ingredientId) ?? 0));
  }

  return { required, skipped };
}
