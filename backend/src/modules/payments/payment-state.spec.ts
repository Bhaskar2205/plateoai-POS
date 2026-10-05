import { PaymentStatus } from 'src/common/enums';
import {
  allowedTransitionsFrom,
  applyTransition,
  canTransition,
  InvalidPaymentTransitionError,
  isSettleable,
  isTerminal,
  timestampFieldFor,
} from './payment-state';

/**
 * The state machine is the thing standing between a confused provider and a bill
 * that settles twice, so the tests are about what must *not* be possible as much
 * as what must.
 */
describe('payment state machine', () => {
  describe('the ordinary path', () => {
    it('goes created, pending, captured', () => {
      expect(canTransition(PaymentStatus.CREATED, PaymentStatus.PENDING)).toBe(true);
      expect(canTransition(PaymentStatus.PENDING, PaymentStatus.CAPTURED)).toBe(true);
    });

    it('allows an authorisation step in between', () => {
      expect(canTransition(PaymentStatus.PENDING, PaymentStatus.AUTHORIZED)).toBe(true);
      expect(canTransition(PaymentStatus.AUTHORIZED, PaymentStatus.CAPTURED)).toBe(true);
    });

    it('lets a captured payment be refunded, fully or in part', () => {
      expect(canTransition(PaymentStatus.CAPTURED, PaymentStatus.REFUNDED)).toBe(true);
      expect(canTransition(PaymentStatus.CAPTURED, PaymentStatus.PARTIALLY_REFUNDED)).toBe(true);
      expect(canTransition(PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED)).toBe(true);
    });
  });

  describe('what must not be possible', () => {
    it('never captures a failed payment', () => {
      expect(canTransition(PaymentStatus.FAILED, PaymentStatus.CAPTURED)).toBe(false);
    });

    it('never captures a cancelled one', () => {
      expect(canTransition(PaymentStatus.CANCELLED, PaymentStatus.CAPTURED)).toBe(false);
    });

    it('never un-refunds money', () => {
      expect(canTransition(PaymentStatus.REFUNDED, PaymentStatus.CAPTURED)).toBe(false);
    });

    it('never returns to CREATED', () => {
      for (const status of Object.values(PaymentStatus)) {
        expect(canTransition(status, PaymentStatus.CREATED)).toBe(false);
      }
    });

    it('never captures straight from created, without a provider being asked', () => {
      expect(canTransition(PaymentStatus.CREATED, PaymentStatus.CAPTURED)).toBe(false);
    });

    it('treats failed, cancelled and refunded as final', () => {
      expect(isTerminal(PaymentStatus.FAILED)).toBe(true);
      expect(isTerminal(PaymentStatus.CANCELLED)).toBe(true);
      expect(isTerminal(PaymentStatus.REFUNDED)).toBe(true);
      expect(isTerminal(PaymentStatus.CAPTURED)).toBe(false);
    });
  });

  describe('applying a transition', () => {
    it('reports a real change', () => {
      expect(applyTransition(PaymentStatus.PENDING, PaymentStatus.CAPTURED)).toEqual({
        status: PaymentStatus.CAPTURED,
        changed: true,
      });
    });

    it('treats a repeat as a no-op rather than an error', () => {
      // A provider re-delivering payment.captured is normal. Failing it would
      // make a healthy webhook look broken and invite a retry storm.
      expect(applyTransition(PaymentStatus.CAPTURED, PaymentStatus.CAPTURED)).toEqual({
        status: PaymentStatus.CAPTURED,
        changed: false,
      });
    });

    it('refuses an impossible move, and says what was possible', () => {
      expect(() => applyTransition(PaymentStatus.FAILED, PaymentStatus.CAPTURED)).toThrow(
        InvalidPaymentTransitionError,
      );
      expect(() => applyTransition(PaymentStatus.FAILED, PaymentStatus.CAPTURED)).toThrow(/final/);
      expect(() => applyTransition(PaymentStatus.CREATED, PaymentStatus.CAPTURED)).toThrow(
        /may only become/,
      );
    });
  });

  describe('settling', () => {
    it('is permitted only by captured money', () => {
      for (const status of Object.values(PaymentStatus)) {
        expect(isSettleable(status)).toBe(status === PaymentStatus.CAPTURED);
      }
    });
  });

  describe('timestamps', () => {
    it('stamps the moment a status is reached', () => {
      expect(timestampFieldFor(PaymentStatus.AUTHORIZED)).toBe('authorizedAt');
      expect(timestampFieldFor(PaymentStatus.CAPTURED)).toBe('capturedAt');
      expect(timestampFieldFor(PaymentStatus.FAILED)).toBe('failedAt');
      expect(timestampFieldFor(PaymentStatus.CANCELLED)).toBe('cancelledAt');
    });

    it('has nothing to stamp for the states that are not a moment', () => {
      expect(timestampFieldFor(PaymentStatus.CREATED)).toBeNull();
      expect(timestampFieldFor(PaymentStatus.PENDING)).toBeNull();
    });
  });

  it('defines a rule for every status, so a new one cannot be forgotten', () => {
    for (const status of Object.values(PaymentStatus)) {
      expect(Array.isArray(allowedTransitionsFrom(status))).toBe(true);
    }
  });
});
