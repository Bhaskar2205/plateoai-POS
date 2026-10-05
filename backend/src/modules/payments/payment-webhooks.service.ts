import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import {
  PaymentProviderName,
  ReconciliationIssue,
  WebhookEventStatus,
} from 'src/common/enums';
import { isDuplicateKeyError } from 'src/modules/orders/order-writer';
import { PaymentWebhookEvent } from './entities/payment-webhook-event.entity';
import { formatPaise } from './payable-amount';
import { PaymentsService } from './payments.service';
import { PaymentProviderFactory } from './providers/payment-provider.factory';
import { WebhookVerificationError } from './providers/payment-provider.interface';

/**
 * Handling what a payment provider tells us.
 *
 * Order matters, and it is the order below: verify the signature **before**
 * reading the body for anything, claim the event id **before** acting on it, and
 * only then move the payment. Reversing any pair of those is a way to be told
 * what to do by anyone who can reach the URL.
 *
 * Providers retry. A delivery arriving three times is correct provider
 * behaviour, not an attack, and the second and third must be answered with a
 * success - otherwise the provider keeps retrying forever. The unique index on
 * (provider, event id) is what makes that safe: the duplicate collides on insert
 * and never reaches the business transition.
 */
@Injectable()
export class PaymentWebhooksService {
  private readonly logger = new Logger(PaymentWebhooksService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(PaymentWebhookEvent)
    private readonly eventsRepository: Repository<PaymentWebhookEvent>,
    private readonly providers: PaymentProviderFactory,
    private readonly paymentsService: PaymentsService,
  ) {}

  /**
   * Processes one delivery.
   *
   * `rawBody` is the exact bytes received. A re-serialised body will not match
   * the signature, so the caller must keep the original.
   */
  async handle(
    providerName: PaymentProviderName,
    rawBody: string,
    signature: string | undefined,
  ): Promise<{ status: WebhookEventStatus; detail: string }> {
    const provider = this.providers.require(providerName);

    // 1. Signature first. Nothing below this line trusts the body, and an
    //    unverified body is never parsed into a decision.
    const verified = provider.verifyWebhook(rawBody, signature);

    const payloadHash = createHash('sha256').update(rawBody, 'utf8').digest('hex');

    // 2. Claim the event id. Losing this race means somebody else already has it.
    const claimed = await this.claim(providerName, verified.providerEventId, verified.eventType, payloadHash);

    if (!claimed) {
      // Already handled. A success, so the provider stops retrying.
      return { status: WebhookEventStatus.DUPLICATE, detail: 'Already processed.' };
    }

    try {
      const intent = verified.providerPaymentId
        ? await this.paymentsService.findByProviderPayment(providerName, verified.providerPaymentId)
        : null;

      if (!intent) {
        // Money we have no record of. Not an error to the provider - retrying
        // will not help - but absolutely something a person must see.
        await this.dataSource.transaction((manager) =>
          this.paymentsService.recordExceptionIn(manager, {
            restaurantId: 0,
            issue: ReconciliationIssue.UNKNOWN_PROVIDER_PAYMENT,
            detail:
              `A ${providerName} ${verified.eventType} arrived for payment ` +
              `${verified.providerPaymentId ?? 'with no id'}, which matches no payment in Plateo.`,
            context: { eventType: verified.eventType, providerPaymentId: verified.providerPaymentId },
          }),
        );

        await this.finish(claimed.id, WebhookEventStatus.IGNORED, null, 'No matching payment.');

        return { status: WebhookEventStatus.IGNORED, detail: 'No matching payment.' };
      }

      const result = await this.paymentsService.markStatus(intent.id, verified.status, {
        providerPaymentId: verified.providerPaymentId,
        providerOrderId: verified.providerOrderId,
        amountPaise: verified.amountPaise,
        failureReason: verified.failureReason ?? null,
      });

      await this.finish(claimed.id, WebhookEventStatus.PROCESSED, intent.id, null);

      return {
        status: WebhookEventStatus.PROCESSED,
        detail: result.changed
          ? `Payment ${intent.id} is now ${result.intent.status}.`
          : `Payment ${intent.id} was already ${result.intent.status}.`,
      };
    } catch (error) {
      const message = (error as Error).message;

      // The delivery is recorded as failed and kept: the event id stays claimed,
      // so a retry does not re-run a transition that may have half happened, and
      // the row is what tells a person to look.
      await this.finish(claimed.id, WebhookEventStatus.FAILED, null, message);
      this.logger.error(`Webhook ${verified.providerEventId} failed: ${message}`);

      throw error;
    }
  }

  /** Inserts the event row, or returns null when somebody already has it. */
  private async claim(
    provider: PaymentProviderName,
    providerEventId: string,
    eventType: string,
    payloadHash: string,
  ): Promise<PaymentWebhookEvent | null> {
    try {
      return await this.eventsRepository.save(
        this.eventsRepository.create({
          provider,
          providerEventId,
          eventType,
          payloadHash,
          status: WebhookEventStatus.PROCESSED,
        }),
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) return null;

      throw error;
    }
  }

  private async finish(
    id: number,
    status: WebhookEventStatus,
    paymentIntentId: number | null,
    errorMessage: string | null,
  ): Promise<void> {
    await this.eventsRepository.update(
      { id },
      {
        status,
        paymentIntentId,
        processedAt: new Date(),
        errorMessage: errorMessage?.slice(0, 500) ?? null,
      },
    );
  }

  /** Turns a verification failure into the one thing a caller should learn: no. */
  static isVerificationFailure(error: unknown): boolean {
    return error instanceof WebhookVerificationError;
  }

  /** For the operational view: what has been arriving. */
  recent(limit = 100): Promise<PaymentWebhookEvent[]> {
    return this.eventsRepository.find({ order: { createdAt: 'DESC', id: 'DESC' }, take: limit });
  }

  describeAmount = formatPaise;
}
