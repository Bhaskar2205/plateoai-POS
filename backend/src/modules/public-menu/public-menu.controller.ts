import { Controller, Get, Header, Param } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
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
      'included. Unknown and suspended restaurants return the same 404.',
  })
  @ApiParam({ name: 'slug', example: 'the-green-bowl' })
  @ApiOkResponse({ type: PublicMenuDto })
  @ApiNotFoundResponse({ description: 'No active restaurant with this slug.', type: ErrorResponseDto })
  getMenu(@Param('slug') slug: string): Promise<PublicMenuDto> {
    return this.publicMenuService.getMenu(slug);
  }
}
