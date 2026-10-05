import { z } from 'zod';

/**
 * Client-side mirrors of the backend's class-validator rules.
 *
 * These give instant feedback in the browser; the server re-validates every
 * request regardless, and its 400 response is what the forms surface if the two
 * ever drift apart.
 */

const requiredText = (label: string, max: number) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} is too long`);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .optional()
    .or(z.literal(''));

const optionalUrl = z
  .string()
  .trim()
  .url('Enter a full URL starting with http:// or https://')
  .max(512)
  .optional()
  .or(z.literal(''));

/** Empty input -> undefined, so optional numbers are not coerced to 0. */
const optionalNumber = (label: string, max: number) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return undefined;
      return typeof value === 'number' ? value : Number(value);
    })
    .refine((value) => value === undefined || Number.isFinite(value), {
      message: `${label} must be a number`,
    })
    .refine((value) => value === undefined || value >= 0, {
      message: `${label} cannot be negative`,
    })
    .refine((value) => value === undefined || value <= max, {
      message: `${label} looks too high`,
    });

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});
export type LoginValues = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  name: requiredText('Your name', 120).refine((v) => v.length >= 2, 'Enter at least 2 characters'),
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  password: z
    .string()
    .min(8, 'Use at least 8 characters')
    .max(128, 'Password is too long')
    .regex(/[a-z]/, 'Include a lowercase letter')
    .regex(/[A-Z]/, 'Include an uppercase letter')
    .regex(/\d/, 'Include a number'),
  restaurantName: requiredText('Restaurant name', 150).refine(
    (v) => v.length >= 2,
    'Enter at least 2 characters',
  ),
  address: optionalText(255),
});
export type RegisterValues = z.infer<typeof registerSchema>;

export const restaurantProfileSchema = z.object({
  name: requiredText('Restaurant name', 150).refine(
    (v) => v.length >= 2,
    'Enter at least 2 characters',
  ),
  description: optionalText(2000),
  address: optionalText(255),
  phone: z
    .string()
    .trim()
    .regex(/^[+]?[0-9 ()-]{6,32}$/, 'Enter a valid phone number')
    .optional()
    .or(z.literal('')),
  logoUrl: optionalUrl,
  /**
   * Tax on bills. Blank means the same as 0 - a restaurant that adds no tax - so
   * an empty field is accepted rather than forcing owners to type a zero.
   */
  taxRate: z
    .union([z.literal(''), z.coerce.number().min(0, 'Cannot be negative').max(100, 'Cannot exceed 100%')])
    .optional(),
  taxNumber: optionalText(32),
});
export type RestaurantProfileValues = z.infer<typeof restaurantProfileSchema>;

export const categorySchema = z.object({
  name: requiredText('Category name', 120),
  sortOrder: z.coerce
    .number({ invalid_type_error: 'Sort order must be a number' })
    .int('Sort order must be a whole number')
    .min(0, 'Sort order cannot be negative')
    .max(10000, 'Sort order is too large'),
  isActive: z.boolean(),
});
export type CategoryValues = z.infer<typeof categorySchema>;

/**
 * One ingredient line inside the dish form. Quantity stays a string while the
 * user types (so "12." is not coerced away) and is converted on submit.
 */
export const recipeLineSchema = z.object({
  ingredientId: z.number().int().positive(),
  quantity: z
    .string()
    .trim()
    .min(1, 'Enter a quantity')
    .regex(/^\d{1,7}(\.\d{1,3})?$/, 'Use a number with up to 3 decimals')
    .refine((value) => Number(value) > 0, 'Quantity must be more than 0'),
  unit: requiredText('Unit', 16),
});
export type RecipeLineValues = z.infer<typeof recipeLineSchema>;

export const dishSchema = z.object({
  name: requiredText('Dish name', 150),
  description: optionalText(2000),
  categoryId: z.string().optional(),
  price: z.coerce
    .number({ invalid_type_error: 'Price must be a number' })
    .min(0, 'Price cannot be negative')
    .max(99999999.99, 'Price is too high')
    // Compare against the rounded value: `Math.round(x)` is always an integer,
    // so checking that alone would accept any number of decimals.
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
      message: 'Price can have at most 2 decimal places',
    }),
  imageUrl: optionalUrl,
  dietType: z.enum(['', 'VEG', 'NON_VEG', 'EGG', 'VEGAN']).optional(),
  taxGroup: z.enum(['STANDARD', 'ALCOHOL', 'PACKAGED', 'EXEMPT']).optional(),
  isAvailable: z.boolean(),
  proteinGrams: optionalNumber('Protein', 10000),
  calories: optionalNumber('Calories', 20000),
  carbsGrams: optionalNumber('Carbohydrates', 10000),
  fatGrams: optionalNumber('Fat', 10000),
  preparationTimeMinutes: optionalNumber('Preparation time', 600)
    .refine((value) => value === undefined || Number.isInteger(value), {
      message: 'Use whole minutes',
    })
    .refine((value) => value === undefined || value >= 1, {
      message: 'Preparation time must be at least 1 minute',
    }),
  ingredients: z.array(recipeLineSchema),
});
export type DishValues = z.infer<typeof dishSchema>;

/**
 * Stock.
 *
 * Quantities are typed into text inputs, so each one is coerced from a string
 * and rejected rather than quietly becoming NaN. Three decimals, matching the
 * DECIMAL(12,3) columns: a gram when the unit is a kilogram, which is as fine as
 * a kitchen scale reads.
 */
const quantity = (label: string, { allowZero = false } = {}) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .refine((value) => !Number.isNaN(Number(value)), `${label} must be a number`)
    .refine(
      (value) => (allowZero ? Number(value) >= 0 : Number(value) > 0),
      allowZero ? `${label} cannot be negative` : `${label} must be more than zero`,
    )
    .refine((value) => Number(value) <= 9_999_999, `${label} is too large`)
    .refine(
      (value) => /^\d*\.?\d{0,3}$/.test(value),
      'Use at most three decimal places',
    );

/**
 * A cost in rupees, held as text and converted to paise at the edge.
 *
 * Rupees because that is what a delivery note says; paise on the wire because
 * that is what the API stores. Two decimals, so ₹320.50 works and ₹320.505 does
 * not.
 */
const rupees = z
  .string()
  .trim()
  .refine((value) => value === '' || !Number.isNaN(Number(value)), 'Cost must be a number')
  .refine((value) => value === '' || Number(value) >= 0, 'Cost cannot be negative')
  .refine((value) => value === '' || Number(value) <= 1_000_000, 'Cost is too large')
  .refine((value) => value === '' || /^\d*\.?\d{0,2}$/.test(value), 'Use at most two decimals');

const unit = z.enum(['KG', 'GRAM', 'LITRE', 'ML', 'PIECE', 'PACK', 'BOX', 'BOTTLE']);

const category = z.enum([
  'VEGETABLES',
  'FRUITS',
  'DAIRY',
  'MEAT',
  'SEAFOOD',
  'GRAINS',
  'SPICES',
  'BEVERAGES',
  'PACKAGING',
  'OTHER',
]);

const reason = z.enum([
  'WASTAGE',
  'SPOILAGE',
  'BREAKAGE',
  'COUNT_CORRECTION',
  'STAFF_USE',
  'OTHER',
]);

export const stockItemSchema = z.object({
  name: requiredText('Ingredient name', 120),
  description: optionalText(2000),
  category,
  unit,
  costPerUnit: rupees,
  minimumQuantity: quantity('Minimum', { allowZero: true }),
  reorderQuantity: quantity('Usual order', { allowZero: true }),
  openingQuantity: quantity('Opening stock', { allowZero: true }),
  allergenInfo: optionalText(255),
});
export type StockItemValues = z.input<typeof stockItemSchema>;

export const stockInSchema = z.object({
  quantity: quantity('Quantity'),
  costPerUnit: rupees,
  note: optionalText(255),
});
export type StockInValues = z.input<typeof stockInSchema>;

export const wastageSchema = z.object({
  quantity: quantity('Quantity'),
  reason,
  note: optionalText(255),
});
export type WastageValues = z.input<typeof wastageSchema>;

export const stockAdjustmentSchema = z.object({
  quantity: quantity('Quantity'),
  // A string because it comes out of a <select>; "add" and "remove" read better
  // on a button than a checkbox labelled "increase".
  direction: z.enum(['add', 'remove']),
  reason,
  note: optionalText(255),
});
export type StockAdjustmentValues = z.input<typeof stockAdjustmentSchema>;

export const tableSchema = z.object({
  // Mirrors the API: surrounding and repeated spaces are collapsed before checking.
  name: z
    .string()
    .transform((value) => value.trim().replace(/\s+/g, ' '))
    .pipe(requiredText('Table name', 60)),
  isActive: z.boolean(),
});
export type TableValues = z.input<typeof tableSchema>;
