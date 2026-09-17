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
  ApiTags,
} from '@nestjs/swagger';
import { ActiveRestaurantId } from 'src/common/decorators/active-restaurant.decorator';
import { ApiAuth } from 'src/common/decorators/api-auth.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { ErrorResponseDto } from 'src/common/dto/error-response.dto';
import { MENU_WRITE_ROLES } from 'src/common/enums';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/create-category.dto';
import { QueryCategoryDto } from './dto/query-category.dto';
import { Category } from './entities/category.entity';

@ApiTags('Categories')
@ApiAuth()
@ApiNotFoundResponse({
  description: 'No such category in the authenticated restaurant.',
  type: ErrorResponseDto,
})
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  @Roles(...MENU_WRITE_ROLES)
  @ApiOperation({ summary: 'Create a menu category' })
  @ApiCreatedResponse({ type: Category })
  @ApiConflictResponse({
    description: 'A category with this name already exists in the restaurant.',
    type: ErrorResponseDto,
  })
  create(
    @ActiveRestaurantId() restaurantId: number,
    @Body() dto: CreateCategoryDto,
  ): Promise<Category> {
    return this.categoriesService.create(restaurantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List categories, ordered by sortOrder then name' })
  @ApiOkResponse({ type: [Category] })
  findAll(
    @ActiveRestaurantId() restaurantId: number,
    @Query() query: QueryCategoryDto,
  ): Promise<Category[]> {
    return this.categoriesService.findAll(restaurantId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one category' })
  @ApiOkResponse({ type: Category })
  findOne(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<Category> {
    return this.categoriesService.findOne(restaurantId, id);
  }

  @Patch(':id')
  @Roles(...MENU_WRITE_ROLES)
  @ApiOperation({ summary: 'Update a category' })
  @ApiOkResponse({ type: Category })
  @ApiConflictResponse({ description: 'Duplicate category name.', type: ErrorResponseDto })
  update(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCategoryDto,
  ): Promise<Category> {
    return this.categoriesService.update(restaurantId, id, dto);
  }

  @Delete(':id')
  @Roles(...MENU_WRITE_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a category',
    description: 'Dishes in the category are kept and become uncategorised.',
  })
  @ApiNoContentResponse({ description: 'Category deleted.' })
  remove(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.categoriesService.remove(restaurantId, id);
  }
}
