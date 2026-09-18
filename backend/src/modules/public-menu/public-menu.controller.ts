import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from 'src/common/decorators/public.decorator';
import { ErrorResponseDto } from 'src/common/dto/error-response.dto';
import { PublicMenuDto } from './dto/public-menu.dto';
import { PublicMenuService } from './public-menu.service';

/**
 * The only anonymous read surface over restaurant data. GET-only: no write
 * route exists under `/public`, so other methods fall through to 404.
 */
@ApiTags('Public menu')
@Controller('public/restaurants')
export class PublicMenuController {
  constructor(private readonly publicMenuService: PublicMenuService) {}

  @Public()
  @Get(':slug/menu')
  // No caching: a dish the kitchen marks unavailable must disappear from the
  // public menu on the next request, not after a cache lifetime.
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Public restaurant menu',
    description:
      'No authentication. Returns an active restaurant\'s active categories and available dishes, ' +
      'with prices, preparation time, ingredients, declared allergens and restaurant-declared ' +
      'nutrition. Unavailable dishes, inactive categories and private restaurant data are never ' +
      'included. Unknown and suspended restaurants return the same 404.\n\n' +
      'With `?table=<table identifier from the QR code>` the menu is served for that table and ' +
      'includes its name. The table must exist, belong to this restaurant and be active; otherwise ' +
      'the response is a 404 that does not say which of those checks failed.',
  })
  @ApiParam({ name: 'slug', example: 'the-green-bowl' })
  @ApiQuery({
    name: 'table',
    required: false,
    description: 'Table identifier from the table QR code URL.',
    example: 'Qm9sZF9yYW5kb21fdG9rZW5fMzJjaGFy',
  })
  @ApiOkResponse({ type: PublicMenuDto })
  @ApiNotFoundResponse({
    description: 'No active restaurant with this slug, or the table is unknown, elsewhere or inactive.',
    type: ErrorResponseDto,
  })
  // A raw query value rather than a DTO: the global pipe forbids unknown query
  // keys, and QR links shared onwards pick up tracking parameters (utm_*, fbclid).
  getMenu(@Param('slug') slug: string, @Query('table') table?: unknown): Promise<PublicMenuDto> {
    return this.publicMenuService.getMenu(slug, table);
  }
}
