import { PaymentProviderName, PaymentProviderStatus, PaymentStatus } from 'src/common/enums';

/**
 * What Plateo needs from anyone who moves money.
 *
 * Everything here is in Plateo's own terms. No provider type appears in this
 * file and none should appear outside the provider that produces it: the moment
 * a Razorpay shape reaches a service, swapping provider means rewriting the
 * service, and the restaurant's billing logic becomes hostage to a vendor.
 *
 * Amounts are whole paise, as a string, because they come from a BIGINT column
 * and JavaScript numbers stop being exact above 2^53. A bill will never reach
 * that, but the conversion habit is what keeps it true.
 */

/** What a provider was asked to collect. */
export interface CreatePaymentRequest {
  restaurantId: number;
  orderId: number | null;
  amountPaise: string;
  currency: string;
  /** Carried to the provider so its dashboard can be matched against ours. */
  reference: string;
  metadata?: Record<string, unknown>;
}

/** What a provider says about a payment, translated. */
export interface ProviderPayment {
  providerPaymentId: string | null;
  providerOrderId: string | null;
  status: PaymentStatus;
  amountPaise: string;
  currency: string;
  failureReason?: string | null;
  /** Anything client-safe the browser needs to open a checkout. Never a secret. */
  clientContext?: Record<string, unknown>;
}

/** A delivery, once its signature has been checked and its body understood. */
export interface VerifiedWebhook {
  providerEventId: string;
  eventType: string;
  providerPaymentId: string | null;
  providerOrderId: string | null;
  /** The state this event says the payment has reached. */
  status: PaymentStatus;
  amountPaise: string | null;
  failureReason?: string | null;
}

export interface RefundRequest {
  providerPaymentId: string;
  amountPaise: string;
  reason?: string;
}

export interface RefundResult {
  providerRefundId: string;
  amountPaise: string;
  status: PaymentStatus;
}

export interface PaymentProvider {
  readonly name: PaymentProviderName;

  /**
   * Whether this provider can be used right now.
   *
   * A provider whose credentials are missing reports NOT_CONFIGURED and refuses
   * to act. It never falls back to pretending a payment succeeded - a mock that
   * can reach production is worse than no provider at all.
   */
  status(): PaymentProviderStatus;

  createPayment(request: CreatePaymentRequest): Promise<ProviderPayment>;

  fetchPayment(providerPaymentId: string): Promise<ProviderPayment>;

  /**
   * Checks a delivery really came from the provider, using the raw body.
   *
   * The raw body, not the parsed object: a signature covers the exact bytes
   * sent, and re-serialising JSON changes them.
   */
  verifyWebhook(rawBody: string, signature: string | undefined): VerifiedWebhook;

  refundPayment(request: RefundRequest): Promise<RefundResult>;
}

/** Raised when something is asked of a provider that cannot do it yet. */
export class ProviderNotConfiguredError extends Error {
  constructor(readonly provider: PaymentProviderName) {
    super(
      `The ${provider} payment provider is not configured. ` +
        'Add its credentials before taking payments through it.',
    );
    this.name = 'ProviderNotConfiguredError';
  }
}

/** Raised when a delivery cannot be trusted. Never log the signature itself. */
export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}
