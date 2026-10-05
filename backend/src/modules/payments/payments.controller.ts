import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ActiveRestaurantId } from 'src/common/decorators/active-restaurant.decorator';
import { ApiAuth } from 'src/common/decorators/api-auth.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import {
  IdempotencyKeyHeader,
  RequestContext,
} from 'src/common/decorators/request-context.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { ErrorResponseDto } from 'src/common/dto/error-response.dto';
import {
  BILLING_ROLES,
  PaymentProviderStatus,
  RESTAURANT_ADMIN_ROLES,
} from 'src/common/enums';
import type { AppConfig } from 'src/config/configuration';
import type { AuditContext } from 'src/modules/audit/audit.service';
import {
  CreatePaymentIntentDto,
  PaymentIntentDto,
  PaymentSettingsDto,
  ReconciliationExceptionDto,
  ResolveExceptionDto,
} from './dto/payment.dto';
import { PaymentIntent } from './entities/payment-intent.entity';
import { formatPaise } from './payable-amount';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import { PaymentsService } from './payments.service';
import { PaymentProviderFactory } from './providers/payment-provider.factory';

const PROVIDER_LABELS: Record<PaymentProviderStatus, string> = {
  [PaymentProviderStatus.READY]: 'Connected',
  [PaymentProviderStatus.NOT_CONFIGURED]: 'Payment provider not configured',
  [PaymentProviderStatus.UNAVAILABLE]: 'Not available yet',
};

const toDto = (intent: PaymentIntent): PaymentIntentDto => ({
  id: intent.id,
  orderId: intent.orderId,
  orderNumber: (intent.metadata?.orderNumber as number | undefined) ?? null,
  amountPaise: String(intent.amountPaise),
  amount: formatPaise(String(intent.amountPaise)),
  currency: intent.currency,
  status: intent.status,
  provider: intent.provider,
  providerPaymentId: intent.providerPaymentId,
  failureReason: intent.failureReason,
  createdAt: intent.createdAt,
  capturedAt: intent.capturedAt,
});

/**
 * Payments for the authenticated restaurant.
 *
 * Billing roles only - owners and managers, never waiters and never the kitchen.
 * The kitchen's isolation is the point: a screen in the kitchen can be seen by
 * anyone walking past it, and what a table paid is none of its business.
 */
@ApiTags('Payments')
@ApiAuth()
@Roles(...BILLING_ROLES)
@Controller('restaurants/me/payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly reconciliation: PaymentReconciliationService,
    private readonly providers: PaymentProviderFactory,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Payments taken, and attempted',
    description: 'Newest first. Includes failed and abandoned attempts, which are the useful ones.',
  })
  @ApiOkResponse({ type: [PaymentIntentDto] })
  async findAll(@ActiveRestaurantId() restaurantId: number): Promise<PaymentIntentDto[]> {
    return (await this.paymentsService.findForRestaurant(restaurantId)).map(toDto);
  }

  @Get('settings')
  @Roles(...RESTAURANT_ADMIN_ROLES)
  @ApiOperation({
    summary: 'Which payment providers are usable',
    description:
      'Reports each provider and whether it can actually take a payment. Never returns a key, a ' +
      'secret or any part of one. A provider without credentials reports itself as not configured ' +
      'rather than appearing connected.',
  })
  @ApiOkResponse({ type: PaymentSettingsDto })
  settings(): PaymentSettingsDto {
    const providers = this.providers.describeAll().map((entry) => ({
      provider: entry.provider,
      status: entry.status,
      label: PROVIDER_LABELS[entry.status],
      usable: entry.status === PaymentProviderStatus.READY,
    }));

    return {
      providers,
      // The internal provider is always ready, so this asks specifically about
      // the ones that take money online.
      onlinePaymentsAvailable: providers.some(
        (entry) => entry.usable && entry.provider !== 'PLATEO_INTERNAL',
      ),
      intentExpiryMinutes:
        this.configService.get<AppConfig['payments']>('payments')?.intentExpiryMinutes ?? 30,
    };
  }

  @Get('exceptions')
  @ApiOperation({
    summary: 'Money that does not add up',
    description:
      'Everything reconciliation found and nobody has dealt with yet. Plateo never repairs a ' +
      'financial discrepancy on its own: it records it for a person to decide about.',
  })
  @ApiOkResponse({ type: [ReconciliationExceptionDto] })
  async exceptions(
    @ActiveRestaurantId() restaurantId: number,
  ): Promise<ReconciliationExceptionDto[]> {
    return (await this.reconciliation.open(restaurantId)).map((row) => ({
      id: row.id,
      issue: row.issue,
      detail: row.detail,
      paymentIntentId: row.paymentIntentId,
      orderId: row.orderId,
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt,
    }));
  }

  @Post('reconcile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Look for discrepancies now',
    description:
      'Checks captured payments against their bills, finds duplicates, mismatched amounts and ' +
      'attempts that never finished. Records what it finds; changes nothing.',
  })
  @ApiOkResponse({ description: 'What this run found.' })
  reconcile(@ActiveRestaurantId() restaurantId: number) {
    return this.reconciliation.sweep(restaurantId);
  }

  @Post('exceptions/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record that a discrepancy has been dealt with',
    description: 'The row stays, with the note. Deleting it would remove the evidence.',
  })
  @ApiOkResponse({ description: 'Resolved.' })
  async resolve(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResolveExceptionDto,
  ): Promise<{ resolved: true }> {
    await this.reconciliation.resolve(restaurantId, id, dto.note);

    return { resolved: true };
  }

  @Post('intents')
  @ApiOperation({
    summary: 'Start collecting what a bill is owed',
    description:
      'The amount comes from the bill, never from the request: a caller that could name its own ' +
      'amount could name a smaller one. Send an Idempotency-Key so a retry does not open a second ' +
      'attempt the guest could also pay.',
  })
  @ApiCreatedResponse({ type: PaymentIntentDto })
  @ApiBadRequestResponse({
    description: 'The bill is closed, has nothing to pay, or the provider is not configured.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'No such bill in this restaurant.', type: ErrorResponseDto })
  async createIntent(
    @ActiveRestaurantId() restaurantId: number,
    @Body() dto: CreatePaymentIntentDto,
    @CurrentUser('id') userId: number,
    @RequestContext() context: AuditContext,
    @IdempotencyKeyHeader() idempotencyKey: string | undefined,
  ): Promise<PaymentIntentDto> {
    return toDto(
      await this.paymentsService.createIntent(restaurantId, dto, userId, context, idempotencyKey),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'One payment' })
  @ApiOkResponse({ type: PaymentIntentDto })
  @ApiNotFoundResponse({ description: 'No such payment here.', type: ErrorResponseDto })
  async findOne(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PaymentIntentDto> {
    const intent = await this.paymentsService.findOne(restaurantId, id);

    // Another restaurant's payment is absent, not forbidden.
    if (!intent) throw new NotFoundException(`Payment ${id} was not found.`);

    return toDto(intent);
  }

  @Post(':id/refund')
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  @ApiOperation({
    summary: 'Refund a payment — not implemented',
    description:
      'Deliberately absent. A refund has to reduce the day-end takings, reopen or credit the bill, ' +
      'and reverse the tax that was charged on it, and Plateo has no model for any of that yet. ' +
      'Returning money without those would quietly corrupt every report that follows.',
  })
  refund(): never {
    throw new BadRequestException(
      'Refunds are not implemented. Refund through your payment provider and record it on the bill.',
    );
  }
}
