import { PaymentStatus } from 'src/common/enums';

/**
 * What a payment is allowed to do next.
 *
 * Written as data rather than as `if` statements scattered through a service,
 * because the question "can this payment go from here to there" gets asked from
 * three directions - a webhook, a reconciliation sweep, and an operator - and
 * three implementations of the same rule is three chances to disagree.
 *
 * The shape of the table is the policy:
 *
 *  - Money can only be taken from a payment that is pending or authorised, so a
 *    webhook arriving late cannot capture something already refunded.
 *  - CAPTURED is not terminal: a refund is a real thing that happens afterwards.
 *  - FAILED and CANCELLED are terminal. A provider that fails a payment and then
 *    captures it is describing two payments, not one, and the second needs its
 *    own intent rather than quietly reviving the first.
 *  - Nothing may return to CREATED. An intent is created once.
 */
const ALLOWED: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  [PaymentStatus.CREATED]: [
    PaymentStatus.PENDING,
    PaymentStatus.FAILED,
    PaymentStatus.CANCELLED,
  ],
  [PaymentStatus.PENDING]: [
    PaymentStatus.AUTHORIZED,
    // A provider may capture without a separate authorisation step.
    PaymentStatus.CAPTURED,
    PaymentStatus.FAILED,
    PaymentStatus.CANCELLED,
  ],
  [PaymentStatus.AUTHORIZED]: [
    PaymentStatus.CAPTURED,
    PaymentStatus.FAILED,
    PaymentStatus.CANCELLED,
  ],
  [PaymentStatus.CAPTURED]: [PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED],
  // A partial refund can become a full one as further amounts go back.
  [PaymentStatus.PARTIALLY_REFUNDED]: [PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED],
  [PaymentStatus.FAILED]: [],
  [PaymentStatus.CANCELLED]: [],
  [PaymentStatus.REFUNDED]: [],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function allowedTransitionsFrom(from: PaymentStatus): readonly PaymentStatus[] {
  return ALLOWED[from];
}

export const isTerminal = (status: PaymentStatus): boolean => ALLOWED[status].length === 0;

/** True once the money is actually the restaurant's, which is what may settle a bill. */
export const isSettleable = (status: PaymentStatus): boolean => status === PaymentStatus.CAPTURED;

export class InvalidPaymentTransitionError extends Error {
  constructor(
    readonly from: PaymentStatus,
    readonly to: PaymentStatus,
  ) {
    super(
      `A payment cannot go from ${from} to ${to}.` +
        (allowedTransitionsFrom(from).length === 0
          ? ` ${from} is final.`
          : ` From ${from} it may only become ${allowedTransitionsFrom(from).join(', ')}.`),
    );
    this.name = 'InvalidPaymentTransitionError';
  }
}

/**
 * Applies a transition, or explains why it cannot happen.
 *
 * Repeating a transition that has already happened is **not** an error: a
 * provider re-delivering `payment.captured` is the normal case, and answering it
 * with a failure would make a healthy webhook look broken. The caller is told it
 * was a repeat so it can avoid writing a second audit record.
 */
export function applyTransition(
  from: PaymentStatus,
  to: PaymentStatus,
): { status: PaymentStatus; changed: boolean } {
  if (from === to) return { status: from, changed: false };

  if (!canTransition(from, to)) throw new InvalidPaymentTransitionError(from, to);

  return { status: to, changed: true };
}

/** The timestamp column a status change should stamp, if any. */
export function timestampFieldFor(
  status: PaymentStatus,
): 'authorizedAt' | 'capturedAt' | 'failedAt' | 'cancelledAt' | null {
  switch (status) {
    case PaymentStatus.AUTHORIZED:
      return 'authorizedAt';
    case PaymentStatus.CAPTURED:
      return 'capturedAt';
    case PaymentStatus.FAILED:
      return 'failedAt';
    case PaymentStatus.CANCELLED:
      return 'cancelledAt';
    default:
      return null;
  }
}
