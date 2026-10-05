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

/**
 * The same, for a DECIMAL(_,3) quantity, rounded to the three decimals the column
 * actually holds.
 *
 * MySQL DECIMAL is exact, so there it changes nothing. SQLite - which the test
 * suite runs on - stores DECIMAL as a float, so stock arithmetic done in the
 * database comes back as 9.699999999999999, and an API that reports a shelf
 * holding 14.199999999999999 kg of paneer is wrong in a way that is hard to
 * unsee. Rounding on the way out states the column's contract in one place
 * instead of at every call site.
 */
export class QuantityTransformer extends NumericTransformer {
  from(value: string | number | null): number | null {
    const parsed = super.from(value);

    return parsed === null ? null : Math.round((parsed + Number.EPSILON) * 1000) / 1000;
  }
}

export const quantityTransformer = new QuantityTransformer();
