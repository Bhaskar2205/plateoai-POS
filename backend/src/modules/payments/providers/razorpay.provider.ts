import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PaymentProviderName, PaymentProviderStatus, PaymentStatus } from 'src/common/enums';
import type { AppConfig } from 'src/config/configuration';
import {
  CreatePaymentRequest,
  PaymentProvider,
  ProviderNotConfiguredError,
  ProviderPayment,
  RefundRequest,
  RefundResult,
  VerifiedWebhook,
  WebhookVerificationError,
} from './payment-provider.interface';

/**
 * Razorpay.
 *
 * **Nothing in here has been run against Razorpay.** No credentials exist in this
 * project, so no sandbox call has been made, no real webhook has been verified,
 * and the response shapes below are written from the published API rather than
 * from anything observed. Treat this file as unverified until the checks in
 * `docs/payment-architecture.md` under PENDING_RAZORPAY_VERIFICATION have been
 * carried out against the sandbox.
 *
 * What it will not do is pretend. Without all three credentials it reports
 * NOT_CONFIGURED and every method throws. There is deliberately no mock path and
 * no "development mode" that returns a successful payment, because that path
 * would eventually reach production and mark unpaid bills as paid.
 *
 * Signature verification is written out in full because it can be reasoned about
 * without a live account - HMAC-SHA256 over the raw body, compared in constant
 * time - but it has never been checked against a signature Razorpay actually
 * produced, and that is the single most important thing to verify first.
 */
@Injectable()
export class RazorpayPaymentProvider implements PaymentProvider {
  readonly name = PaymentProviderName.RAZORPAY;

  constructor(private readonly configService: ConfigService) {}

  private credentials(): AppConfig['payments']['razorpay'] {
    return this.configService.get<AppConfig['payments']>('payments')!.razorpay;
  }

  status(): PaymentProviderStatus {
    const { keyId, keySecret, webhookSecret } = this.credentials();

    // All three or none. A key without a webhook secret can take money it cannot
    // then confirm, which is the worst of the three states to be in.
    return keyId && keySecret && webhookSecret
      ? PaymentProviderStatus.READY
      : PaymentProviderStatus.NOT_CONFIGURED;
  }

  private assertConfigured(): void {
    if (this.status() !== PaymentProviderStatus.READY) {
      throw new ProviderNotConfiguredError(this.name);
    }
  }

  async createPayment(_request: CreatePaymentRequest): Promise<ProviderPayment> {
    this.assertConfigured();

    // Deliberately unimplemented. Writing the HTTP call without being able to run
    // it once would produce code that looks finished and has never worked.
    throw new ProviderNotConfiguredError(this.name);
  }

  async fetchPayment(_providerPaymentId: string): Promise<ProviderPayment> {
    this.assertConfigured();

    throw new ProviderNotConfiguredError(this.name);
  }

  /**
   * Checks a delivery came from Razorpay.
   *
   * HMAC-SHA256 of the **raw** request body with the webhook secret, compared
   * against `X-Razorpay-Signature` in constant time. The raw body matters: the
   * signature covers the exact bytes sent, and `JSON.stringify` of a parsed body
   * can reorder keys or change number formatting and will not match.
   *
   * Unverified against a real Razorpay signature.
   */
  verifyWebhook(rawBody: string, signature: string | undefined): VerifiedWebhook {
    this.assertConfigured();

    if (!signature) {
      throw new WebhookVerificationError('The delivery carried no signature.');
    }

    const { webhookSecret } = this.credentials();
    const expected = createHmac('sha256', webhookSecret).update(rawBody, 'utf8').digest('hex');

    const given = Buffer.from(signature, 'utf8');
    const mine = Buffer.from(expected, 'utf8');

    // Length is checked first because timingSafeEqual throws on a mismatch, and
    // the comparison itself is constant time so a wrong signature cannot be
    // narrowed down byte by byte.
    if (given.length !== mine.length || !timingSafeEqual(given, mine)) {
      throw new WebhookVerificationError('The signature did not match.');
    }

    return this.translate(rawBody);
  }

  /** Razorpay's event shape, turned into Plateo's. */
  private translate(rawBody: string): VerifiedWebhook {
    const event = JSON.parse(rawBody) as {
      id?: string;
      event?: string;
      payload?: { payment?: { entity?: Record<string, unknown> } };
    };

    const entity = event.payload?.payment?.entity ?? {};
    const eventType = event.event ?? 'unknown';

    const status = ((): PaymentStatus => {
      switch (eventType) {
        case 'payment.captured':
          return PaymentStatus.CAPTURED;
        case 'payment.authorized':
          return PaymentStatus.AUTHORIZED;
        case 'payment.failed':
          return PaymentStatus.FAILED;
        case 'refund.processed':
          return PaymentStatus.REFUNDED;
        default:
          return PaymentStatus.PENDING;
      }
    })();

    if (!event.id) {
      throw new WebhookVerificationError('The delivery carried no event id.');
    }

    return {
      providerEventId: event.id,
      eventType,
      providerPaymentId: typeof entity.id === 'string' ? entity.id : null,
      providerOrderId: typeof entity.order_id === 'string' ? entity.order_id : null,
      status,
      // Razorpay speaks in paise already, which is why nothing is scaled here.
      amountPaise: typeof entity.amount === 'number' ? String(entity.amount) : null,
      failureReason:
        typeof entity.error_description === 'string' ? entity.error_description : null,
    };
  }

  async refundPayment(_request: RefundRequest): Promise<RefundResult> {
    this.assertConfigured();

    throw new ProviderNotConfiguredError(this.name);
  }
}
