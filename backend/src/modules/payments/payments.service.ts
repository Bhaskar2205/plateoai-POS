import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  AuditAction,
  AuditEntity,
  IdempotencyScope,
  OrderStatus,
  PaymentProviderName,
  PaymentStatus,
  PaymentMethod,
  ReconciliationIssue,
} from 'src/common/enums';
import { AuditService, type AuditContext } from 'src/modules/audit/audit.service';
import { IdempotencyService } from 'src/modules/idempotency/idempotency.service';
import { Order } from 'src/modules/orders/entities/order.entity';
import { OrdersService } from 'src/modules/orders/orders.service';
import { PaymentIntent } from './entities/payment-intent.entity';
import { PaymentReconciliationException } from './entities/payment-reconciliation-exception.entity';
import { assertAmountMatches, calculatePayableAmount, formatPaise } from './payable-amount';
import { applyTransition, isSettleable, timestampFieldFor } from './payment-state';
import { PaymentProviderFactory } from './providers/payment-provider.factory';

/**
 * Taking money for a bill.
 *
 * The whole design rests on one separation: a payment reaching CAPTURED and a
 * bill being settled are two different events, and the second only ever follows
 * the first after the amount has been checked. Collapsing them - settling because
 * a provider said something happened - is how a restaurant ends up with a closed
 * bill and no money.
 *
 * Nothing here trusts a caller for an amount. A request names a bill; the server
 * reads what that bill is owed.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(PaymentIntent)
    private readonly intentsRepository: Repository<PaymentIntent>,
    @InjectRepository(PaymentReconciliationException)
    private readonly exceptionsRepository: Repository<PaymentReconciliationException>,
    @InjectRepository(Order) private readonly ordersRepository: Repository<Order>,
    private readonly providers: PaymentProviderFactory,
    private readonly idempotencyService: IdempotencyService,
    private readonly auditService: AuditService,
    private readonly ordersService: OrdersService,
  ) {}

  /**
   * Opens an attempt to collect what a bill is owed.
   *
   * Several intents per bill is normal: a declined card is an ordinary event and
   * the guest has to be able to try again without the restaurant opening a second
   * bill. What is not allowed is two *live* attempts at once, because then a
   * guest can pay twice.
   */
  async createIntent(
    restaurantId: number,
    input: { orderId: number; provider: PaymentProviderName },
    userId: number | null,
    context?: AuditContext,
    idempotencyKey?: string,
  ): Promise<PaymentIntent> {
    const outcome = await this.idempotencyService.run(
      {
        scope: IdempotencyScope.PAYMENT_INTENT_CREATE,
        key: idempotencyKey,
        restaurantId,
        payload: input,
        resourceType: 'PAYMENT_INTENT',
      },
      () => this.createIntentOnce(restaurantId, input, userId, context, idempotencyKey),
    );

    return outcome.result;
  }

  private async createIntentOnce(
    restaurantId: number,
    input: { orderId: number; provider: PaymentProviderName },
    userId: number | null,
    context?: AuditContext,
    idempotencyKey?: string,
  ): Promise<PaymentIntent> {
    const order = await this.ordersRepository.findOne({
      where: { id: input.orderId, restaurantId },
    });

    // Another restaurant's bill is absent, not forbidden - the same rule the
    // rest of the API follows, so a probe cannot learn an id exists.
    if (!order) throw new NotFoundException(`Bill ${input.orderId} was not found.`);

    if (order.status !== OrderStatus.OPEN) {
      throw new BadRequestException('That bill is already settled or voided.');
    }

    // Refuses a provider whose credentials are missing, rather than quietly
    // using a different one.
    this.providers.require(input.provider);

    const amountPaise = calculatePayableAmount(order);

    if (BigInt(amountPaise) <= 0n) {
      throw new BadRequestException('There is nothing to pay on that bill yet.');
    }

    const live = await this.intentsRepository.find({
      where: { restaurantId, orderId: order.id },
    });

    const outstanding = live.find((intent) =>
      [PaymentStatus.CREATED, PaymentStatus.PENDING, PaymentStatus.AUTHORIZED].includes(
        intent.status,
      ),
    );

    // Hand back the attempt already in flight rather than opening a second one
    // the guest could also pay.
    if (outstanding) return outstanding;

    const alreadyPaid = live.find((intent) => intent.status === PaymentStatus.CAPTURED);
    if (alreadyPaid) {
      throw new BadRequestException('That bill has already been paid.');
    }

    const intent = await this.intentsRepository.save(
      this.intentsRepository.create({
        restaurantId,
        orderId: order.id,
        billId: order.id,
        amountPaise,
        currency: 'INR',
        status: PaymentStatus.CREATED,
        provider: input.provider,
        idempotencyKey: idempotencyKey ?? null,
        metadata: { orderNumber: order.orderNumber },
      }),
    );

    await this.auditService.record({
      restaurantId,
      userId,
      action: AuditAction.PAYMENT_INTENT_CREATED,
      entityType: AuditEntity.PAYMENT,
      entityId: intent.id,
      newValue: {
        orderId: order.id,
        provider: input.provider,
        amount: formatPaise(amountPaise),
      },
      context,
    });

    return intent;
  }

  /**
   * Moves a payment to a new state, and settles the bill when money lands.
   *
   * All of it in one transaction. A capture that cannot settle - because the
   * amount disagrees, or because the bill is already closed - must not leave the
   * payment marked captured, or the next reconciliation would see money against
   * a bill nobody can account for.
   */
  async markStatus(
    intentId: number,
    next: PaymentStatus,
    details: {
      providerPaymentId?: string | null;
      providerOrderId?: string | null;
      amountPaise?: string | null;
      failureReason?: string | null;
      userId?: number | null;
      context?: AuditContext;
    } = {},
  ): Promise<{ intent: PaymentIntent; changed: boolean; settledOrderId: number | null }> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(PaymentIntent);
      const intent = await repository.findOne({ where: { id: intentId } });

      if (!intent) throw new NotFoundException(`Payment ${intentId} was not found.`);

      const { status, changed } = applyTransition(intent.status, next);

      if (!changed) {
        // A repeat delivery. Deliberately not an error, and deliberately no
        // second audit record.
        return { intent, changed: false, settledOrderId: null };
      }

      if (details.amountPaise) {
        // The provider's figure against the bill's, exactly. A mismatch stops
        // the transition rather than being rounded away.
        assertAmountMatches(intent.amountPaise, details.amountPaise);
      }

      intent.status = status;
      if (details.providerPaymentId) intent.providerPaymentId = details.providerPaymentId;
      if (details.providerOrderId) intent.providerOrderId = details.providerOrderId;
      if (details.failureReason !== undefined) intent.failureReason = details.failureReason ?? null;

      const stamp = timestampFieldFor(status);
      if (stamp) intent[stamp] = new Date();

      await repository.save(intent);

      await this.auditService.recordIn(manager, {
        restaurantId: intent.restaurantId,
        userId: details.userId ?? null,
        action: AUDIT_FOR_STATUS[status] ?? AuditAction.PAYMENT_FAILED,
        entityType: AuditEntity.PAYMENT,
        entityId: intent.id,
        oldValue: { status: intent.status === status ? undefined : status },
        newValue: {
          status,
          amount: formatPaise(intent.amountPaise),
          provider: intent.provider,
          ...(details.failureReason ? { failureReason: details.failureReason } : {}),
        },
        context: details.context,
      });

      const settledOrderId = isSettleable(status)
        ? await this.settleFor(manager, intent, details.context)
        : null;

      return { intent, changed: true, settledOrderId };
    });
  }

  /**
   * Settles the bill a captured payment belongs to.
   *
   * Reuses the till's own settlement, so the claim that stops two tills settling
   * at once also stops a webhook settling a bill a waiter just closed. A bill
   * that is already settled is not an error here - the money is captured either
   * way - but it is written down for reconciliation, because a guest paying
   * online for a bill the till already took in cash is a real thing that needs a
   * person.
   */
  private async settleFor(
    manager: EntityManager,
    intent: PaymentIntent,
    context?: AuditContext,
  ): Promise<number | null> {
    if (intent.orderId === null) return null;

    const order = await manager.getRepository(Order).findOne({ where: { id: intent.orderId } });

    if (!order) return null;

    if (order.status !== OrderStatus.OPEN) {
      await this.recordExceptionIn(manager, {
        restaurantId: intent.restaurantId,
        issue: ReconciliationIssue.WEBHOOK_AFTER_UNEXPECTED_STATE,
        paymentIntentId: intent.id,
        orderId: order.id,
        detail:
          `Payment of ${formatPaise(intent.amountPaise)} was captured but bill #${order.orderNumber} ` +
          `was already ${order.status.toLowerCase()}.`,
        context: { orderStatus: order.status, amount: formatPaise(intent.amountPaise) },
      });

      return null;
    }

    // Outside the manager on purpose: settlement runs its own transaction with
    // the claim on the open bill, which is the protection we must not bypass.
    await this.ordersService.settleForPayment(
      intent.restaurantId,
      order.id,
      { paymentMethod: PAYMENT_METHOD_FOR[intent.provider] },
      context,
    );

    return order.id;
  }

  /** Writes a discrepancy down. Never repairs it. */
  async recordExceptionIn(
    manager: EntityManager,
    entry: {
      restaurantId: number;
      issue: ReconciliationIssue;
      paymentIntentId?: number | null;
      orderId?: number | null;
      detail: string;
      context?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    const repository = manager.getRepository(PaymentReconciliationException);

    await repository.save(
      repository.create({
        restaurantId: entry.restaurantId,
        issue: entry.issue,
        paymentIntentId: entry.paymentIntentId ?? null,
        orderId: entry.orderId ?? null,
        detail: entry.detail,
        context: entry.context ?? null,
      }),
    );

    await this.auditService.recordIn(manager, {
      restaurantId: entry.restaurantId,
      userId: null,
      action: AuditAction.PAYMENT_RECONCILIATION_EXCEPTION,
      entityType: AuditEntity.PAYMENT,
      entityId: entry.paymentIntentId ?? null,
      newValue: { issue: entry.issue },
      reason: entry.detail.slice(0, 255),
    });

    this.logger.warn(`Reconciliation exception (${entry.issue}): ${entry.detail}`);
  }

  findOne(restaurantId: number, id: number): Promise<PaymentIntent | null> {
    return this.intentsRepository.findOne({ where: { id, restaurantId } });
  }

  findForRestaurant(restaurantId: number, limit = 100): Promise<PaymentIntent[]> {
    return this.intentsRepository.find({
      where: { restaurantId },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: limit,
    });
  }

  findByProviderPayment(
    provider: PaymentProviderName,
    providerPaymentId: string,
  ): Promise<PaymentIntent | null> {
    return this.intentsRepository.findOne({ where: { provider, providerPaymentId } });
  }
}

/** The audit action each state change deserves. */
const AUDIT_FOR_STATUS: Partial<Record<PaymentStatus, AuditAction>> = {
  [PaymentStatus.AUTHORIZED]: AuditAction.PAYMENT_AUTHORIZED,
  [PaymentStatus.CAPTURED]: AuditAction.PAYMENT_CAPTURED,
  [PaymentStatus.FAILED]: AuditAction.PAYMENT_FAILED,
  [PaymentStatus.CANCELLED]: AuditAction.PAYMENT_CANCELLED,
  [PaymentStatus.REFUNDED]: AuditAction.PAYMENT_REFUNDED,
  [PaymentStatus.PARTIALLY_REFUNDED]: AuditAction.PAYMENT_REFUNDED,
};

/**
 * How a settled bill records the money.
 *
 * An online payment is recorded as OTHER rather than being given its own method,
 * because adding one would change what every existing report means by "card" and
 * "UPI". The payment row carries which provider it really was.
 */
const PAYMENT_METHOD_FOR: Record<PaymentProviderName, PaymentMethod> = {
  [PaymentProviderName.PLATEO_INTERNAL]: PaymentMethod.OTHER,
  [PaymentProviderName.RAZORPAY]: PaymentMethod.OTHER,
  [PaymentProviderName.CASHFREE_FUTURE]: PaymentMethod.OTHER,
};
