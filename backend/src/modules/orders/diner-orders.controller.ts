import { Body, Controller, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { IdempotencyKeyHeader } from 'src/common/decorators/request-context.decorator';
import { Public } from 'src/common/decorators/public.decorator';
import { ErrorResponseDto } from 'src/common/dto/error-response.dto';
import { GENERAL_THROTTLE } from 'src/common/throttling';
import { DinerOrdersService } from './diner-orders.service';
import { DinerOrderReceiptDto } from './dto/diner-order.dto';
import { PlaceDinerOrderDto } from './dto/order-input.dto';

/**
 * Diner self-ordering from a table QR code: the only anonymous *write* in Plateo.
 *
 * Because it is anonymous, it is narrow on purpose. A diner can add requests to
 * their own table and nothing else - they cannot discount, settle, cancel, read a
 * bill or reach another table. Requests land as pending and are invisible to the
 * kitchen until staff approve them at the table.
 *
 * Rate limited far tighter than the rest of the API: a QR code is printed in
 * public, so this endpoint's address is effectively public knowledge, and 10
 * submissions a minute is well above real ordering and well below useful abuse.
 */
@ApiTags('Public menu')
@Controller('public/restaurants')
export class DinerOrdersController {
  constructor(private readonly dinerOrdersService: DinerOrdersService) {}

  @Public()
  @Throttle({ [GENERAL_THROTTLE.name]: { limit: 10, ttl: 60_000 } })
  @Post(':slug/orders')
  @ApiOperation({
    summary: 'Place an order from a table QR menu',
    description:
      'No authentication: the table QR token is the only thing that identifies the caller, and the ' +
      '`?table=` value from the QR link is required. Send dish ids and quantities; prices come from ' +
      'the menu. The lines are added to the table\'s bill as *pending* and reach the kitchen only ' +
      'once a member of staff approves them.\n\n' +
      'The response confirms what was requested. It deliberately excludes the bill and its totals: ' +
      'a table QR code is printed in public, and it should not let anyone watch a bill from a distance.',
  })
  @ApiParam({ name: 'slug', example: 'the-green-bowl' })
  @ApiQuery({
    name: 'table',
    required: true,
    description: 'Table identifier from the table QR code URL.',
    example: 'Qm9sZF9yYW5kb21fdG9rZW5fMzJjaGFy',
  })
  @ApiCreatedResponse({ type: DinerOrderReceiptDto })
  @ApiBadRequestResponse({
    description: 'A dish is unavailable, or too many requests are already waiting at this table.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'No active restaurant with this slug, or the table is unknown, elsewhere or inactive.',
    type: ErrorResponseDto,
  })
  // A raw query value rather than a DTO: the global pipe forbids unknown query
  // keys, and QR links shared onwards pick up tracking parameters (utm_*, fbclid).
  placeOrder(
    @Param('slug') slug: string,
    @Body() dto: PlaceDinerOrderDto,
    @IdempotencyKeyHeader() idempotencyKey?: string,
    @Query('table') table?: unknown,
  ): Promise<DinerOrderReceiptDto> {
    return this.dinerOrdersService.placeOrder(slug, table, dto, idempotencyKey);
  }
}
