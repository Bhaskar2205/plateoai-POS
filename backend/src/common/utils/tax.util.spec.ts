import { DiscountType, TaxGroup, TaxKind } from 'src/common/enums';
import { computeBill, effectiveTaxRate, type TaxComponentInput } from './tax.util';

/**
 * The arithmetic of an Indian restaurant bill. The cases are the ones a
 * restaurant actually hits, not abstract ones: 5% split as CGST and SGST, a
 * table that ordered beer, a service charge, and a corporate bill with TDS.
 */

const food = (unitPrice: number, quantity = 1) => ({
  unitPrice,
  quantity,
  taxGroup: TaxGroup.STANDARD,
});
const booze = (unitPrice: number, quantity = 1) => ({
  unitPrice,
  quantity,
  taxGroup: TaxGroup.ALCOHOL,
});

const noDiscount = { type: null, value: null };

/** A standalone restaurant: 5% GST, split in half as the law requires. */
const GST_5: TaxComponentInput[] = [
  { name: 'CGST', kind: TaxKind.CGST, rate: 2.5, appliesTo: TaxGroup.STANDARD },
  { name: 'SGST', kind: TaxKind.SGST, rate: 2.5, appliesTo: TaxGroup.STANDARD },
];

describe('computeBill', () => {
  it('splits GST into CGST and SGST, each rounded on its own base', () => {
    const bill = computeBill([food(400), food(200)], noDiscount, GST_5);

    expect(bill.subtotal).toBe(600);
    expect(bill.taxableAmount).toBe(600);
    expect(bill.charges.map((c) => [c.name, c.rate, c.amount])).toEqual([
      ['CGST', 2.5, 15],
      ['SGST', 2.5, 15],
    ]);
    expect(bill.taxAmount).toBe(30);
    expect(bill.total).toBe(630);
  });

  it('keeps the two halves equal on an amount that does not divide evenly', () => {
    // 2.5% of 333.33 is 8.33325 - both halves must land on the same paisa.
    const bill = computeBill([food(333.33)], noDiscount, GST_5);
    const [cgst, sgst] = bill.charges;

    expect(cgst.amount).toBe(sgst.amount);
    expect(bill.taxAmount).toBe(cgst.amount + sgst.amount);
    expect(bill.total).toBe(333.33 + bill.taxAmount);
  });

  it('taxes the discounted value, not the menu value', () => {
    const bill = computeBill([food(1000)], { type: DiscountType.PERCENT, value: 10 }, GST_5);

    expect(bill.discountAmount).toBe(100);
    expect(bill.taxableAmount).toBe(900);
    expect(bill.taxAmount).toBe(45);
    expect(bill.total).toBe(945);
  });

  it('charges no tax at all without components', () => {
    const bill = computeBill([food(500)], noDiscount, []);

    expect(bill.charges).toEqual([]);
    expect(bill.taxAmount).toBe(0);
    expect(bill.total).toBe(500);
  });

  describe('a service charge', () => {
    const withService: TaxComponentInput[] = [
      { name: 'Service charge', kind: TaxKind.SERVICE_CHARGE, rate: 10, appliesTo: TaxGroup.STANDARD },
      ...GST_5,
    ];

    it('is charged on the food and then taxed along with it', () => {
      const bill = computeBill([food(1000)], noDiscount, withService);

      expect(bill.serviceChargeAmount).toBe(100);
      // GST applies to 1100, not 1000: the service charge is part of the supply.
      expect(bill.charges.find((c) => c.name === 'CGST')).toMatchObject({
        taxableAmount: 1100,
        amount: 27.5,
      });
      expect(bill.taxAmount).toBe(55);
      expect(bill.total).toBe(1155);
    });

    it('is not counted as tax', () => {
      const bill = computeBill([food(1000)], noDiscount, withService);

      // A guest who refuses the service charge is refusing a charge, not a tax,
      // so the two must never be reported as one number.
      expect(bill.taxAmount).toBe(55);
      expect(bill.serviceChargeAmount).toBe(100);
    });
  });

  describe('a table that also ordered alcohol', () => {
    const mixed: TaxComponentInput[] = [
      ...GST_5,
      { name: 'VAT', kind: TaxKind.VAT, rate: 20, appliesTo: TaxGroup.ALCOHOL },
    ];

    it('keeps alcohol out of GST and food out of VAT', () => {
      const bill = computeBill([food(1000), booze(500)], noDiscount, mixed);

      expect(bill.subtotal).toBe(1500);
      // GST sees only the food.
      expect(bill.charges.find((c) => c.kind === TaxKind.CGST)).toMatchObject({
        taxableAmount: 1000,
        amount: 25,
      });
      // VAT sees only the drink.
      expect(bill.charges.find((c) => c.kind === TaxKind.VAT)).toMatchObject({
        taxableAmount: 500,
        amount: 100,
      });
      expect(bill.taxAmount).toBe(150);
      expect(bill.total).toBe(1650);
    });

    it('shares a whole-bill discount across both, to the paisa', () => {
      const bill = computeBill([food(1000), booze(500)], { type: DiscountType.AMOUNT, value: 300 }, mixed);

      const gstBase = bill.charges.find((c) => c.kind === TaxKind.CGST)!.taxableAmount;
      const vatBase = bill.charges.find((c) => c.kind === TaxKind.VAT)!.taxableAmount;

      // The discount is split 1000:500, and the parts add back exactly.
      expect(gstBase + vatBase).toBe(1200);
      expect(gstBase).toBe(800);
      expect(vatBase).toBe(400);
    });

    it('leaves an exempt line untaxed', () => {
      const bill = computeBill(
        [food(1000), { unitPrice: 200, quantity: 1, taxGroup: TaxGroup.EXEMPT }],
        noDiscount,
        GST_5,
      );

      expect(bill.subtotal).toBe(1200);
      expect(bill.charges[0].taxableAmount).toBe(1000);
      expect(bill.total).toBe(1250);
    });
  });

  describe('TDS, which the payer withholds', () => {
    it('is worked out on the value before GST', () => {
      // 1000 food + 5% GST = 1050 owed; TDS at 2% applies to 1000, not 1050.
      const bill = computeBill([food(1000)], noDiscount, GST_5, 2);

      expect(bill.total).toBe(1050);
      expect(bill.tdsAmount).toBe(20);
      expect(bill.amountPayable).toBe(1030);
    });

    it('includes a service charge in its base, because that is part of the value', () => {
      const bill = computeBill(
        [food(1000)],
        noDiscount,
        [{ name: 'Service charge', kind: TaxKind.SERVICE_CHARGE, rate: 10, appliesTo: TaxGroup.STANDARD }, ...GST_5],
        2,
      );

      expect(bill.tdsAmount).toBe(22);
    });

    it('does not change what is owed in tax', () => {
      const without = computeBill([food(1000)], noDiscount, GST_5);
      const with_ = computeBill([food(1000)], noDiscount, GST_5, 10);

      expect(with_.taxAmount).toBe(without.taxAmount);
      expect(with_.total).toBe(without.total);
      expect(with_.amountPayable).toBe(without.total - with_.tdsAmount);
    });

    it('is absent unless asked for', () => {
      const bill = computeBill([food(1000)], noDiscount, GST_5);

      expect(bill.tdsRate).toBeNull();
      expect(bill.tdsAmount).toBe(0);
      expect(bill.amountPayable).toBe(bill.total);
    });
  });

  describe('edges', () => {
    it('never lets a discount push the bill below zero', () => {
      const bill = computeBill([food(100)], { type: DiscountType.AMOUNT, value: 500 }, GST_5);

      expect(bill.discountAmount).toBe(100);
      expect(bill.taxableAmount).toBe(0);
      expect(bill.taxAmount).toBe(0);
      expect(bill.total).toBe(0);
    });

    it('handles an empty bill', () => {
      const bill = computeBill([], noDiscount, GST_5);

      expect(bill.subtotal).toBe(0);
      expect(bill.total).toBe(0);
      expect(bill.charges.every((c) => c.amount === 0)).toBe(true);
    });

    it('does not drift over a long bill', () => {
      // 100 lines at 33.33 - the place where paise-by-paise rounding shows up.
      const bill = computeBill(Array.from({ length: 100 }, () => food(33.33)), noDiscount, GST_5);

      expect(bill.subtotal).toBe(3333);
      expect(bill.taxAmount).toBe(bill.charges.reduce((sum, c) => sum + c.amount, 0));
      expect(bill.total).toBe(bill.subtotal + bill.taxAmount);
    });

    it('applies an 18% hotel-restaurant rate the same way', () => {
      const bill = computeBill([food(2000)], noDiscount, [
        { name: 'CGST', kind: TaxKind.CGST, rate: 9, appliesTo: TaxGroup.STANDARD },
        { name: 'SGST', kind: TaxKind.SGST, rate: 9, appliesTo: TaxGroup.STANDARD },
      ]);

      expect(bill.taxAmount).toBe(360);
      expect(bill.total).toBe(2360);
    });

    it('adds cess on top of GST for something like an aerated drink', () => {
      const bill = computeBill(
        [{ unitPrice: 100, quantity: 1, taxGroup: TaxGroup.PACKAGED }],
        noDiscount,
        [
          { name: 'CGST', kind: TaxKind.CGST, rate: 14, appliesTo: TaxGroup.PACKAGED },
          { name: 'SGST', kind: TaxKind.SGST, rate: 14, appliesTo: TaxGroup.PACKAGED },
          { name: 'Cess', kind: TaxKind.CESS, rate: 12, appliesTo: TaxGroup.PACKAGED },
        ],
      );

      expect(bill.taxAmount).toBe(40);
      expect(bill.total).toBe(140);
    });
  });
});

describe('effectiveTaxRate', () => {
  it('reports the combined percentage for the one-line summary', () => {
    const bill = computeBill([food(1000)], noDiscount, GST_5);

    expect(effectiveTaxRate(bill)).toBe(5);
  });

  it('is zero on a bill with nothing taxable', () => {
    expect(effectiveTaxRate(computeBill([], noDiscount, GST_5))).toBe(0);
  });
});
