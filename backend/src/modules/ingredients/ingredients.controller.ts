import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ActiveRestaurantId } from 'src/common/decorators/active-restaurant.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequestContext } from 'src/common/decorators/request-context.decorator';
import { ApiAuth } from 'src/common/decorators/api-auth.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { ErrorResponseDto } from 'src/common/dto/error-response.dto';
import { MENU_WRITE_ROLES } from 'src/common/enums';
import { CreateIngredientDto, UpdateIngredientDto } from './dto/create-ingredient.dto';
import { Ingredient } from './entities/ingredient.entity';
import { AuditContext } from 'src/modules/audit/audit.service';
import { IngredientsService } from './ingredients.service';

@ApiTags('Ingredients')
@ApiAuth()
@ApiNotFoundResponse({
  description: 'No such ingredient in the authenticated restaurant.',
  type: ErrorResponseDto,
})
@Controller('ingredients')
export class IngredientsController {
  constructor(private readonly ingredientsService: IngredientsService) {}

  @Post()
  @Roles(...MENU_WRITE_ROLES)
  @ApiOperation({
    summary: 'Create an ingredient',
    description:
      'Ingredients are a per-restaurant pantry: create each one once and reference it from as ' +
      'many dishes as needed.',
  })
  @ApiCreatedResponse({ type: Ingredient })
  @ApiConflictResponse({
    description: 'An ingredient with this name already exists.',
    type: ErrorResponseDto,
  })
  create(
    @ActiveRestaurantId() restaurantId: number,
    @CurrentUser('id') userId: number,
    @Body() dto: CreateIngredientDto,
    @RequestContext() context: AuditContext,
  ): Promise<Ingredient> {
    return this.ingredientsService.create(restaurantId, dto, userId, context);
  }

  @Get()
  @ApiOperation({ summary: 'List ingredients' })
  @ApiQuery({ name: 'search', required: false, description: 'Case-insensitive name filter.' })
  @ApiOkResponse({ type: [Ingredient] })
  findAll(
    @ActiveRestaurantId() restaurantId: number,
    @Query('search') search?: string,
  ): Promise<Ingredient[]> {
    return this.ingredientsService.findAll(restaurantId, search);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one ingredient' })
  @ApiOkResponse({ type: Ingredient })
  findOne(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<Ingredient> {
    return this.ingredientsService.findOne(restaurantId, id);
  }

  @Patch(':id')
  @Roles(...MENU_WRITE_ROLES)
  @ApiOperation({ summary: 'Update an ingredient' })
  @ApiOkResponse({ type: Ingredient })
  @ApiConflictResponse({ description: 'Duplicate ingredient name.', type: ErrorResponseDto })
  update(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateIngredientDto,
  ): Promise<Ingredient> {
    return this.ingredientsService.update(restaurantId, id, dto);
  }

  @Delete(':id')
  @Roles(...MENU_WRITE_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an ingredient',
    description: 'Also removes the ingredient from every recipe that referenced it.',
  })
  @ApiNoContentResponse({ description: 'Ingredient deleted.' })
  remove(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.ingredientsService.remove(restaurantId, id);
  }
}
