import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, In, IsNull, LessThan, Repository } from 'typeorm';
import { OrderStatus, PaymentStatus, ReconciliationIssue } from 'src/common/enums';
import type { AppConfig } from 'src/config/configuration';
import { Order } from 'src/modules/orders/entities/order.entity';
import { PaymentIntent } from './entities/payment-intent.entity';
import { PaymentReconciliationException } from './entities/payment-reconciliation-exception.entity';
import { calculatePayableAmount, formatPaise } from './payable-amount';
import { PaymentsService } from './payments.service';

/**
 * Looking for money that does not add up.
 *
 * It never fixes anything. Repairing a financial discrepancy destroys the
 * evidence of how it arose, and the second time it happens nobody can tell
 * whether it is the same fault or a new one. Every finding becomes a row a person
 * reads and decides about.
 *
 * Run on demand rather than on a timer: with more than one instance a timer
 * means every instance sweeps, and a sweep that runs N times writes N copies of
 * every exception.
 */
@Injectable()
export class PaymentReconciliationService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(PaymentIntent)
    private readonly intentsRepository: Repository<PaymentIntent>,
    @InjectRepository(PaymentReconciliationException)
    private readonly exceptionsRepository: Repository<PaymentReconciliationException>,
    @InjectRepository(Order) private readonly ordersRepository: Repository<Order>,
    private readonly paymentsService: PaymentsService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Sweeps one restaurant and records what it finds.
   *
   * Returns what was found this run, so a caller can report it without reading
   * the table back.
   */
  async sweep(restaurantId: number): Promise<{
    checked: number;
    found: Array<{ issue: ReconciliationIssue; detail: string }>;
  }> {
    const found: Array<{ issue: ReconciliationIssue; detail: string }> = [];

    const intents = await this.intentsRepository.find({ where: { restaurantId } });
    const orderIds = [...new Set(intents.map((i) => i.orderId).filter((id): id is number => id !== null))];
    const orders = orderIds.length
      ? await this.ordersRepository.find({ where: { id: In(orderIds) } })
      : [];
    const byOrderId = new Map(orders.map((order) => [order.id, order]));

    const record = async (
      issue: ReconciliationIssue,
      detail: string,
      extra: { paymentIntentId?: number | null; orderId?: number | null; context?: Record<string, unknown> } = {},
    ) => {
      // Already raised and unresolved: do not raise it again every sweep.
      const existing = await this.exceptionsRepository.findOne({
        where: {
          restaurantId,
          issue,
          paymentIntentId: extra.paymentIntentId ?? IsNull(),
          resolvedAt: IsNull(),
        },
      });

      if (existing) return;

      await this.dataSource.transaction((manager) =>
        this.paymentsService.recordExceptionIn(manager, {
          restaurantId,
          issue,
          detail,
          paymentIntentId: extra.paymentIntentId ?? null,
          orderId: extra.orderId ?? null,
          context: extra.context ?? null,
        }),
      );

      found.push({ issue, detail });
    };

    // 1. Money taken against a bill still sitting open.
    for (const intent of intents.filter((i) => i.status === PaymentStatus.CAPTURED)) {
      const order = intent.orderId === null ? null : byOrderId.get(intent.orderId);

      if (order && order.status === OrderStatus.OPEN) {
        await record(
          ReconciliationIssue.PAYMENT_CAPTURED_BILL_OPEN,
          `Payment of ${formatPaise(intent.amountPaise)} was captured but bill #${order.orderNumber} is still open.`,
          { paymentIntentId: intent.id, orderId: order.id },
        );
      }

      // 2. The amount taken no longer matches what the bill says it is owed.
      if (order) {
        const expected = calculatePayableAmount(order);

        if (BigInt(expected) !== BigInt(intent.amountPaise) && order.status === OrderStatus.OPEN) {
          await record(
            ReconciliationIssue.AMOUNT_MISMATCH,
            `Bill #${order.orderNumber} is owed ${formatPaise(expected)} but ${formatPaise(intent.amountPaise)} was taken.`,
            {
              paymentIntentId: intent.id,
              orderId: order.id,
              context: { expected: formatPaise(expected), taken: formatPaise(intent.amountPaise) },
            },
          );
        }
      }
    }

    // 3. Two captured payments against one bill: somebody paid twice.
    const capturedByOrder = new Map<number, PaymentIntent[]>();
    for (const intent of intents.filter((i) => i.status === PaymentStatus.CAPTURED && i.orderId)) {
      const list = capturedByOrder.get(intent.orderId!) ?? [];
      list.push(intent);
      capturedByOrder.set(intent.orderId!, list);
    }

    for (const [orderId, list] of capturedByOrder) {
      if (list.length > 1) {
        await record(
          ReconciliationIssue.DUPLICATE_PROVIDER_PAYMENT,
          `Bill #${byOrderId.get(orderId)?.orderNumber ?? orderId} has ${list.length} captured payments.`,
          { paymentIntentId: list[1].id, orderId, context: { intents: list.map((i) => i.id) } },
        );
      }
    }

    // 4. An attempt that never finished, long past the point it could.
    const expiryMinutes =
      this.configService.get<AppConfig['payments']>('payments')?.intentExpiryMinutes ?? 30;
    const cutoff = new Date(Date.now() - expiryMinutes * 60 * 1000);

    const stale = await this.intentsRepository.find({
      where: {
        restaurantId,
        status: In([PaymentStatus.CREATED, PaymentStatus.PENDING, PaymentStatus.AUTHORIZED]),
        createdAt: LessThan(cutoff),
      },
    });

    for (const intent of stale) {
      await record(
        ReconciliationIssue.STALE_PENDING_PAYMENT,
        `A payment of ${formatPaise(intent.amountPaise)} has been ${intent.status.toLowerCase()} since ` +
          `${intent.createdAt.toISOString()}, longer than the ${expiryMinutes}-minute window.`,
        { paymentIntentId: intent.id, orderId: intent.orderId },
      );
    }

    // 5. A bill settled through a provider with no payment behind it. Only
    //    provider settlements are checked - cash is settled by a person, and
    //    expecting a payment row for it would flag every cash bill.
    const settledWithProvider = await this.ordersRepository.find({
      where: { restaurantId, status: OrderStatus.SETTLED },
      take: 500,
      order: { id: 'DESC' },
    });

    const intentsByOrder = new Set(
      intents.filter((i) => i.status === PaymentStatus.CAPTURED).map((i) => i.orderId),
    );

    for (const order of settledWithProvider) {
      const hadIntent = intents.some((i) => i.orderId === order.id);

      // Only a bill that started an online payment and then settled without one
      // completing is suspicious.
      if (hadIntent && !intentsByOrder.has(order.id)) {
        await record(
          ReconciliationIssue.BILL_SETTLED_PAYMENT_MISSING,
          `Bill #${order.orderNumber} settled, but the online payment it started never completed.`,
          { orderId: order.id },
        );
      }
    }

    return { checked: intents.length, found };
  }

  /** Everything still waiting on a person. */
  open(restaurantId: number): Promise<PaymentReconciliationException[]> {
    return this.exceptionsRepository.find({
      where: { restaurantId, resolvedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }

  /** Marks one as dealt with. The row stays; that is the point of it. */
  async resolve(restaurantId: number, id: number, note: string): Promise<void> {
    await this.exceptionsRepository.update(
      { id, restaurantId },
      { resolvedAt: new Date(), resolutionNote: note.slice(0, 500) },
    );
  }
}
