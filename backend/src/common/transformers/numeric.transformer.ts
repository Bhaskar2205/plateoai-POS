import { ValueTransformer } from 'typeorm';

/**
 * MySQL DECIMAL columns come back from the driver as strings (to avoid the
 * precision loss of IEEE-754 floats). We store money and nutrition as DECIMAL,
 * and convert to `number` at the edge so DTOs and JSON responses stay numeric.
 *
 * Arithmetic on money must still be done in the database or on integer paise -
 * never by summing these JS numbers.
 */
export class NumericTransformer implements ValueTransformer {
  /**
   * `undefined` is passed through rather than collapsed to `null`, so a column
   * the caller never set falls back to its database DEFAULT. Returning `null`
   * here would write an explicit NULL instead, which fails outright on a NOT
   * NULL column with a default (`orders.subtotal`, `restaurants.tax_rate`).
   * An explicit `null` still clears a nullable column.
   */
  to(value: number | null | undefined): number | null | undefined {
    return value;
  }

  from(value: string | number | null): number | null {
    if (value === null || value === undefined) return null;
    return typeof value === 'number' ? value : Number.parseFloat(value);
  }
}

export const numericTransformer = new NumericTransformer();
