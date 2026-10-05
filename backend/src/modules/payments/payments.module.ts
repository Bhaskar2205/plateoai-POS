import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from 'src/modules/orders/entities/order.entity';
import { OrdersModule } from 'src/modules/orders/orders.module';
import { PaymentIntent } from './entities/payment-intent.entity';
import { PaymentReconciliationException } from './entities/payment-reconciliation-exception.entity';
import { PaymentWebhookEvent } from './entities/payment-webhook-event.entity';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import { PaymentWebhooksController } from './payment-webhooks.controller';
import { PaymentWebhooksService } from './payment-webhooks.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { InternalPaymentProvider } from './providers/internal.provider';
import { PaymentProviderFactory } from './providers/payment-provider.factory';
import { RazorpayPaymentProvider } from './providers/razorpay.provider';

/**
 * Taking money.
 *
 * Depends on orders, never the other way round: a bill knows nothing about how
 * it was paid beyond its payment method, so ordering and billing keep working
 * untouched if this module is never used. Cash, UPI, card and "other" settlement
 * are unaffected.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentIntent,
      PaymentWebhookEvent,
      PaymentReconciliationException,
      Order,
    ]),
    OrdersModule,
  ],
  controllers: [PaymentsController, PaymentWebhooksController],
  providers: [
    PaymentsService,
    PaymentWebhooksService,
    PaymentReconciliationService,
    PaymentProviderFactory,
    InternalPaymentProvider,
    RazorpayPaymentProvider,
  ],
  exports: [PaymentsService, PaymentReconciliationService],
})
export class PaymentsModule {}
