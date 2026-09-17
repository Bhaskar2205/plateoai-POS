import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Not, Repository } from 'typeorm';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/create-category.dto';
import { QueryCategoryDto } from './dto/query-category.dto';
import { Category } from './entities/category.entity';

/**
 * Every method takes `restaurantId` as its first argument and folds it into the
 * WHERE clause. A category from another tenant is reported as 404, not 403, so
 * the API does not confirm that someone else's id exists.
 */
@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly categoriesRepository: Repository<Category>,
  ) {}

  async create(restaurantId: number, dto: CreateCategoryDto): Promise<Category> {
    await this.assertNameIsFree(restaurantId, dto.name);

    const category = this.categoriesRepository.create({
      restaurantId,
      name: dto.name,
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    });

    return this.categoriesRepository.save(category);
  }

  findAll(restaurantId: number, query: QueryCategoryDto = {}): Promise<Category[]> {
    return this.categoriesRepository.find({
      where: {
        restaurantId,
        ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async findOne(restaurantId: number, id: number): Promise<Category> {
    const category = await this.categoriesRepository.findOne({ where: { id, restaurantId } });

    if (!category) {
      throw new NotFoundException(`Category ${id} was not found.`);
    }

    return category;
  }

  async update(restaurantId: number, id: number, dto: UpdateCategoryDto): Promise<Category> {
    const category = await this.findOne(restaurantId, id);

    if (dto.name !== undefined && dto.name !== category.name) {
      await this.assertNameIsFree(restaurantId, dto.name, id);
      category.name = dto.name;
    }

    if (dto.sortOrder !== undefined) category.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) category.isActive = dto.isActive;

    return this.categoriesRepository.save(category);
  }

  /**
   * Deleting a category does not delete its dishes: the FK is ON DELETE SET
   * NULL, so they become uncategorised and stay on the menu.
   */
  async remove(restaurantId: number, id: number): Promise<void> {
    const category = await this.findOne(restaurantId, id);
    await this.categoriesRepository.remove(category);
  }

  /** Confirms a category belongs to the tenant - used when creating dishes. */
  async existsInRestaurant(
    restaurantId: number,
    categoryId: number,
    manager?: EntityManager,
  ): Promise<boolean> {
    const repository = manager ? manager.getRepository(Category) : this.categoriesRepository;
    const count = await repository.count({ where: { id: categoryId, restaurantId } });
    return count > 0;
  }

  /**
   * Names are unique per restaurant (enforced by `UQ_categories_restaurant_name`);
   * this check turns the raw constraint violation into a clear 409.
   */
  private async assertNameIsFree(
    restaurantId: number,
    name: string,
    excludeId?: number,
  ): Promise<void> {
    const clash = await this.categoriesRepository.count({
      where: {
        restaurantId,
        name,
        ...(excludeId ? { id: Not(excludeId) } : {}),
      },
    });

    if (clash > 0) {
      throw new ConflictException(`A category named "${name}" already exists.`);
    }
  }
}
