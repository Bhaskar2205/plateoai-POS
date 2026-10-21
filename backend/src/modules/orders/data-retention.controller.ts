import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ActiveRestaurantId } from 'src/common/decorators/active-restaurant.decorator';
import { ApiAuth } from 'src/common/decorators/api-auth.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequestContext } from 'src/common/decorators/request-context.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { ErrorResponseDto } from 'src/common/dto/error-response.dto';
import { RESTAURANT_ADMIN_ROLES } from 'src/common/enums';
import type { AuditContext } from 'src/modules/audit/audit.service';
import { ReportRangeDto } from 'src/modules/reports/dto/report-range.dto';
import { DataRetentionService } from './data-retention.service';
import {
  DeleteTradingDataDto,
  TradingDataDeletedDto,
  TradingDataSummaryDto,
} from './dto/data-retention.dto';

/**
 * Erasing trading history.
 *
 * Owners only, and separate from the orders controller on purpose: everything
 * else under `/orders` is a restaurant running its service, and this is a
 * restaurant destroying the record of one. Keeping it at its own path means the
 * role check is one line rather than a condition inside a shared controller.
 */
@ApiTags('Reports')
@ApiAuth()
@Roles(...RESTAURANT_ADMIN_ROLES)
@Controller('restaurants/me/data')
export class DataRetentionController {
  constructor(private readonly dataRetentionService: DataRetentionService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'What erasing a date range would destroy',
    description:
      'Counts the bills, lines, kitchen tickets and charges in the range, and what those bills ' +
      'took, so an owner sees the size of it before confirming. Says whether the range can be ' +
      'deleted at all: one bill still open blocks it.',
  })
  @ApiOkResponse({ type: TradingDataSummaryDto })
  summary(
    @ActiveRestaurantId() restaurantId: number,
    @Query() range: ReportRangeDto,
  ): Promise<TradingDataSummaryDto> {
    const today = new Date().toISOString().slice(0, 10);

    return this.dataRetentionService.summarise(restaurantId, range.from ?? today, range.to ?? today);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Erase a range of trading data permanently',
    description:
      'Owners only. Deletes every bill with a business date in the range, and with them their ' +
      'lines, kitchen tickets and tax breakdown. There is no undo and no recycle bin.\n\n' +
      "The restaurant's own name must be sent in `confirmName`. A range containing an open bill " +
      'is refused. An audit record carrying the totals is written in the same transaction and ' +
      'survives the deletion - afterwards it is the only account of what was there. ' +
      'Payment-gateway records are detached rather than deleted.',
  })
  @ApiOkResponse({ type: TradingDataDeletedDto })
  @ApiBadRequestResponse({ description: 'The name does not match, or the range is backwards.', type: ErrorResponseDto })
  @ApiConflictResponse({ description: 'A bill in the range is still open, or there is nothing to delete.', type: ErrorResponseDto })
  remove(
    @ActiveRestaurantId() restaurantId: number,
    @Body() dto: DeleteTradingDataDto,
    @CurrentUser('id') userId: number,
    @RequestContext() context: AuditContext,
  ): Promise<TradingDataDeletedDto> {
    return this.dataRetentionService.deleteRange(restaurantId, dto, userId, context);
  }
}
