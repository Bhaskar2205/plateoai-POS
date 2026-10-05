import { IngredientUnit } from 'src/common/enums';

/**
 * Converting between the units an ingredient is counted in.
 *
 * Only inside a family: kilograms to grams, litres to millilitres. There is
 * deliberately no gram-to-millilitre rule, because there is no correct one — a
 * litre of oil and a litre of honey weigh different amounts, and a system that
 * guessed would misreport stock in a way nobody would notice until a count.
 *
 * A recipe written in grams against an ingredient held in kilograms is the
 * ordinary case: nobody buys 0.15 kg of paneer, they buy 10 kg and a dish uses
 * 150 g. So the conversion has to work, and has to be exact.
 *
 * Quantities are carried as numbers but always rounded to three decimals before
 * storage, matching DECIMAL(12,3). Three decimals is one gram when the unit is a
 * kilogram, which is as fine as a kitchen scale reads.
 */

/** The unit each family is measured in internally. */
const BASE_UNIT: Record<IngredientUnit, IngredientUnit> = {
  [IngredientUnit.KG]: IngredientUnit.GRAM,
  [IngredientUnit.GRAM]: IngredientUnit.GRAM,
  [IngredientUnit.LITRE]: IngredientUnit.ML,
  [IngredientUnit.ML]: IngredientUnit.ML,
  // Countable things are their own base; a piece is not half a pack.
  [IngredientUnit.PIECE]: IngredientUnit.PIECE,
  [IngredientUnit.PACK]: IngredientUnit.PACK,
  [IngredientUnit.BOX]: IngredientUnit.BOX,
  [IngredientUnit.BOTTLE]: IngredientUnit.BOTTLE,
};

/** How many base units one of this unit is. */
const TO_BASE: Record<IngredientUnit, number> = {
  [IngredientUnit.KG]: 1000,
  [IngredientUnit.GRAM]: 1,
  [IngredientUnit.LITRE]: 1000,
  [IngredientUnit.ML]: 1,
  [IngredientUnit.PIECE]: 1,
  [IngredientUnit.PACK]: 1,
  [IngredientUnit.BOX]: 1,
  [IngredientUnit.BOTTLE]: 1,
};

export class IncompatibleUnitsError extends Error {
  constructor(
    readonly from: IngredientUnit,
    readonly to: IngredientUnit,
  ) {
    super(
      `A recipe in ${UNIT_LABELS[from]} cannot be measured against stock held in ` +
        `${UNIT_LABELS[to]}. Change one of them so they match.`,
    );
    this.name = 'IncompatibleUnitsError';
  }
}

export const UNIT_LABELS: Record<IngredientUnit, string> = {
  [IngredientUnit.KG]: 'kg',
  [IngredientUnit.GRAM]: 'g',
  [IngredientUnit.LITRE]: 'L',
  [IngredientUnit.ML]: 'ml',
  [IngredientUnit.PIECE]: 'pieces',
  [IngredientUnit.PACK]: 'packs',
  [IngredientUnit.BOX]: 'boxes',
  [IngredientUnit.BOTTLE]: 'bottles',
};

export const canConvert = (from: IngredientUnit, to: IngredientUnit): boolean =>
  BASE_UNIT[from] === BASE_UNIT[to];

/** Rounds to the three decimals the quantity columns hold. */
export const roundQuantity = (value: number): number =>
  Math.round((value + Number.EPSILON) * 1000) / 1000;

/**
 * A quantity expressed in another unit of the same family.
 *
 * Throws rather than guessing when the families differ: a silent zero or a
 * silent pass-through would both corrupt stock.
 */
export function convertQuantity(
  quantity: number,
  from: IngredientUnit,
  to: IngredientUnit,
): number {
  if (from === to) return roundQuantity(quantity);

  if (!canConvert(from, to)) throw new IncompatibleUnitsError(from, to);

  return roundQuantity((quantity * TO_BASE[from]) / TO_BASE[to]);
}

/**
 * What a recipe line costs, in whole paise.
 *
 * `costPerUnitPaise` is the cost of one of the ingredient's *stocking* unit — a
 * kilogram of paneer, not a gram — so the recipe quantity is converted into that
 * unit first. 150 g of paneer at ₹320/kg is 0.15 × 32000 paise = 4800 paise.
 *
 * Rounded half-up to whole paise at the end, once, so a recipe of ten lines does
 * not drift.
 */
export function recipeLineCostPaise(
  recipeQuantity: number,
  recipeUnit: IngredientUnit,
  stockUnit: IngredientUnit,
  costPerUnitPaise: number,
): number {
  const inStockUnits = convertQuantity(recipeQuantity, recipeUnit, stockUnit);

  return Math.round(inStockUnits * costPerUnitPaise);
}

/** A quantity written the way a person would say it. */
export function formatQuantity(quantity: number, unit: IngredientUnit): string {
  const rounded = roundQuantity(quantity);
  // Trailing zeros read as false precision: 10 kg, not 10.000 kg.
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/0+$/, '');

  return `${text} ${UNIT_LABELS[unit]}`;
}
