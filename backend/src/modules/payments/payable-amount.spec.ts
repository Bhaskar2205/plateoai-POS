import {
  amountsMatch,
  assertAmountMatches,
  calculatePayableAmount,
  formatPaise,
  PaymentAmountMismatchError,
} from './payable-amount';

/**
 * The amount is the thing a browser must never be able to influence, so these
 * tests are about where the number comes from and how exactly it is compared.
 */
describe('calculatePayableAmount', () => {
  it('takes what the bill says is collectable', () => {
    expect(calculatePayableAmount({ amountPayable: 1050, total: 1050 })).toBe('105000');
  });

  it('uses the payable amount, not the total, when TDS was withheld', () => {
    // The payer withholds 200; charging the full 10,500 would take it twice.
    expect(calculatePayableAmount({ amountPayable: 10300, total: 10500 })).toBe('1030000');
  });

  it('converts exactly on an amount that floats get wrong', () => {
    expect(calculatePayableAmount({ amountPayable: 1039.5, total: 1039.5 })).toBe('103950');
    expect(calculatePayableAmount({ amountPayable: 0.07, total: 0.07 })).toBe('7');
  });

  it('handles a bill worth nothing', () => {
    expect(calculatePayableAmount({ amountPayable: 0, total: 0 })).toBe('0');
  });
});

describe('assertAmountMatches', () => {
  it('accepts an exact match', () => {
    expect(() => assertAmountMatches('105000', '105000')).not.toThrow();
  });

  it('refuses a single paisa of difference', () => {
    // No tolerance on purpose: "close enough" is a decision that somebody loses
    // money on every bill, taken silently.
    expect(() => assertAmountMatches('105000', '104999')).toThrow(PaymentAmountMismatchError);
  });

  it('explains the difference in rupees, for a person', () => {
    expect(() => assertAmountMatches('110000', '105000')).toThrow(/₹1,050\.00/);
    expect(() => assertAmountMatches('110000', '105000')).toThrow(/₹1,100\.00/);
  });

  it('stays exact past the range a float could hold', () => {
    const huge = '9007199254740993';

    expect(amountsMatch(huge, huge)).toBe(true);
    expect(amountsMatch(huge, '9007199254740992')).toBe(false);
  });
});

describe('formatPaise', () => {
  it('writes rupees the Indian way', () => {
    expect(formatPaise('105000')).toBe('₹1,050.00');
    expect(formatPaise('100000000')).toBe('₹10,00,000.00');
  });

  it('keeps both paise digits', () => {
    expect(formatPaise('105')).toBe('₹1.05');
    expect(formatPaise('100')).toBe('₹1.00');
    expect(formatPaise('7')).toBe('₹0.07');
  });

  it('handles zero and a negative', () => {
    expect(formatPaise('0')).toBe('₹0.00');
    expect(formatPaise('-2500')).toBe('-₹25.00');
  });
});
