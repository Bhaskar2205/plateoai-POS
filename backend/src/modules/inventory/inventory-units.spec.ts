import { IngredientUnit } from 'src/common/enums';
import {
  canConvert,
  convertQuantity,
  formatQuantity,
  IncompatibleUnitsError,
  recipeLineCostPaise,
  roundQuantity,
} from './inventory-units';

/**
 * Units are where an inventory system quietly goes wrong: a recipe in grams
 * against stock in kilograms is the ordinary case, and getting it wrong by a
 * factor of a thousand is invisible until someone counts the paneer.
 */
describe('convertQuantity', () => {
  it('converts within a weight family', () => {
    expect(convertQuantity(1, IngredientUnit.KG, IngredientUnit.GRAM)).toBe(1000);
    expect(convertQuantity(150, IngredientUnit.GRAM, IngredientUnit.KG)).toBe(0.15);
  });

  it('converts within a volume family', () => {
    expect(convertQuantity(1, IngredientUnit.LITRE, IngredientUnit.ML)).toBe(1000);
    expect(convertQuantity(250, IngredientUnit.ML, IngredientUnit.LITRE)).toBe(0.25);
  });

  it('leaves a unit alone when it is already right', () => {
    expect(convertQuantity(4.5, IngredientUnit.KG, IngredientUnit.KG)).toBe(4.5);
  });

  it('refuses to guess between weight and volume', () => {
    // A litre of oil and a litre of honey weigh different amounts. Guessing
    // would misreport stock in a way nobody notices until a count.
    expect(() => convertQuantity(100, IngredientUnit.GRAM, IngredientUnit.ML)).toThrow(
      IncompatibleUnitsError,
    );
    expect(() => convertQuantity(1, IngredientUnit.LITRE, IngredientUnit.KG)).toThrow(
      /cannot be measured against/,
    );
  });

  it('refuses to convert between countable things', () => {
    expect(() => convertQuantity(1, IngredientUnit.PACK, IngredientUnit.PIECE)).toThrow(
      IncompatibleUnitsError,
    );
    expect(() => convertQuantity(1, IngredientUnit.BOX, IngredientUnit.BOTTLE)).toThrow(
      IncompatibleUnitsError,
    );
  });

  it('knows which pairs are compatible', () => {
    expect(canConvert(IngredientUnit.KG, IngredientUnit.GRAM)).toBe(true);
    expect(canConvert(IngredientUnit.ML, IngredientUnit.LITRE)).toBe(true);
    expect(canConvert(IngredientUnit.GRAM, IngredientUnit.ML)).toBe(false);
    expect(canConvert(IngredientUnit.PIECE, IngredientUnit.PIECE)).toBe(true);
  });

  it('keeps a gram of precision on a kilogram', () => {
    expect(convertQuantity(1, IngredientUnit.GRAM, IngredientUnit.KG)).toBe(0.001);
    // A third of a gram is below what a kitchen scale reads; three decimals is
    // the floor the column holds.
    expect(convertQuantity(0.4, IngredientUnit.GRAM, IngredientUnit.KG)).toBe(0);
  });
});

describe('recipeLineCostPaise', () => {
  it('costs 150 g of paneer at ₹320/kg as ₹48', () => {
    // 0.15 kg x 32000 paise = 4800 paise.
    expect(recipeLineCostPaise(150, IngredientUnit.GRAM, IngredientUnit.KG, 32000)).toBe(4800);
  });

  it('costs a small spice line without losing it to rounding', () => {
    // 40 g of onion at ₹40/kg = ₹1.60.
    expect(recipeLineCostPaise(40, IngredientUnit.GRAM, IngredientUnit.KG, 4000)).toBe(160);
  });

  it('costs 10 ml of oil at ₹180/litre', () => {
    expect(recipeLineCostPaise(10, IngredientUnit.ML, IngredientUnit.LITRE, 18000)).toBe(180);
  });

  it('costs a countable ingredient directly', () => {
    expect(recipeLineCostPaise(2, IngredientUnit.PIECE, IngredientUnit.PIECE, 1500)).toBe(3000);
  });

  it('rounds to whole paise, once', () => {
    // 7 g at ₹333/kg = 2.331 paise... rounds to 2331 millipaise -> 233 paise.
    expect(recipeLineCostPaise(7, IngredientUnit.GRAM, IngredientUnit.KG, 33300)).toBe(233);
  });

  it('costs nothing when the ingredient has no cost set', () => {
    expect(recipeLineCostPaise(150, IngredientUnit.GRAM, IngredientUnit.KG, 0)).toBe(0);
  });
});

describe('roundQuantity', () => {
  it('keeps three decimals', () => {
    expect(roundQuantity(10.1234)).toBe(10.123);
    expect(roundQuantity(9.7)).toBe(9.7);
  });

  it('cleans up the float error a subtraction leaves', () => {
    // 10 - 0.3 is 9.699999999999999 in binary floating point.
    expect(roundQuantity(10 - 0.3)).toBe(9.7);
  });
});

describe('formatQuantity', () => {
  it('reads the way a person would say it', () => {
    expect(formatQuantity(10, IngredientUnit.KG)).toBe('10 kg');
    expect(formatQuantity(9.7, IngredientUnit.KG)).toBe('9.7 kg');
    expect(formatQuantity(250, IngredientUnit.ML)).toBe('250 ml');
    expect(formatQuantity(3, IngredientUnit.PIECE)).toBe('3 pieces');
  });

  it('does not show false precision', () => {
    expect(formatQuantity(10.0, IngredientUnit.KG)).toBe('10 kg');
  });
});
