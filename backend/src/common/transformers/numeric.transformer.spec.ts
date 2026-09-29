import { numericTransformer } from './numeric.transformer';

describe('NumericTransformer', () => {
  describe('from (database -> application)', () => {
    it('parses the strings mysql2 returns for DECIMAL columns', () => {
      expect(numericTransformer.from('299.00')).toBe(299);
      expect(numericTransformer.from('0.05')).toBe(0.05);
      expect(numericTransformer.from('-12.50')).toBe(-12.5);
    });

    it('passes numbers through, as SQLite already returns them', () => {
      expect(numericTransformer.from(299)).toBe(299);
    });

    it('keeps null null rather than turning it into 0', () => {
      expect(numericTransformer.from(null)).toBeNull();
    });
  });

  describe('to (application -> database)', () => {
    it('writes the number it was given', () => {
      expect(numericTransformer.to(499.5)).toBe(499.5);
      expect(numericTransformer.to(0)).toBe(0);
    });

    it('writes an explicit null when a nullable column is cleared', () => {
      expect(numericTransformer.to(null)).toBeNull();
    });

    /**
     * The distinction that matters: a column the caller never set must fall back
     * to its database DEFAULT. Collapsing `undefined` to `null` here writes an
     * explicit NULL instead, which fails on a NOT NULL column with a default -
     * `restaurants.tax_rate` and every money column on `orders`.
     */
    it('leaves an unset column to its database default instead of nulling it', () => {
      expect(numericTransformer.to(undefined)).toBeUndefined();
    });
  });
});
