import { DiscountType } from 'src/common/enums';
import { computeBillTotals, fromPaise, lineTotal, toPaise } from './money.util';

const noDiscount = { type: null, value: null };

describe('money util', () => {
  describe('paise conversion', () => {
    it('converts rupees to whole paise', () => {
      expect(toPaise(299)).toBe(29900);
      expect(toPaise(249.5)).toBe(24950);
      expect(toPaise(0.01)).toBe(1);
    });

    it('rounds float artefacts instead of truncating them', () => {
      // 1.005 * 100 is 100.49999999999999 in IEEE-754; truncating would lose a paisa.
      expect(toPaise(1.005)).toBe(101);
      expect(toPaise(8.4)).toBe(840);
    });

    it('round-trips back to at most two decimals', () => {
      expect(fromPaise(24950)).toBe(249.5);
      expect(fromPaise(1)).toBe(0.01);
    });
  });

  describe('lineTotal', () => {
    it('multiplies price by quantity exactly', () => {
      expect(lineTotal({ unitPrice: 249.5, quantity: 2 })).toBe(499);
      expect(lineTotal({ unitPrice: 0.1, quantity: 3 })).toBe(0.3);
    });
  });

  describe('computeBillTotals', () => {
    it('sums lines without float drift', () => {
      const lines = Array.from({ length: 10 }, () => ({ unitPrice: 0.1, quantity: 1 }));

      // 0.1 summed as floats gives 0.9999999999999999.
      expect(computeBillTotals(lines, noDiscount, 0).subtotal).toBe(1);
    });

    it('adds no tax and no discount by default', () => {
      const totals = computeBillTotals([{ unitPrice: 299, quantity: 2 }], noDiscount, 0);

      expect(totals).toEqual({ subtotal: 598, discountAmount: 0, taxAmount: 0, total: 598 });
    });

    it('applies a percentage discount and taxes the discounted subtotal', () => {
      const totals = computeBillTotals(
        [{ unitPrice: 320, quantity: 2 }],
        { type: DiscountType.PERCENT, value: 10 },
        5,
      );

      expect(totals).toEqual({
        subtotal: 640,
        discountAmount: 64,
        taxAmount: 28.8,
        total: 604.8,
      });
    });

    it('applies a flat discount', () => {
      const totals = computeBillTotals(
        [{ unitPrice: 500, quantity: 1 }],
        { type: DiscountType.AMOUNT, value: 50 },
        0,
      );

      expect(totals).toEqual({ subtotal: 500, discountAmount: 50, taxAmount: 0, total: 450 });
    });

    it('rounds tax half-up, so the diner is never charged a fraction of a paisa', () => {
      // 100 at 7.5% is 7.50; 100.10 at 7.5% is 7.5075 -> 7.51.
      expect(computeBillTotals([{ unitPrice: 100.1, quantity: 1 }], noDiscount, 7.5).taxAmount).toBe(
        7.51,
      );
    });

    it('never lets a discount push a bill below zero', () => {
      const totals = computeBillTotals(
        [{ unitPrice: 100, quantity: 1 }],
        { type: DiscountType.AMOUNT, value: 500 },
        5,
      );

      expect(totals).toEqual({ subtotal: 100, discountAmount: 100, taxAmount: 0, total: 0 });
    });

    it('ignores a zero or negative discount value', () => {
      for (const value of [0, -10]) {
        expect(
          computeBillTotals([{ unitPrice: 100, quantity: 1 }], { type: DiscountType.PERCENT, value }, 0)
            .discountAmount,
        ).toBe(0);
      }
    });

    it('treats an empty order as a zero bill rather than failing', () => {
      expect(computeBillTotals([], { type: DiscountType.PERCENT, value: 10 }, 5)).toEqual({
        subtotal: 0,
        discountAmount: 0,
        taxAmount: 0,
        total: 0,
      });
    });

    it('keeps a long bill exact to the paisa', () => {
      const lines = Array.from({ length: 97 }, () => ({ unitPrice: 33.33, quantity: 3 }));
      const totals = computeBillTotals(lines, { type: DiscountType.PERCENT, value: 12.5 }, 18);

      // 97 * 3 * 3333 paise = 970,  - 12.5% = 848,  + 18%.
      expect(totals.subtotal).toBe(9699.03);
      expect(totals.discountAmount).toBe(1212.38);
      expect(totals.taxAmount).toBe(1527.6);
      expect(totals.total).toBe(10014.25);
    });
  });
});
