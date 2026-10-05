import type { IngredientCategory, IngredientUnit, InventoryMovementType, StockAdjustmentReason } from '@/lib/types';

/**
 * How stock reads on screen.
 *
 * Kept apart from the pages so the inventory screen, the recipe editor and the
 * report all say "9.7 kg" the same way. The unit labels mirror
 * `backend/src/modules/inventory/inventory-units.ts`; a quantity that renders
 * differently in two places looks like two different quantities.
 */

export const UNIT_LABELS: Record<IngredientUnit, string> = {
  KG: 'kg',
  GRAM: 'g',
  LITRE: 'L',
  ML: 'ml',
  PIECE: 'pieces',
  PACK: 'packs',
  BOX: 'boxes',
  BOTTLE: 'bottles',
};

/** For a dropdown, where the long form reads better than the abbreviation. */
export const UNIT_OPTIONS: Array<{ value: IngredientUnit; label: string }> = [
  { value: 'KG', label: 'Kilograms (kg)' },
  { value: 'GRAM', label: 'Grams (g)' },
  { value: 'LITRE', label: 'Litres (L)' },
  { value: 'ML', label: 'Millilitres (ml)' },
  { value: 'PIECE', label: 'Pieces' },
  { value: 'PACK', label: 'Packs' },
  { value: 'BOX', label: 'Boxes' },
  { value: 'BOTTLE', label: 'Bottles' },
];

export const CATEGORY_LABELS: Record<IngredientCategory, string> = {
  VEGETABLES: 'Vegetables',
  FRUITS: 'Fruits',
  DAIRY: 'Dairy',
  MEAT: 'Meat',
  SEAFOOD: 'Seafood',
  GRAINS: 'Grains & flour',
  SPICES: 'Spices',
  BEVERAGES: 'Beverages',
  PACKAGING: 'Packaging',
  OTHER: 'Other',
};

export const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABELS).map(([value, label]) => ({
  value: value as IngredientCategory,
  label,
}));

/** Plain words, not enum names. "Sold" is what a cook calls SALE_CONSUMPTION. */
export const MOVEMENT_LABELS: Record<InventoryMovementType, string> = {
  OPENING_STOCK: 'Opening stock',
  STOCK_IN: 'Received',
  SALE_CONSUMPTION: 'Used by sales',
  ADJUSTMENT_INCREASE: 'Corrected up',
  ADJUSTMENT_DECREASE: 'Corrected down',
  WASTAGE: 'Wasted',
  REVERSAL: 'Reversed',
};

export const REASON_LABELS: Record<StockAdjustmentReason, string> = {
  WASTAGE: 'Wastage',
  SPOILAGE: 'Spoiled',
  BREAKAGE: 'Broken or spilt',
  COUNT_CORRECTION: 'Found at a count',
  STAFF_USE: 'Staff meals',
  OTHER: 'Something else',
};

export const WASTAGE_REASONS: StockAdjustmentReason[] = [
  'SPOILAGE',
  'BREAKAGE',
  'WASTAGE',
  'STAFF_USE',
  'OTHER',
];

export const ADJUSTMENT_REASONS: StockAdjustmentReason[] = [
  'COUNT_CORRECTION',
  'STAFF_USE',
  'BREAKAGE',
  'OTHER',
];

/** Movements that add to stock, mirroring `INCOMING_MOVEMENTS` on the server. */
const INCOMING: InventoryMovementType[] = [
  'OPENING_STOCK',
  'STOCK_IN',
  'ADJUSTMENT_INCREASE',
  'REVERSAL',
];

export const isIncoming = (type: InventoryMovementType): boolean => INCOMING.includes(type);

/**
 * `9.7` kg -> `9.7 kg`, `10` -> `10 kg`.
 *
 * No trailing zeros: a shelf holding "10.000 kg" of paneer claims a precision
 * nobody measured.
 */
export function formatQuantity(quantity: number, unit: IngredientUnit): string {
  const rounded = Math.round(quantity * 1000) / 1000;

  return `${Number.isInteger(rounded) ? rounded : rounded} ${UNIT_LABELS[unit]}`;
}

/** Paise to rupees, for the money helper the rest of the app already uses. */
export const fromPaise = (paise: number | string): number => Number(paise) / 100;

/** How a stock figure reads against its minimum. */
export type StockLevel = 'OUT' | 'LOW' | 'OK' | 'UNTRACKED';

export function stockLevel(onHand: number, minimum: number): StockLevel {
  if (onHand <= 0) return 'OUT';
  // A minimum of zero means nobody asked to be warned, so nothing is "low".
  if (minimum <= 0) return 'UNTRACKED';

  return onHand <= minimum ? 'LOW' : 'OK';
}
