import type { Ingredient, IngredientUnit } from '@/lib/types';

/**
 * What a recipe line costs, worked out in the browser as somebody types.
 *
 * A deliberate duplicate of `backend/src/modules/inventory/inventory-units.ts`
 * and `recipe-consumption.ts`. The server's answer is the one that counts - it is
 * what gets stored on a movement when a bill settles - but a cost that only
 * appears after saving is a cost nobody uses while writing the recipe.
 *
 * The rules it has to agree with:
 *
 *  - only within a family (kg/g, litre/ml), because a litre of oil and a litre
 *    of honey weigh different amounts;
 *  - `tbsp`, `tsp` and `cup` are not fixed quantities of anything, so they are
 *    refused rather than guessed at.
 */

/** Recipe unit text -> a stocking unit, or null when it is not a fixed amount. */
export function parseRecipeUnit(text: string): IngredientUnit | null {
  switch (text.trim().toLowerCase()) {
    case 'kg':
      return 'KG';
    case 'g':
    case 'gm':
    case 'gram':
    case 'grams':
      return 'GRAM';
    case 'l':
    case 'litre':
    case 'liter':
      return 'LITRE';
    case 'ml':
      return 'ML';
    case 'piece':
    case 'pc':
    case 'pcs':
      return 'PIECE';
    case 'pack':
      return 'PACK';
    case 'box':
      return 'BOX';
    case 'bottle':
      return 'BOTTLE';
    default:
      return null;
  }
}

const FAMILY: Record<IngredientUnit, string> = {
  KG: 'weight',
  GRAM: 'weight',
  LITRE: 'volume',
  ML: 'volume',
  PIECE: 'PIECE',
  PACK: 'PACK',
  BOX: 'BOX',
  BOTTLE: 'BOTTLE',
};

const PER_BASE: Record<IngredientUnit, number> = {
  KG: 1000,
  GRAM: 1,
  LITRE: 1000,
  ML: 1,
  PIECE: 1,
  PACK: 1,
  BOX: 1,
  BOTTLE: 1,
};

export interface LineCost {
  /** Whole paise, or null when it cannot be worked out. */
  costPaise: number | null;
  /** Why not, for showing next to the line. */
  note: string | null;
}

export function recipeLineCost(
  quantityText: string,
  unitText: string,
  ingredient: Ingredient | undefined,
): LineCost {
  if (!ingredient) return { costPaise: null, note: null };

  const quantity = Number(quantityText);
  if (quantityText.trim() === '' || !Number.isFinite(quantity) || quantity <= 0) {
    return { costPaise: null, note: null };
  }

  const recipeUnit = parseRecipeUnit(unitText);

  if (!recipeUnit) {
    return {
      costPaise: null,
      note: `${unitText} is not a fixed amount, so this line cannot be costed or taken off stock.`,
    };
  }

  if (FAMILY[recipeUnit] !== FAMILY[ingredient.unit]) {
    return {
      costPaise: null,
      note: `${ingredient.name} is counted in a different kind of unit, so these cannot be compared.`,
    };
  }

  const cost = Number(ingredient.costPerUnitPaise);
  if (cost === 0) return { costPaise: 0, note: `No cost recorded for ${ingredient.name} yet.` };

  const inStockUnits = (quantity * PER_BASE[recipeUnit]) / PER_BASE[ingredient.unit];

  return { costPaise: Math.round(inStockUnits * cost), note: null };
}

/** The recipe unit to start a new line with, given how the ingredient is stocked. */
export function defaultRecipeUnit(ingredient: Ingredient | undefined): string {
  switch (ingredient?.unit) {
    // Recipes are written in the small unit even when stock is held in the large
    // one: nobody writes 0.15 kg of paneer.
    case 'KG':
    case 'GRAM':
      return 'g';
    case 'LITRE':
    case 'ML':
      return 'ml';
    case 'PIECE':
    case 'PACK':
    case 'BOX':
    case 'BOTTLE':
      return 'piece';
    default:
      return 'g';
  }
}
