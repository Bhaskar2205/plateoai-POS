import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { PaymentProviderStatus, PaymentStatus } from 'src/common/enums';
import { RazorpayPaymentProvider } from './razorpay.provider';
import {
  ProviderNotConfiguredError,
  WebhookVerificationError,
} from './payment-provider.interface';

/**
 * Signature verification and configuration gating, with a secret this test
 * chose.
 *
 * **This is not a Razorpay integration test.** No Razorpay credentials exist, no
 * sandbox call has been made, and no signature Razorpay actually produced has
 * ever been checked. What is tested here is the HMAC comparison itself and the
 * refusal to act without credentials — both of which can be reasoned about
 * without an account, and both of which must be right before an account is
 * connected.
 *
 * The event translation is checked against the published payload shape, not
 * against anything observed. See PENDING_RAZORPAY_VERIFICATION in
 * docs/payment-architecture.md.
 */
const SECRET = 'test-webhook-secret-not-from-razorpay';

const configWith = (credentials: Record<string, string>) =>
  ({
    get: () => ({
      intentExpiryMinutes: 30,
      razorpay: { keyId: '', keySecret: '', webhookSecret: '', ...credentials },
    }),
  }) as unknown as ConfigService;

const configured = () =>
  new RazorpayPaymentProvider(
    configWith({ keyId: 'rzp_test_x', keySecret: 'secret', webhookSecret: SECRET }),
  );

const sign = (body: string) => createHmac('sha256', SECRET).update(body, 'utf8').digest('hex');

const captureEvent = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: 'evt_test_1',
    event: 'payment.captured',
    payload: {
      payment: {
        entity: { id: 'pay_test_1', order_id: 'order_test_1', amount: 105000, ...overrides },
      },
    },
  });

describe('RazorpayPaymentProvider', () => {
  describe('without credentials', () => {
    const provider = new RazorpayPaymentProvider(configWith({}));

    it('reports itself as not configured', () => {
      expect(provider.status()).toBe(PaymentProviderStatus.NOT_CONFIGURED);
    });

    it('refuses to create a payment rather than pretending', async () => {
      await expect(
        provider.createPayment({
          restaurantId: 1,
          orderId: 1,
          amountPaise: '105000',
          currency: 'INR',
          reference: 'x',
        }),
      ).rejects.toThrow(ProviderNotConfiguredError);
    });

    it('refuses to verify a webhook', () => {
      expect(() => provider.verifyWebhook('{}', 'sig')).toThrow(ProviderNotConfiguredError);
    });

    it('is not configured when only some credentials are present', () => {
      // A key without a webhook secret can take money it cannot then confirm,
      // which is the worst of the three states to be in.
      expect(
        new RazorpayPaymentProvider(configWith({ keyId: 'x', keySecret: 'y' })).status(),
      ).toBe(PaymentProviderStatus.NOT_CONFIGURED);
      expect(
        new RazorpayPaymentProvider(configWith({ keyId: 'x', webhookSecret: 'z' })).status(),
      ).toBe(PaymentProviderStatus.NOT_CONFIGURED);
    });
  });

  describe('with credentials', () => {
    it('reports itself ready', () => {
      expect(configured().status()).toBe(PaymentProviderStatus.READY);
    });

    it('accepts a correctly signed body', () => {
      const body = captureEvent();
      const result = configured().verifyWebhook(body, sign(body));

      expect(result.providerEventId).toBe('evt_test_1');
      expect(result.status).toBe(PaymentStatus.CAPTURED);
      expect(result.providerPaymentId).toBe('pay_test_1');
      // Razorpay speaks in paise already, so nothing is scaled.
      expect(result.amountPaise).toBe('105000');
    });

    it('refuses a body that was changed after signing', () => {
      const body = captureEvent();
      const signature = sign(body);
      const tampered = captureEvent({ amount: 1 });

      expect(() => configured().verifyWebhook(tampered, signature)).toThrow(
        WebhookVerificationError,
      );
    });

    it('refuses a missing signature', () => {
      const body = captureEvent();

      expect(() => configured().verifyWebhook(body, undefined)).toThrow(/no signature/i);
    });

    it('refuses a signature of the wrong length without throwing on the comparison', () => {
      const body = captureEvent();

      expect(() => configured().verifyWebhook(body, 'short')).toThrow(WebhookVerificationError);
    });

    it('refuses a signature made with a different secret', () => {
      const body = captureEvent();
      const wrong = createHmac('sha256', 'someone-elses-secret').update(body).digest('hex');

      expect(() => configured().verifyWebhook(body, wrong)).toThrow(/did not match/i);
    });

    it('says nothing useful about why verification failed', () => {
      const body = captureEvent();

      // The message must not help an attacker refine a forgery.
      expect(() => configured().verifyWebhook(body, 'a'.repeat(64))).toThrow(/did not match/i);
      expect(() => configured().verifyWebhook(body, 'a'.repeat(64))).not.toThrow(/expected/i);
    });
  });

  describe('translating events', () => {
    const translate = (event: string, entity: Record<string, unknown> = {}) => {
      const body = JSON.stringify({
        id: 'evt_x',
        event,
        payload: { payment: { entity: { id: 'pay_x', amount: 105000, ...entity } } },
      });

      return configured().verifyWebhook(body, sign(body));
    };

    it('maps the events that matter', () => {
      expect(translate('payment.captured').status).toBe(PaymentStatus.CAPTURED);
      expect(translate('payment.authorized').status).toBe(PaymentStatus.AUTHORIZED);
      expect(translate('payment.failed').status).toBe(PaymentStatus.FAILED);
      expect(translate('refund.processed').status).toBe(PaymentStatus.REFUNDED);
    });

    it('treats anything unrecognised as still pending rather than guessing', () => {
      expect(translate('payment.something.new').status).toBe(PaymentStatus.PENDING);
    });

    it('carries a failure reason through', () => {
      expect(
        translate('payment.failed', { error_description: 'Card declined by issuing bank' })
          .failureReason,
      ).toBe('Card declined by issuing bank');
    });

    it('refuses a delivery with no event id, because it could not be deduplicated', () => {
      const body = JSON.stringify({ event: 'payment.captured', payload: {} });

      expect(() => configured().verifyWebhook(body, sign(body))).toThrow(/no event id/i);
    });
  });
});
