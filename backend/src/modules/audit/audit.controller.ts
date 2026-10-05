import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActiveRestaurantId } from 'src/common/decorators/active-restaurant.decorator';
import { ApiAuth } from 'src/common/decorators/api-auth.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { ErrorResponseDto } from 'src/common/dto/error-response.dto';
import { RESTAURANT_ADMIN_ROLES } from 'src/common/enums';
import { AuditQueryService } from './audit-query.service';
import { AuditLogPageDto, QueryAuditLogsDto } from './dto/audit-log.dto';

/**
 * The restaurant's own history of who changed what.
 *
 * Owners and Plateo support only. Not managers: a manager is one of the people
 * the log exists to record, and letting the recorded read the record is how a
 * log stops being evidence. Waiters and kitchen screens have no access at all.
 *
 * Read-only by construction - there is no route here that writes, and the
 * application issues no update or delete against the table anywhere.
 */
@ApiTags('Audit log')
@ApiAuth()
@Roles(...RESTAURANT_ADMIN_ROLES)
@Controller('restaurants/me/audit-logs')
export class AuditController {
  constructor(private readonly auditQueryService: AuditQueryService) {}

  @Get()
  @ApiOperation({
    summary: 'What changed, and who changed it',
    description:
      'Newest first. Filter by date range, action, entity type or member, and page through the ' +
      'results. Records are written by the services that make the change, never by the browser: ' +
      'anything financial is written in the same transaction as the change itself, so a bill that ' +
      'rolled back leaves no trace of having been settled.',
  })
  @ApiOkResponse({ type: AuditLogPageDto })
  @ApiBadRequestResponse({ description: 'Malformed date range or filter.', type: ErrorResponseDto })
  find(
    @ActiveRestaurantId() restaurantId: number,
    @Query() query: QueryAuditLogsDto,
  ): Promise<AuditLogPageDto> {
    return this.auditQueryService.find(restaurantId, query);
  }
}
