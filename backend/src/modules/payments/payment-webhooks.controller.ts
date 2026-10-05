import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Public } from 'src/common/decorators/public.decorator';
import { PaymentProviderName } from 'src/common/enums';
import { GENERAL_THROTTLE } from 'src/common/throttling';
import { PaymentWebhooksService } from './payment-webhooks.service';
import { WebhookVerificationError } from './providers/payment-provider.interface';

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

/**
 * Where payment providers deliver.
 *
 * Public, because a provider has no Plateo account — which is exactly why the
 * signature is the only thing that makes a delivery trustworthy. Nothing in the
 * body is believed until it verifies, and a failed verification is answered with
 * a flat 400 that says nothing about why.
 *
 * Rate limited despite being a legitimate endpoint: the URL is effectively
 * public knowledge once configured, and an attacker who cannot forge a signature
 * can still send a great many unsigned requests.
 */
@ApiTags('Payments')
@Controller('payments')
export class PaymentWebhooksController {
  constructor(private readonly webhooks: PaymentWebhooksService) {}

  @Public()
  @Throttle({ [GENERAL_THROTTLE.name]: { limit: 120, ttl: 60_000 } })
  @Post(':provider/webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Receive a payment provider webhook',
    description:
      'Verifies the signature against the raw body, then processes the event once. A repeated ' +
      'delivery is answered with success without re-running anything, because a provider that ' +
      'does not get a 2xx keeps retrying.',
  })
  @ApiExcludeEndpoint()
  async receive(
    @Param('provider') provider: string,
    @Req() request: RawBodyRequest,
    @Headers('x-razorpay-signature') razorpaySignature?: string,
  ): Promise<{ received: true; status: string; detail: string }> {
    const name = provider.toUpperCase() as PaymentProviderName;

    if (!Object.values(PaymentProviderName).includes(name)) {
      throw new BadRequestException('Unknown payment provider.');
    }

    // The exact bytes received. A re-serialised body will not match the
    // signature: JSON.stringify can reorder keys and change number formatting.
    const raw = request.rawBody?.toString('utf8');

    if (!raw) {
      throw new BadRequestException(
        'The raw request body was not available, so the signature could not be checked.',
      );
    }

    try {
      const result = await this.webhooks.handle(name, raw, razorpaySignature);

      return { received: true, status: result.status, detail: result.detail };
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        // Deliberately uninformative. Telling a caller *why* a signature failed
        // helps them produce a better forgery.
        throw new BadRequestException('Could not verify this delivery.');
      }

      throw error;
    }
  }
}
