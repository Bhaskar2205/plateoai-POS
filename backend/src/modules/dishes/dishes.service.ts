import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Like, Repository } from 'typeorm';
import { CategoriesService } from 'src/modules/categories/categories.service';
import { IngredientsService } from 'src/modules/ingredients/ingredients.service';
import { assertIngredientsOwned, replaceRecipe } from './dish-recipe.writer';
import { CreateDishDto, UpdateDishDto } from './dto/create-dish.dto';
import { QueryDishDto } from './dto/query-dish.dto';
import { Dish } from './entities/dish.entity';

@Injectable()
export class DishesService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Dish)
    private readonly dishesRepository: Repository<Dish>,
    private readonly categoriesService: CategoriesService,
    private readonly ingredientsService: IngredientsService,
  ) {}

  /**
   * Creates a dish and, when `ingredients` is supplied, its recipe.
   *
   * Ownership of the category and every ingredient is checked before the
   * transaction opens; the dish row and its recipe lines then commit together,
   * so a failure part-way leaves neither behind.
   */
  async create(restaurantId: number, dto: CreateDishDto): Promise<Dish> {
    const categoryId = await this.resolveCategoryId(restaurantId, dto.categoryId);

    if (dto.ingredients) {
      await assertIngredientsOwned(this.ingredientsService, restaurantId, dto.ingredients);
    }

    const dish = this.dishesRepository.create({
      restaurantId,
      categoryId,
      name: dto.name,
      description: dto.description || null,
      price: dto.price,
      imageUrl: dto.imageUrl || null,
      proteinGrams: dto.proteinGrams ?? null,
      calories: dto.calories ?? null,
      carbsGrams: dto.carbsGrams ?? null,
      fatGrams: dto.fatGrams ?? null,
      preparationTimeMinutes: dto.preparationTimeMinutes ?? null,
      dietType: dto.dietType ?? null,
      isAvailable: dto.isAvailable ?? true,
    });

    const saved = await this.dataSource.transaction(async (manager) => {
      const created = await manager.getRepository(Dish).save(dish);

      if (dto.ingredients) {
        await replaceRecipe(manager, created.id, dto.ingredients);
      }

      return created;
    });

    return this.findOne(restaurantId, saved.id);
  }

  findAll(restaurantId: number, query: QueryDishDto = {}): Promise<Dish[]> {
    const search = query.search?.trim();

    return this.dishesRepository.find({
      where: {
        restaurantId,
        ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
        ...(query.isAvailable === undefined ? {} : { isAvailable: query.isAvailable }),
        ...(search ? { name: Like(`%${search}%`) } : {}),
      },
      relations: { category: true },
      order: { name: 'ASC' },
    });
  }

  async findOne(restaurantId: number, id: number): Promise<Dish> {
    const dish = await this.dishesRepository.findOne({
      where: { id, restaurantId },
      relations: { category: true },
    });

    if (!dish) {
      throw new NotFoundException(`Dish ${id} was not found.`);
    }

    return dish;
  }

  /** Ownership check used by the dish-ingredient mapping endpoints. */
  async getOwnedDish(restaurantId: number, id: number): Promise<Dish> {
    const dish = await this.dishesRepository.findOne({ where: { id, restaurantId } });

    if (!dish) {
      throw new NotFoundException(`Dish ${id} was not found.`);
    }

    return dish;
  }

  /**
   * Partial update. When `ingredients` is present the recipe is replaced in the
   * same transaction as the dish fields - both change, or neither does.
   */
  async update(restaurantId: number, id: number, dto: UpdateDishDto): Promise<Dish> {
    const dish = await this.getOwnedDish(restaurantId, id);

    if (dto.categoryId !== undefined) {
      dish.categoryId = await this.resolveCategoryId(restaurantId, dto.categoryId);
    }

    if (dto.ingredients) {
      await assertIngredientsOwned(this.ingredientsService, restaurantId, dto.ingredients);
    }

    if (dto.name !== undefined) dish.name = dto.name;
    if (dto.description !== undefined) dish.description = dto.description || null;
    if (dto.price !== undefined) dish.price = dto.price;
    if (dto.imageUrl !== undefined) dish.imageUrl = dto.imageUrl || null;
    if (dto.proteinGrams !== undefined) dish.proteinGrams = dto.proteinGrams;
    if (dto.calories !== undefined) dish.calories = dto.calories;
    if (dto.carbsGrams !== undefined) dish.carbsGrams = dto.carbsGrams;
    if (dto.fatGrams !== undefined) dish.fatGrams = dto.fatGrams;
    if (dto.preparationTimeMinutes !== undefined) {
      dish.preparationTimeMinutes = dto.preparationTimeMinutes ?? null;
    }
    if (dto.dietType !== undefined) dish.dietType = dto.dietType ?? null;
    if (dto.isAvailable !== undefined) dish.isAvailable = dto.isAvailable;

    const { ingredients } = dto;

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(Dish).save(dish);

      if (ingredients) {
        await replaceRecipe(manager, dish.id, ingredients);
      }
    });

    return this.findOne(restaurantId, id);
  }

  async remove(restaurantId: number, id: number): Promise<void> {
    const dish = await this.getOwnedDish(restaurantId, id);
    await this.dishesRepository.remove(dish);
  }

  /**
   * A dish may only point at a category of its own restaurant. Referencing
   * another tenant's category id is rejected here rather than silently
   * succeeding via the raw foreign key.
   */
  private async resolveCategoryId(
    restaurantId: number,
    categoryId: number | null | undefined,
  ): Promise<number | null> {
    if (categoryId === undefined || categoryId === null) {
      return null;
    }

    const belongs = await this.categoriesService.existsInRestaurant(restaurantId, categoryId);

    if (!belongs) {
      throw new BadRequestException(
        `Category ${categoryId} does not belong to this restaurant.`,
      );
    }

    return categoryId;
  }
}
