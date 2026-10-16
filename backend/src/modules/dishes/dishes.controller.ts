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
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ActiveRestaurantId } from 'src/common/decorators/active-restaurant.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequestContext } from 'src/common/decorators/request-context.decorator';
import type { AuditContext } from 'src/modules/audit/audit.service';
import { ApiAuth } from 'src/common/decorators/api-auth.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { ErrorResponseDto } from 'src/common/dto/error-response.dto';
import { MENU_WRITE_ROLES, ORDER_WRITE_ROLES } from 'src/common/enums';
import { DishIngredientsService } from './dish-ingredients.service';
import { DishesService } from './dishes.service';
import { CreateDishDto, UpdateDishDto } from './dto/create-dish.dto';
import {
  DishIngredientResponseDto,
  SetDishIngredientsDto,
} from './dto/dish-ingredients.dto';
import { OrderBoardDishDto } from './dto/order-board.dto';
import { QueryDishDto } from './dto/query-dish.dto';
import { Dish } from './entities/dish.entity';

@ApiTags('Dishes')
@ApiAuth()
@ApiNotFoundResponse({
  description: 'No such dish in the authenticated restaurant.',
  type: ErrorResponseDto,
})
@Controller('dishes')
export class DishesController {
  constructor(
    private readonly dishesService: DishesService,
    private readonly dishIngredientsService: DishIngredientsService,
  ) {}

  @Post()
  @Roles(...MENU_WRITE_ROLES)
  @ApiOperation({
    summary: 'Create a dish',
    description:
      'Nutrition fields are optional and stored exactly as the restaurant enters them ' +
      '(protein/carbs/fat in grams, calories in kcal). Plateo does not generate or verify them.',
  })
  @ApiCreatedResponse({ type: Dish })
  @ApiBadRequestResponse({
    description: 'Validation failed, or the category belongs to another restaurant.',
    type: ErrorResponseDto,
  })
  create(@ActiveRestaurantId() restaurantId: number, @Body() dto: CreateDishDto): Promise<Dish> {
    return this.dishesService.create(restaurantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List dishes, optionally filtered by category, availability or name' })
  @ApiOkResponse({ type: [Dish] })
  findAll(
    @ActiveRestaurantId() restaurantId: number,
    @Query() query: QueryDishDto,
  ): Promise<Dish[]> {
    return this.dishesService.findAll(restaurantId, query);
  }

  /**
   * The order board: what a captain needs to punch, and nothing else.
   *
   * Declared before `:id` so the literal path wins the match.
   *
   * Deliberately not the dish row. A dish carries a description, a photo URL,
   * allergens and nutrition - useful to a guest deciding, useless to a waiter
   * who already knows the menu and is standing at a table on mobile data. A
   * hundred dishes at full width is most of a megabyte; this is a few
   * kilobytes, and it is the difference between an app that opens during a rush
   * and one that gets abandoned.
   *
   * Readable by anyone who may take an order, which includes waiters.
   */
  @Get('board')
  @Roles(...ORDER_WRITE_ROLES)
  @ApiOperation({
    summary: 'A slim menu for taking orders',
    description: 'Name, price, course and veg mark only. Unavailable dishes are left out.',
  })
  @ApiOkResponse({ type: [OrderBoardDishDto] })
  board(@ActiveRestaurantId() restaurantId: number): Promise<OrderBoardDishDto[]> {
    return this.dishesService.orderBoard(restaurantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one dish' })
  @ApiOkResponse({ type: Dish })
  findOne(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<Dish> {
    return this.dishesService.findOne(restaurantId, id);
  }

  @Patch(':id')
  @Roles(...MENU_WRITE_ROLES)
  @ApiOperation({
    summary: 'Update a dish',
    description: 'Also used to toggle availability and to correct nutrition values.',
  })
  @ApiOkResponse({ type: Dish })
  update(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDishDto,
    @CurrentUser('id') userId: number,
    @RequestContext() context: AuditContext,
  ): Promise<Dish> {
    return this.dishesService.update(restaurantId, id, dto, userId, context);
  }

  @Delete(':id')
  @Roles(...MENU_WRITE_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a dish and its recipe lines' })
  @ApiNoContentResponse({ description: 'Dish deleted.' })
  remove(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.dishesService.remove(restaurantId, id);
  }

  // --- Dish <-> ingredient mapping -----------------------------------------

  @Get(':id/ingredients')
  @ApiOperation({ summary: 'List the ingredients mapped to a dish' })
  @ApiOkResponse({ type: [DishIngredientResponseDto] })
  getIngredients(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<DishIngredientResponseDto[]> {
    return this.dishIngredientsService.findForDish(restaurantId, id);
  }

  @Post(':id/ingredients')
  @Roles(...MENU_WRITE_ROLES)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add ingredients to a dish',
    description:
      'Adds the listed ingredients, updating the quantity of any already mapped. Every ingredient ' +
      'must belong to the same restaurant as the dish. Applied in a single transaction.',
  })
  @ApiCreatedResponse({ type: [DishIngredientResponseDto] })
  @ApiBadRequestResponse({
    description: 'An ingredient does not belong to this restaurant, or was listed twice.',
    type: ErrorResponseDto,
  })
  addIngredients(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetDishIngredientsDto,
  ): Promise<DishIngredientResponseDto[]> {
    return this.dishIngredientsService.addToDish(restaurantId, id, dto.ingredients);
  }

  @Patch(':id/ingredients')
  @Roles(...MENU_WRITE_ROLES)
  @ApiOperation({
    summary: 'Replace the complete ingredient list of a dish',
    description:
      'The payload is treated as the full recipe: anything missing from it is unmapped. The ' +
      'delete and the inserts run in one transaction.',
  })
  @ApiOkResponse({ type: [DishIngredientResponseDto] })
  @ApiBadRequestResponse({
    description: 'An ingredient does not belong to this restaurant, or was listed twice.',
    type: ErrorResponseDto,
  })
  replaceIngredients(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetDishIngredientsDto,
  ): Promise<DishIngredientResponseDto[]> {
    return this.dishIngredientsService.replaceForDish(restaurantId, id, dto.ingredients);
  }

  @Delete(':id/ingredients/:ingredientId')
  @Roles(...MENU_WRITE_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unmap one ingredient from a dish' })
  @ApiNoContentResponse({ description: 'Ingredient unmapped from the dish.' })
  removeIngredient(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('ingredientId', ParseIntPipe) ingredientId: number,
  ): Promise<void> {
    return this.dishIngredientsService.removeFromDish(restaurantId, id, ingredientId);
  }
}
