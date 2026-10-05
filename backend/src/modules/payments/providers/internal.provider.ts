import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PaymentProviderName, PaymentProviderStatus, PaymentStatus } from 'src/common/enums';
import {
  CreatePaymentRequest,
  PaymentProvider,
  ProviderPayment,
  RefundRequest,
  RefundResult,
  VerifiedWebhook,
  WebhookVerificationError,
} from './payment-provider.interface';

/**
 * Money the restaurant collects itself: cash, a UPI transfer they watched
 * arrive, a card machine that is not ours.
 *
 * It is a provider because the alternative is worse. Without it, half the
 * payments in the system would be `PaymentIntent` rows and half would be a
 * `paymentMethod` string on an order, and every report would have to know about
 * both. With it, there is one place that answers "what was paid, and how".
 *
 * It calls nothing and verifies nothing, because there is nothing to call: a
 * member of staff looked at the cash. What it does give is the same record, the
 * same state machine and the same audit trail as an online payment.
 *
 * This is **not** a mock of an online provider. It never appears as a fallback
 * when a real provider is unconfigured - that substitution is exactly how a
 * system ends up marking unpaid bills as paid.
 */
@Injectable()
export class InternalPaymentProvider implements PaymentProvider {
  readonly name = PaymentProviderName.PLATEO_INTERNAL;

  status(): PaymentProviderStatus {
    // Always usable: taking cash needs no configuration.
    return PaymentProviderStatus.READY;
  }

  createPayment(request: CreatePaymentRequest): Promise<ProviderPayment> {
    // The staff member is the authorisation. The money is not captured here -
    // that happens when the till settles, through the same transition every
    // other payment goes through.
    return Promise.resolve({
      providerPaymentId: `internal_${randomUUID()}`,
      providerOrderId: null,
      status: PaymentStatus.PENDING,
      amountPaise: request.amountPaise,
      currency: request.currency,
    });
  }

  fetchPayment(providerPaymentId: string): Promise<ProviderPayment> {
    // There is no remote state to ask about; ours is the only record.
    return Promise.resolve({
      providerPaymentId,
      providerOrderId: null,
      status: PaymentStatus.PENDING,
      amountPaise: '0',
      currency: 'INR',
    });
  }

  verifyWebhook(): VerifiedWebhook {
    // Nothing delivers webhooks for cash. Reaching here means a caller routed a
    // delivery to the wrong provider, which is worth failing loudly over.
    throw new WebhookVerificationError('Internal payments do not receive webhooks.');
  }

  refundPayment(request: RefundRequest): Promise<RefundResult> {
    // Refunding cash is handing cash back; the record follows the act.
    return Promise.resolve({
      providerRefundId: `internal_refund_${randomUUID()}`,
      amountPaise: request.amountPaise,
      status: PaymentStatus.REFUNDED,
    });
  }
}
