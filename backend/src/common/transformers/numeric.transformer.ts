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
  to(value: number | null | undefined): number | null {
    return value === null || value === undefined ? null : value;
  }

  from(value: string | number | null): number | null {
    if (value === null || value === undefined) return null;
    return typeof value === 'number' ? value : Number.parseFloat(value);
  }
}

export const numericTransformer = new NumericTransformer();
