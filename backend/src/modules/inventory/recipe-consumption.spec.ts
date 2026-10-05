import { IngredientUnit } from 'src/common/enums';
import { parseRecipeUnit, planConsumption, RecipeLine, SoldLine } from './recipe-consumption';

const paneer = (over: Partial<RecipeLine> = {}): RecipeLine => ({
  dishId: 1,
  ingredientId: 10,
  ingredientName: 'Paneer',
  quantity: 150,
  recipeUnit: 'g',
  stockUnit: IngredientUnit.KG,
  costPerUnitPaise: 32000,
  ...over,
});

const sold = (over: Partial<SoldLine> = {}): SoldLine => ({
  dishId: 1,
  dishName: 'Paneer Tikka',
  quantity: 1,
  ...over,
});

describe('parseRecipeUnit', () => {
  it('reads the units already in the database', () => {
    // These are the spellings real dish_ingredients rows use, written before the
    // enum existed.
    expect(parseRecipeUnit('g')).toBe(IngredientUnit.GRAM);
    expect(parseRecipeUnit('gm')).toBe(IngredientUnit.GRAM);
    expect(parseRecipeUnit('ml')).toBe(IngredientUnit.ML);
    expect(parseRecipeUnit('piece')).toBe(IngredientUnit.PIECE);
    expect(parseRecipeUnit('nos')).toBe(IngredientUnit.PIECE);
  });

  it('reads the enum value itself', () => {
    expect(parseRecipeUnit('KG')).toBe(IngredientUnit.KG);
    expect(parseRecipeUnit('LITRE')).toBe(IngredientUnit.LITRE);
  });

  it('is not fussy about spacing or case', () => {
    expect(parseRecipeUnit('  Grams ')).toBe(IngredientUnit.GRAM);
  });

  it('refuses the ones that are not an amount', () => {
    // A tablespoon of salt and a tablespoon of cream are different weights.
    expect(parseRecipeUnit('tbsp')).toBeNull();
    expect(parseRecipeUnit('to taste')).toBeNull();
    expect(parseRecipeUnit('a pinch')).toBeNull();
    expect(parseRecipeUnit('')).toBeNull();
    expect(parseRecipeUnit(null)).toBeNull();
  });
});

describe('planConsumption', () => {
  it('converts a recipe in grams against stock in kilograms', () => {
    const plan = planConsumption([sold()], [paneer()]);

    expect(plan.required).toEqual([
      {
        ingredientId: 10,
        ingredientName: 'Paneer',
        quantity: 0.15,
        unit: IngredientUnit.KG,
        valuePaise: 4800,
      },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it('multiplies by how many were sold', () => {
    // The spec's walkthrough: 150 g per dish, two dishes, 0.3 kg off a 10 kg bag.
    const plan = planConsumption([sold({ quantity: 2 })], [paneer()]);

    expect(plan.required[0].quantity).toBe(0.3);
    expect(plan.required[0].valuePaise).toBe(9600);
  });

  it('totals one ingredient shared by two dishes into one movement', () => {
    const onionInTikka = paneer({ ingredientId: 20, ingredientName: 'Onion', quantity: 40, costPerUnitPaise: 4000 });
    const onionInCurry = { ...onionInTikka, dishId: 2 };

    const plan = planConsumption(
      [sold({ quantity: 2 }), sold({ dishId: 2, dishName: 'Onion Curry', quantity: 3 })],
      [onionInTikka, onionInCurry],
    );

    expect(plan.required).toHaveLength(1);
    // (40 x 2) + (40 x 3) = 200 g = 0.2 kg.
    expect(plan.required[0].quantity).toBe(0.2);
    expect(plan.required[0].valuePaise).toBe(800);
  });

  it('ignores a dish with no recipe', () => {
    // A bottle of water does not need a recipe, and selling one is not an error.
    const plan = planConsumption([sold({ dishId: 99, dishName: 'Mineral Water' })], [paneer()]);

    expect(plan.required).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });

  it('produces nothing at all for an order with no recipes anywhere', () => {
    const plan = planConsumption([sold()], []);

    expect(plan.required).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });

  it('skips a line measured in something nobody can weigh, and says why', () => {
    const plan = planConsumption(
      [sold()],
      [paneer(), paneer({ ingredientId: 30, ingredientName: 'Garam masala', quantity: 1, recipeUnit: 'tbsp' })],
    );

    // The measurable line still goes through. One unusable line must not stop a
    // bill being settled.
    expect(plan.required).toHaveLength(1);
    expect(plan.required[0].ingredientId).toBe(10);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0].ingredientName).toBe('Garam masala');
    expect(plan.skipped[0].reason).toContain('not a measurable amount');
  });

  it('skips a line whose unit cannot be compared with the stock unit', () => {
    const plan = planConsumption(
      [sold()],
      [paneer({ recipeUnit: 'ml', stockUnit: IngredientUnit.KG })],
    );

    expect(plan.required).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0].reason).toContain('cannot be measured against');
  });

  it('drops a line that rounds away to nothing', () => {
    // A tenth of a gram of saffron against stock held in kilograms is below what
    // the column can hold, and a zero movement tells nobody anything.
    const plan = planConsumption(
      [sold()],
      [paneer({ ingredientId: 40, ingredientName: 'Saffron', quantity: 0.1, recipeUnit: 'g' })],
    );

    expect(plan.required).toEqual([]);
  });

  it('costs nothing when the ingredient has no cost recorded', () => {
    const plan = planConsumption([sold()], [paneer({ costPerUnitPaise: 0 })]);

    expect(plan.required[0].quantity).toBe(0.15);
    expect(plan.required[0].valuePaise).toBe(0);
  });

  it('counts countable ingredients without converting', () => {
    const plan = planConsumption(
      [sold({ quantity: 3 })],
      [paneer({ ingredientId: 50, ingredientName: 'Egg', quantity: 2, recipeUnit: 'pcs', stockUnit: IngredientUnit.PIECE, costPerUnitPaise: 700 })],
    );

    expect(plan.required[0].quantity).toBe(6);
    expect(plan.required[0].valuePaise).toBe(4200);
  });
});
