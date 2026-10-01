import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ActiveRestaurantId } from 'src/common/decorators/active-restaurant.decorator';
import { ApiAuth } from 'src/common/decorators/api-auth.decorator';
import { KitchenScreen } from 'src/common/decorators/kitchen-screen.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { ErrorResponseDto } from 'src/common/dto/error-response.dto';
import { KITCHEN_ROLES } from 'src/common/enums';
import { QueryKotTicketsDto, UpdateKotStatusDto } from './dto/order-actions.dto';
import { KitchenTicketDto } from './dto/order.dto';
import { KitchenService } from './kitchen.service';

/**
 * The kitchen panel.
 *
 * Open to kitchen staff as well as management, and to nobody else. Every response
 * here is deliberately free of money: the kitchen sees dishes, quantities,
 * requests and how long a ticket has been waiting. A kitchen display is often a
 * shared screen on a wall, so it must be safe for anyone in the room to read.
 */
@ApiTags('Kitchen')
@ApiAuth()
@Roles(...KITCHEN_ROLES)
// The one place a kitchen screen signed in with a kitchen code may reach.
@KitchenScreen()
@ApiNotFoundResponse({
  description: 'No such ticket in the authenticated restaurant.',
  type: ErrorResponseDto,
})
@Controller('restaurants/me/kitchen')
export class KitchenController {
  constructor(private readonly kitchenService: KitchenService) {}

  @Get('tickets')
  @ApiOperation({
    summary: 'Today\'s kitchen tickets, oldest first',
    description:
      'Defaults to the tickets the kitchen still has work on (NEW, PREPARING, READY). Scoped to the ' +
      'current business day, which starts at 05:00 local time, so a late service stays on one screen.',
  })
  @ApiOkResponse({ type: [KitchenTicketDto] })
  findTickets(
    @ActiveRestaurantId() restaurantId: number,
    @Query() query: QueryKotTicketsDto,
  ): Promise<KitchenTicketDto[]> {
    return this.kitchenService.findTickets(restaurantId, query);
  }

  @Get('tickets/:id')
  @ApiOperation({ summary: 'One kitchen ticket' })
  @ApiOkResponse({ type: KitchenTicketDto })
  findTicket(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<KitchenTicketDto> {
    return this.kitchenService.findTicket(restaurantId, id);
  }

  @Patch('tickets/:id')
  @ApiOperation({
    summary: 'Move a ticket along',
    description:
      'NEW to PREPARING to READY to DONE, and cancellable from any of those. READY can be pulled ' +
      'back to PREPARING, because it gets tapped by mistake. DONE and CANCELLED are final.',
  })
  @ApiOkResponse({ type: KitchenTicketDto })
  @ApiBadRequestResponse({ description: 'That is not a valid move for this ticket.', type: ErrorResponseDto })
  updateStatus(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateKotStatusDto,
  ): Promise<KitchenTicketDto> {
    return this.kitchenService.updateStatus(restaurantId, id, dto.status);
  }

  @Post('tickets/:id/printed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record that a ticket was printed',
    description: 'Lets staff tell an unprinted ticket from one the printer has already produced.',
  })
  @ApiOkResponse({ type: KitchenTicketDto })
  markPrinted(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<KitchenTicketDto> {
    return this.kitchenService.markPrinted(restaurantId, id);
  }
}
