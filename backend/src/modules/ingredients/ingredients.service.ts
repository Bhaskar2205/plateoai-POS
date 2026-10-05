import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Like, Not, Repository } from 'typeorm';
import { IngredientCategory, IngredientUnit } from 'src/common/enums';
import { AuditContext } from 'src/modules/audit/audit.service';
import { InventoryService } from 'src/modules/inventory/inventory.service';
import { CreateIngredientDto, UpdateIngredientDto } from './dto/create-ingredient.dto';
import { Ingredient } from './entities/ingredient.entity';

@Injectable()
export class IngredientsService {
  constructor(
    @InjectRepository(Ingredient)
    private readonly ingredientsRepository: Repository<Ingredient>,
    private readonly inventoryService: InventoryService,
  ) {}

  async create(
    restaurantId: number,
    dto: CreateIngredientDto,
    userId?: number,
    context?: AuditContext,
  ): Promise<Ingredient> {
    await this.assertNameIsFree(restaurantId, dto.name);

    const ingredient = await this.ingredientsRepository.save(
      this.ingredientsRepository.create({
        restaurantId,
        name: dto.name,
        description: dto.description || null,
        allergenInfo: dto.allergenInfo || null,
        category: dto.category ?? IngredientCategory.OTHER,
        unit: dto.unit ?? IngredientUnit.GRAM,
        minimumQuantity: dto.minimumQuantity ?? 0,
        reorderQuantity: dto.reorderQuantity ?? 0,
        costPerUnitPaise: String(dto.costPerUnitPaise ?? 0),
        isActive: dto.isActive ?? true,
        // Deliberately not set from the DTO. Opening stock arrives as a movement
        // below, so no stock figure exists that the ledger cannot account for.
        currentQuantity: 0,
      }),
    );

    if (dto.openingQuantity && dto.openingQuantity > 0 && userId !== undefined) {
      await this.inventoryService.recordOpeningStock(
        restaurantId,
        ingredient.id,
        dto.openingQuantity,
        userId,
        context,
      );

      return this.findOne(restaurantId, ingredient.id);
    }

    return ingredient;
  }

  findAll(restaurantId: number, search?: string): Promise<Ingredient[]> {
    const term = search?.trim();

    return this.ingredientsRepository.find({
      where: {
        restaurantId,
        ...(term ? { name: Like(`%${term}%`) } : {}),
      },
      order: { name: 'ASC' },
    });
  }

  async findOne(restaurantId: number, id: number): Promise<Ingredient> {
    const ingredient = await this.ingredientsRepository.findOne({ where: { id, restaurantId } });

    if (!ingredient) {
      throw new NotFoundException(`Ingredient ${id} was not found.`);
    }

    return ingredient;
  }

  async update(restaurantId: number, id: number, dto: UpdateIngredientDto): Promise<Ingredient> {
    const ingredient = await this.findOne(restaurantId, id);

    if (dto.name !== undefined && dto.name !== ingredient.name) {
      await this.assertNameIsFree(restaurantId, dto.name, id);
      ingredient.name = dto.name;
    }

    if (dto.description !== undefined) ingredient.description = dto.description || null;
    if (dto.allergenInfo !== undefined) ingredient.allergenInfo = dto.allergenInfo || null;
    if (dto.category !== undefined) ingredient.category = dto.category;
    if (dto.unit !== undefined) ingredient.unit = dto.unit;
    if (dto.minimumQuantity !== undefined) ingredient.minimumQuantity = dto.minimumQuantity;
    if (dto.reorderQuantity !== undefined) ingredient.reorderQuantity = dto.reorderQuantity;
    if (dto.costPerUnitPaise !== undefined) {
      ingredient.costPerUnitPaise = String(dto.costPerUnitPaise);
    }
    if (dto.isActive !== undefined) ingredient.isActive = dto.isActive;

    // `currentQuantity` is absent on purpose. A stock figure only ever moves
    // through a movement, so there is no way to edit it here and leave the ledger
    // unable to explain it. `openingQuantity` is ignored too: an ingredient only
    // opens once.
    return this.ingredientsRepository.save(ingredient);
  }

  /**
   * Removing an ingredient cascades to its `dish_ingredients` rows, so the
   * recipes that referenced it simply lose that line.
   */
  async remove(restaurantId: number, id: number): Promise<void> {
    const ingredient = await this.findOne(restaurantId, id);
    await this.ingredientsRepository.remove(ingredient);
  }

  /**
   * Loads the subset of `ids` that belong to this restaurant. The dish-ingredient
   * mapping compares the returned count against the requested count to reject
   * any attempt to pull another tenant's ingredient into a recipe.
   */
  findAllByIdsInRestaurant(restaurantId: number, ids: number[]): Promise<Ingredient[]> {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }

    return this.ingredientsRepository.find({ where: { restaurantId, id: In(ids) } });
  }

  private async assertNameIsFree(
    restaurantId: number,
    name: string,
    excludeId?: number,
  ): Promise<void> {
    const clash = await this.ingredientsRepository.count({
      where: {
        restaurantId,
        name,
        ...(excludeId ? { id: Not(excludeId) } : {}),
      },
    });

    if (clash > 0) {
      throw new ConflictException(
        `An ingredient named "${name}" already exists. Reuse it instead of creating a duplicate.`,
      );
    }
  }
}
