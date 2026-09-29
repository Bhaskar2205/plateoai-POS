import { DiscountType } from 'src/common/enums';

/**
 * Bill arithmetic, done entirely in integer paise.
 *
 * DECIMAL columns arrive as JS numbers through `NumericTransformer`, and adding
 * those directly loses money: `0.1 + 0.2` is not `0.3`, and a bill of 1,000
 * lines drifts by whole paise. Every figure is therefore converted to an integer
 * number of paise, added and rounded there, and converted back exactly once.
 *
 * Rounding is half-up on the absolute value, which is what a printed bill and a
 * cash drawer both expect: a 7.5 paise tax becomes 8 paise, never 7.
 */

/** Rupees (a DECIMAL(10,2) value) to whole paise. */
export function toPaise(rupees: number): number {
  return roundHalfUp(rupees * 100);
}

/** Whole paise back to a rupee amount safe to store in DECIMAL(10,2). */
export function fromPaise(paise: number): number {
  // Divide after rounding, so the result always has at most two decimals.
  return roundHalfUp(paise) / 100;
}

/**
 * Half-up on magnitude: 2.5 -> 3, -2.5 -> -3.
 *
 * The value is first snapped to 12 significant digits, because a float that
 * should sit exactly on .5 often does not: `1.005 * 100` is
 * 100.49999999999999, which would otherwise round *down* and quietly lose a
 * paisa. Twelve digits is well above any bill DECIMAL(10,2) can hold (at most
 * ten digits of paise) and well below the noise floor of that multiplication.
 */
function roundHalfUp(value: number): number {
  const snapped = Number.parseFloat(value.toPrecision(12));

  return snapped < 0 ? -Math.round(-snapped) : Math.round(snapped);
}

export interface LineInput {
  unitPrice: number;
  quantity: number;
}

export interface DiscountInput {
  type: DiscountType | null;
  value: number | null;
}

export interface BillTotals {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
}

/** One line's money, rounded once so the stored line total is exact. */
export function lineTotal(line: LineInput): number {
  return fromPaise(toPaise(line.unitPrice) * line.quantity);
}

/**
 * The whole bill, from its live lines outwards.
 *
 * Order of operations matters and is deliberate: tax applies to the *discounted*
 * subtotal, because a discount reduces the taxable amount. A discount can never
 * exceed the subtotal, so a bill cannot go negative - callers enforce their own
 * policy cap (`MAX_DISCOUNT_PERCENT`) before getting here, and this clamp is the
 * backstop that keeps the arithmetic sane regardless.
 */
export function computeBillTotals(
  lines: LineInput[],
  discount: DiscountInput,
  taxRate: number,
): BillTotals {
  const subtotalPaise = lines.reduce(
    (sum, line) => sum + toPaise(line.unitPrice) * line.quantity,
    0,
  );

  const discountPaise = Math.min(discountPaiseFor(subtotalPaise, discount), subtotalPaise);
  const taxablePaise = subtotalPaise - discountPaise;
  const taxPaise = roundHalfUp((taxablePaise * taxRate) / 100);

  return {
    subtotal: fromPaise(subtotalPaise),
    discountAmount: fromPaise(discountPaise),
    taxAmount: fromPaise(taxPaise),
    total: fromPaise(taxablePaise + taxPaise),
  };
}

function discountPaiseFor(subtotalPaise: number, discount: DiscountInput): number {
  if (discount.type === null || discount.value === null || discount.value <= 0) {
    return 0;
  }

  return discount.type === DiscountType.PERCENT
    ? roundHalfUp((subtotalPaise * discount.value) / 100)
    : toPaise(discount.value);
}
