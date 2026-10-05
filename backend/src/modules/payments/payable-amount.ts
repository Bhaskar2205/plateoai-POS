import { toPaise } from 'src/common/utils/money.util';
import type { Order } from 'src/modules/orders/entities/order.entity';

/**
 * What a bill is actually owed, in whole paise.
 *
 * One function, used by every payment path, reading the figures the billing
 * engine already computed and stored on the order. It does **not** recompute the
 * tax: the bill's own recalculation is the single authority on what a guest owes,
 * and a second implementation here would eventually disagree with it — which, on
 * a bill, means charging a guest a different number from the one printed.
 *
 * Nothing from the browser reaches this. A request may say which bill to pay; it
 * may never say how much.
 *
 * `amountPayable` rather than `total`, because TDS withheld by a corporate payer
 * reduces what the restaurant actually collects, and charging the full total to a
 * payer who is withholding would take money twice.
 */
export function calculatePayableAmount(order: Pick<Order, 'amountPayable' | 'total'>): string {
  // amountPayable is written on every recalculation; total is the fallback for a
  // row written before that column existed.
  const rupees = order.amountPayable ?? order.total;

  return String(toPaise(rupees));
}

/** Raised when a provider's figure and the bill's do not agree. */
export class PaymentAmountMismatchError extends Error {
  constructor(
    readonly expectedPaise: string,
    readonly actualPaise: string,
  ) {
    super(
      `This payment is for ${formatPaise(actualPaise)} but the bill comes to ` +
        `${formatPaise(expectedPaise)}. The payment has not been applied.`,
    );
    this.name = 'PaymentAmountMismatchError';
  }
}

/**
 * Compares two amounts exactly.
 *
 * Exactly, with no tolerance. A "close enough" rule would be a decision that
 * somebody loses a few paise on every bill, taken silently, by a programmer. A
 * mismatch is a question for a person, which is what the reconciliation
 * exception is for.
 */
export function assertAmountMatches(expectedPaise: string, actualPaise: string): void {
  if (BigInt(expectedPaise) !== BigInt(actualPaise)) {
    throw new PaymentAmountMismatchError(expectedPaise, actualPaise);
  }
}

export const amountsMatch = (a: string, b: string): boolean => BigInt(a) === BigInt(b);

/** Paise as rupees, for a message a person reads. */
export function formatPaise(paise: string): string {
  const value = BigInt(paise);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const rupees = absolute / 100n;
  const remainder = absolute % 100n;

  return `${negative ? '-' : ''}₹${rupees.toLocaleString('en-IN')}.${remainder.toString().padStart(2, '0')}`;
}
