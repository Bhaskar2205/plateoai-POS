import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import {
  AuditAction,
  AuditEntity,
  INCOMING_MOVEMENTS,
  IngredientCategory,
  IngredientUnit,
  InventoryMode,
  InventoryMovementType,
  InventoryReferenceType,
  StockAdjustmentReason,
} from 'src/common/enums';
import { businessDateFor } from 'src/common/utils/business-date.util';
import { AuditContext, AuditService } from 'src/modules/audit/audit.service';
import { DishIngredient } from 'src/modules/dishes/entities/dish-ingredient.entity';
import { Dish } from 'src/modules/dishes/entities/dish.entity';
import { Ingredient } from 'src/modules/ingredients/entities/ingredient.entity';
import { OrderItem } from 'src/modules/orders/entities/order-item.entity';
import { wasMade } from 'src/modules/orders/order-mapper';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import {
  InventorySettingsDto,
  StockAdjustmentDto,
  StockCountDto,
  StockInDto,
  WastageDto,
} from './dto/stock.dto';
import { InventoryMovement } from './entities/inventory-movement.entity';
import { formatQuantity, roundQuantity } from './inventory-units';
import { ConsumptionPlan, planConsumption, RecipeLine, SoldLine } from './recipe-consumption';

/** The settings that decide how much notice Plateo takes of stock. */
export interface InventorySettings {
  mode: InventoryMode;
  allowNegativeStock: boolean;
}

interface ApplyMovement {
  restaurantId: number;
  ingredient: Ingredient;
  movementType: InventoryMovementType;
  /** Always positive. Direction comes from the movement type. */
  quantity: number;
  reason?: StockAdjustmentReason | null;
  note?: string | null;
  referenceType?: InventoryReferenceType | null;
  referenceId?: number | null;
  userId: number | null;
  /** When false, a decrease that would go below zero is refused. */
  allowNegative: boolean;
  /** Overrides the ingredient's current cost, for a movement costed elsewhere. */
  valuePaise?: number;
}

export interface StockCountLine {
  ingredientId: number;
  ingredientName: string;
  unit: IngredientUnit;
  /** What Plateo thought was there. */
  expected: number;
  /** What was actually on the shelf. */
  counted: number;
  /** counted - expected. Negative means less was there than the books said. */
  variance: number;
  /** The variance in paise, signed the same way. */
  variancePaise: number;
}

export interface StockCountResult {
  lines: StockCountLine[];
  countedAt: Date;
}

export interface InventoryReportLine {
  ingredientId: number;
  ingredientName: string;
  unit: IngredientUnit;
  category: IngredientCategory;
  /** Used by dishes that were sold. */
  consumed: number;
  consumedPaise: number;
  /** Thrown away. */
  wasted: number;
  wastedPaise: number;
  /** Corrected by hand, signed: negative means the shelf held less than the books. */
  adjusted: number;
  adjustedPaise: number;
  received: number;
  receivedPaise: number;
  /** What is on the shelf now, which is outside the date range on purpose. */
  onHand: number;
  onHandPaise: number;
}

export interface InventoryReport {
  from: string;
  to: string;
  lines: InventoryReportLine[];
  totals: {
    consumedPaise: number;
    wastedPaise: number;
    adjustedPaise: number;
    receivedPaise: number;
    onHandPaise: number;
  };
  /** Ingredients at or below their minimum, worst first. */
  lowStock: Array<{
    ingredientId: number;
    ingredientName: string;
    unit: IngredientUnit;
    onHand: number;
    minimum: number;
    reorderQuantity: number;
  }>;
}

export interface ConsumptionResult {
  /** False when nothing was calculated: inventory off, or no recipes to apply. */
  applied: boolean;
  movements: number;
  skipped: ConsumptionPlan['skipped'];
}

/**
 * Stock.
 *
 * Two rules shape everything here.
 *
 * **The ledger is the truth.** `ingredients.current_quantity` is a running total
 * kept because every screen needs it and summing a ledger on each read does not
 * scale. It is only ever changed by arithmetic inside the database - never read,
 * adjusted in JavaScript and written back - so two people receiving the same
 * delivery at the same moment both count. A read-modify-write would lose one of
 * them silently, and the restaurant would find out at a count six weeks later.
 *
 * **A sale is never blocked by stock.** Consumption runs when the bill settles, by
 * which point the food has been eaten; refusing to settle because a number says
 * the paneer ran out would stop a till mid-service over a figure that is probably
 * the one that is wrong. So consumption applies in full even when it drives stock
 * negative, and the negative figure is surfaced as the warning it is. What
 * `allowNegativeStock` governs is a person typing a decrease by hand, where there
 * is somebody present to be asked.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Ingredient)
    private readonly ingredients: Repository<Ingredient>,
    @InjectRepository(InventoryMovement)
    private readonly movements: Repository<InventoryMovement>,
    @InjectRepository(Restaurant)
    private readonly restaurants: Repository<Restaurant>,
    private readonly auditService: AuditService,
  ) {}

  async settingsFor(restaurantId: number): Promise<InventorySettings> {
    const restaurant = await this.restaurants.findOne({
      where: { id: restaurantId },
      select: ['id', 'inventoryMode', 'allowNegativeStock'],
    });

    if (!restaurant) throw new NotFoundException('Restaurant not found.');

    return {
      mode: restaurant.inventoryMode,
      allowNegativeStock: restaurant.allowNegativeStock,
    };
  }

  /**
   * Turns tracking on or off, and records that somebody did.
   *
   * Audited as its own action: switching the mode changes what settling a bill
   * does, and six weeks later "why did stock stop being deducted" needs an answer
   * better than nobody knowing.
   */
  async updateSettings(
    restaurantId: number,
    dto: InventorySettingsDto,
    userId: number,
    context?: AuditContext,
  ): Promise<InventorySettings> {
    const before = await this.settingsFor(restaurantId);

    const changes: Partial<Restaurant> = {};
    if (dto.inventoryMode !== undefined) changes.inventoryMode = dto.inventoryMode;
    if (dto.inventoryConsumptionMode !== undefined) {
      changes.inventoryConsumptionMode = dto.inventoryConsumptionMode;
    }
    if (dto.allowNegativeStock !== undefined) changes.allowNegativeStock = dto.allowNegativeStock;

    if (Object.keys(changes).length === 0) return before;

    await this.restaurants.update({ id: restaurantId }, changes);

    const after = await this.settingsFor(restaurantId);

    await this.auditService.record({
      restaurantId,
      userId,
      action: AuditAction.INVENTORY_MODE_CHANGED,
      entityType: AuditEntity.RESTAURANT,
      entityId: restaurantId,
      oldValue: { ...before },
      newValue: { ...after },
      context,
    });

    return after;
  }

  /**
   * The one place a stock figure changes.
   *
   * Order matters: the quantity moves first, by arithmetic, with the floor as part
   * of the WHERE clause so the database refuses an overdraw rather than this code
   * checking and hoping. Only then is the ledger row written, and because both
   * happen in the caller's transaction a collision on
   * `UQ_inventory_movements_reference_line` takes the arithmetic back with it.
   */
  private async applyMovementIn(
    manager: EntityManager,
    params: ApplyMovement,
  ): Promise<InventoryMovement> {
    const { ingredient } = params;
    const quantity = roundQuantity(params.quantity);

    if (quantity <= 0) {
      throw new BadRequestException('A stock movement has to be more than nothing.');
    }

    const incoming = INCOMING_MOVEMENTS.includes(params.movementType);
    const delta = incoming ? quantity : -quantity;
    const guarded = !incoming && !params.allowNegative;

    // Arithmetic in the database, through the query builder rather than raw SQL,
    // because the builder reports how many rows it changed on both engines - the
    // SQLite driver the test suite runs on returns nothing useful from a raw
    // UPDATE, and an overdraw that silently reads as success is the one failure
    // this check exists to prevent.
    const update = manager
      .createQueryBuilder()
      .update(Ingredient)
      .set({ currentQuantity: () => 'current_quantity + :delta', updatedAt: () => 'updated_at' })
      .where('id = :id', { id: ingredient.id })
      .andWhere('restaurant_id = :restaurantId', { restaurantId: params.restaurantId })
      .setParameter('delta', delta);

    if (guarded) {
      // The floor belongs in the WHERE clause, not in an `if` above it. Checking
      // first and updating after leaves a window two requests fit through, and
      // both would be told they succeeded.
      update.andWhere('current_quantity >= :needed', { needed: quantity });
    }

    const changed = await update.execute();

    if (!changed.affected) {
      // The ingredient exists - it was loaded in this transaction - so the only
      // clause that can have failed is the floor.
      throw new BadRequestException(
        `There is only ${formatQuantity(ingredient.currentQuantity, ingredient.unit)} of ` +
          `${ingredient.name} in stock, so ${formatQuantity(quantity, ingredient.unit)} cannot be ` +
          `taken out. Record what arrived first, or allow negative stock in settings if the ` +
          `kitchen really did use more than Plateo knows about.`,
      );
    }

    const after = await this.readQuantityIn(manager, params.restaurantId, ingredient.id);
    // Derived from the figure the database landed on rather than from what was
    // read before the update, so a movement that landed in between is reflected
    // instead of overwritten.
    const before = roundQuantity(after - delta);

    const value =
      params.valuePaise ?? Math.round(quantity * Number(ingredient.costPerUnitPaise ?? 0));

    const repository = manager.getRepository(InventoryMovement);

    return repository.save(
      repository.create({
        restaurantId: params.restaurantId,
        ingredientId: ingredient.id,
        movementType: params.movementType,
        quantity,
        unit: ingredient.unit,
        quantityBefore: before,
        quantityAfter: after,
        valuePaise: String(value),
        referenceType: params.referenceType ?? null,
        referenceId: params.referenceId ?? null,
        reason: params.reason ?? null,
        note: params.note ?? null,
        businessDate: businessDateFor(),
        createdBy: params.userId,
      }),
    );
  }

  private async readQuantityIn(
    manager: EntityManager,
    restaurantId: number,
    ingredientId: number,
  ): Promise<number> {
    const rows = await manager.query<Array<{ current_quantity: string | number }>>(
      'SELECT current_quantity FROM ingredients WHERE id = ? AND restaurant_id = ?',
      [ingredientId, restaurantId],
    );

    return roundQuantity(Number(rows[0]?.current_quantity ?? 0));
  }

  private async loadIngredientIn(
    manager: EntityManager,
    restaurantId: number,
    ingredientId: number,
  ): Promise<Ingredient> {
    const ingredient = await manager
      .getRepository(Ingredient)
      .findOne({ where: { id: ingredientId, restaurantId } });

    // 404 rather than 403: another restaurant's ingredient should not be
    // distinguishable from one that does not exist.
    if (!ingredient) throw new NotFoundException(`Ingredient ${ingredientId} was not found.`);

    return ingredient;
  }

  /**
   * The figure an ingredient starts life with.
   *
   * Recorded as a movement rather than written straight into the column, so the
   * ledger explains the whole of a stock figure from the first gram. A column set
   * behind the ledger's back is the one number nobody can account for later.
   */
  async recordOpeningStock(
    restaurantId: number,
    ingredientId: number,
    quantity: number,
    userId: number,
    context?: AuditContext,
  ): Promise<InventoryMovement> {
    return this.dataSource.transaction(async (manager) => {
      const ingredient = await this.loadIngredientIn(manager, restaurantId, ingredientId);

      const movement = await this.applyMovementIn(manager, {
        restaurantId,
        ingredient,
        movementType: InventoryMovementType.OPENING_STOCK,
        quantity,
        note: 'Opening stock',
        userId,
        allowNegative: true,
      });

      await this.auditService.recordIn(manager, {
        restaurantId,
        userId,
        action: AuditAction.STOCK_ADDED,
        entityType: AuditEntity.INGREDIENT,
        entityId: ingredient.id,
        newValue: { openingQuantity: movement.quantity, unit: ingredient.unit },
        reason: 'Opening stock',
        context,
      });

      return movement;
    });
  }

  /** A delivery. */
  async addStock(
    restaurantId: number,
    ingredientId: number,
    dto: StockInDto,
    userId: number,
    context?: AuditContext,
  ): Promise<InventoryMovement> {
    return this.dataSource.transaction(async (manager) => {
      const ingredient = await this.loadIngredientIn(manager, restaurantId, ingredientId);

      // A new price applies from here on. Movements already written keep the value
      // they were written with, so an old report never changes.
      if (dto.costPerUnitPaise !== undefined) {
        await manager
          .getRepository(Ingredient)
          .update(
            { id: ingredient.id, restaurantId },
            { costPerUnitPaise: String(dto.costPerUnitPaise) },
          );
        ingredient.costPerUnitPaise = String(dto.costPerUnitPaise);
      }

      const movement = await this.applyMovementIn(manager, {
        restaurantId,
        ingredient,
        movementType: InventoryMovementType.STOCK_IN,
        quantity: dto.quantity,
        note: dto.note ?? null,
        userId,
        allowNegative: true,
      });

      await this.auditService.recordIn(manager, {
        restaurantId,
        userId,
        action: AuditAction.STOCK_ADDED,
        entityType: AuditEntity.INGREDIENT,
        entityId: ingredient.id,
        oldValue: { currentQuantity: movement.quantityBefore },
        newValue: {
          currentQuantity: movement.quantityAfter,
          added: movement.quantity,
          unit: ingredient.unit,
          ...(dto.costPerUnitPaise !== undefined
            ? { costPerUnitPaise: dto.costPerUnitPaise }
            : {}),
        },
        reason: dto.note ?? null,
        context,
      });

      return movement;
    });
  }

  /** A correction by hand, in either direction. */
  async adjustStock(
    restaurantId: number,
    ingredientId: number,
    dto: StockAdjustmentDto,
    userId: number,
    context?: AuditContext,
  ): Promise<InventoryMovement> {
    const settings = await this.settingsFor(restaurantId);

    return this.dataSource.transaction(async (manager) => {
      const ingredient = await this.loadIngredientIn(manager, restaurantId, ingredientId);

      const movement = await this.applyMovementIn(manager, {
        restaurantId,
        ingredient,
        movementType: dto.increase
          ? InventoryMovementType.ADJUSTMENT_INCREASE
          : InventoryMovementType.ADJUSTMENT_DECREASE,
        quantity: dto.quantity,
        reason: dto.reason,
        note: dto.note ?? null,
        userId,
        allowNegative: settings.allowNegativeStock,
      });

      await this.auditService.recordIn(manager, {
        restaurantId,
        userId,
        action: AuditAction.STOCK_ADJUSTED,
        entityType: AuditEntity.INGREDIENT,
        entityId: ingredient.id,
        oldValue: { currentQuantity: movement.quantityBefore },
        newValue: {
          currentQuantity: movement.quantityAfter,
          changedBy: dto.increase ? movement.quantity : -movement.quantity,
          unit: ingredient.unit,
        },
        reason: dto.note ?? dto.reason,
        context,
      });

      return movement;
    });
  }

  /** Something thrown away. Its own movement type because it is its own line in a report. */
  async recordWastage(
    restaurantId: number,
    ingredientId: number,
    dto: WastageDto,
    userId: number,
    context?: AuditContext,
  ): Promise<InventoryMovement> {
    const settings = await this.settingsFor(restaurantId);

    return this.dataSource.transaction(async (manager) => {
      const ingredient = await this.loadIngredientIn(manager, restaurantId, ingredientId);

      const movement = await this.applyMovementIn(manager, {
        restaurantId,
        ingredient,
        movementType: InventoryMovementType.WASTAGE,
        quantity: dto.quantity,
        reason: dto.reason,
        note: dto.note ?? null,
        userId,
        allowNegative: settings.allowNegativeStock,
      });

      await this.auditService.recordIn(manager, {
        restaurantId,
        userId,
        action: AuditAction.WASTAGE_RECORDED,
        entityType: AuditEntity.INGREDIENT,
        entityId: ingredient.id,
        oldValue: { currentQuantity: movement.quantityBefore },
        newValue: {
          currentQuantity: movement.quantityAfter,
          wasted: movement.quantity,
          unit: ingredient.unit,
          valuePaise: Number(movement.valuePaise),
        },
        reason: dto.note ?? dto.reason,
        context,
      });

      return movement;
    });
  }

  /**
   * A physical count, turned into corrections.
   *
   * What is stored is the difference, not the figure counted. The movement then
   * says both - `quantityBefore` is what Plateo expected, `quantityAfter` is what
   * was on the shelf - which is the whole of "expected versus actual" without a
   * separate document to go looking for.
   *
   * An ingredient that matches gets no movement, so submitting the same count
   * twice changes nothing the second time. An ingredient left out of the count is
   * left alone: "not counted" and "counted as zero" are different things, and
   * treating the first as the second would wipe out stock nobody checked.
   */
  async recordStockCount(
    restaurantId: number,
    dto: StockCountDto,
    userId: number,
    context?: AuditContext,
  ): Promise<StockCountResult> {
    return this.dataSource.transaction(async (manager) => {
      const lines: StockCountLine[] = [];

      for (const counted of dto.lines) {
        const ingredient = await this.loadIngredientIn(manager, restaurantId, counted.ingredientId);
        const expected = ingredient.currentQuantity;
        const variance = roundQuantity(counted.countedQuantity - expected);

        if (variance === 0) {
          lines.push({
            ingredientId: ingredient.id,
            ingredientName: ingredient.name,
            unit: ingredient.unit,
            expected,
            counted: counted.countedQuantity,
            variance: 0,
            variancePaise: 0,
          });
          continue;
        }

        const movement = await this.applyMovementIn(manager, {
          restaurantId,
          ingredient,
          movementType:
            variance > 0
              ? InventoryMovementType.ADJUSTMENT_INCREASE
              : InventoryMovementType.ADJUSTMENT_DECREASE,
          quantity: Math.abs(variance),
          reason: StockAdjustmentReason.COUNT_CORRECTION,
          note: dto.note ?? 'Stock count',
          userId,
          // A count is what is actually there. Refusing it because the figure it
          // corrects was wrong would be refusing to fix the thing being counted.
          allowNegative: true,
        });

        lines.push({
          ingredientId: ingredient.id,
          ingredientName: ingredient.name,
          unit: ingredient.unit,
          expected,
          counted: counted.countedQuantity,
          variance,
          variancePaise:
            variance > 0 ? Number(movement.valuePaise) : -Number(movement.valuePaise),
        });
      }

      const corrected = lines.filter((line) => line.variance !== 0);

      await this.auditService.recordIn(manager, {
        restaurantId,
        userId,
        action: AuditAction.STOCK_COUNT_COMPLETED,
        entityType: AuditEntity.INGREDIENT,
        newValue: {
          counted: lines.length,
          corrected: corrected.length,
          // Signed, in paise: negative means the shelf held less than the books
          // said, which is the direction worth noticing.
          variancePaise: corrected.reduce((sum, line) => sum + line.variancePaise, 0),
        },
        reason: dto.note ?? 'Stock count',
        context,
      });

      return { lines, countedAt: new Date() };
    });
  }

  /**
   * What a bill took off the shelves, deducted once.
   *
   * Runs inside the settle transaction it is handed, so a bill is never left
   * settled with its ingredients half taken out - if anything here fails, the
   * settlement goes back with it.
   *
   * Called again for the same bill it does nothing. The guarded claim in `settle`
   * already means only one caller can close a bill, so this check is a backstop
   * for paths that do not go through it; the unique index behind it is what makes
   * the backstop hold under concurrency rather than merely usually hold.
   */
  async consumeForOrderIn(
    manager: EntityManager,
    restaurantId: number,
    orderId: number,
    settings: InventorySettings,
    userId: number | null,
    context?: AuditContext,
  ): Promise<ConsumptionResult> {
    const nothing: ConsumptionResult = { applied: false, movements: 0, skipped: [] };

    // A restaurant that has not turned inventory on gets no calculation at all -
    // not a calculation whose result is thrown away.
    if (settings.mode === InventoryMode.DISABLED) return nothing;

    const already = await manager.getRepository(InventoryMovement).count({
      where: {
        restaurantId,
        referenceType: InventoryReferenceType.ORDER,
        referenceId: orderId,
        movementType: InventoryMovementType.SALE_CONSUMPTION,
      },
    });

    if (already > 0) return nothing;

    const sold = await this.soldLinesIn(manager, restaurantId, orderId);
    if (sold.length === 0) return nothing;

    const recipes = await this.recipeLinesIn(
      manager,
      restaurantId,
      sold.map((line) => line.dishId),
    );
    if (recipes.length === 0) return nothing;

    const plan = planConsumption(sold, recipes);
    if (plan.required.length === 0) {
      return { applied: false, movements: 0, skipped: plan.skipped };
    }

    const ingredients = await manager.getRepository(Ingredient).find({
      where: { restaurantId, id: In(plan.required.map((entry) => entry.ingredientId)) },
    });
    const byId = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));

    for (const entry of plan.required) {
      const ingredient = byId.get(entry.ingredientId);
      if (!ingredient) continue;

      await this.applyMovementIn(manager, {
        restaurantId,
        ingredient,
        movementType: InventoryMovementType.SALE_CONSUMPTION,
        quantity: entry.quantity,
        referenceType: InventoryReferenceType.ORDER,
        referenceId: orderId,
        // Never refused. The food has been eaten; a figure that says otherwise is
        // the thing that is wrong, and it is shown as a warning rather than
        // allowed to stop a bill closing.
        allowNegative: true,
        userId,
        valuePaise: entry.valuePaise,
      });
    }

    await this.auditService.recordIn(manager, {
      restaurantId,
      userId,
      action: AuditAction.STOCK_ADJUSTED,
      entityType: AuditEntity.ORDER,
      entityId: orderId,
      newValue: {
        consumed: plan.required
          .map((entry) => `${entry.ingredientName} ${entry.quantity}`)
          .join(', '),
        skipped: plan.skipped.length,
      },
      reason: 'Ingredients used by a settled bill.',
      context,
    });

    return { applied: true, movements: plan.required.length, skipped: plan.skipped };
  }

  private async soldLinesIn(
    manager: EntityManager,
    restaurantId: number,
    orderId: number,
  ): Promise<SoldLine[]> {
    const items = await manager.getRepository(OrderItem).find({ where: { orderId, restaurantId } });

    const totals = new Map<number, SoldLine>();

    for (const item of items) {
      // A cancelled line was never cooked, so nothing was used cooking it.
      // `wasMade`, not `isBillable`: a comped dish was cooked and eaten, so its
      // ingredients leave the shelf exactly as a sold one's do.
      if (!wasMade(item) || item.dishId === null) continue;

      const existing = totals.get(item.dishId);

      if (existing) existing.quantity += item.quantity;
      else
        totals.set(item.dishId, {
          dishId: item.dishId,
          dishName: item.name,
          quantity: item.quantity,
        });
    }

    return [...totals.values()];
  }

  private async recipeLinesIn(
    manager: EntityManager,
    restaurantId: number,
    dishIds: number[],
  ): Promise<RecipeLine[]> {
    if (dishIds.length === 0) return [];

    const rows = await manager
      .getRepository(DishIngredient)
      .createQueryBuilder('recipe')
      .innerJoin(Dish, 'dish', 'dish.id = recipe.dish_id')
      .innerJoin(Ingredient, 'ingredient', 'ingredient.id = recipe.ingredient_id')
      .select([
        'recipe.dish_id AS dishId',
        'recipe.ingredient_id AS ingredientId',
        'recipe.quantity AS quantity',
        'recipe.unit AS recipeUnit',
        'ingredient.name AS ingredientName',
        'ingredient.unit AS stockUnit',
        'ingredient.cost_per_unit_paise AS costPerUnitPaise',
      ])
      .where('recipe.dish_id IN (:...dishIds)', { dishIds })
      // The join through dish is what keeps this inside the tenant: a recipe is
      // only followed when its dish belongs to this restaurant.
      .andWhere('dish.restaurant_id = :restaurantId', { restaurantId })
      .andWhere('ingredient.restaurant_id = :restaurantId', { restaurantId })
      .getRawMany<{
        dishId: number;
        ingredientId: number;
        quantity: string | number;
        recipeUnit: string;
        ingredientName: string;
        stockUnit: string;
        costPerUnitPaise: string | number;
      }>();

    return rows.map((row) => ({
      dishId: Number(row.dishId),
      ingredientId: Number(row.ingredientId),
      ingredientName: row.ingredientName,
      quantity: Number(row.quantity),
      recipeUnit: row.recipeUnit,
      stockUnit: row.stockUnit as IngredientUnit,
      costPerUnitPaise: Number(row.costPerUnitPaise ?? 0),
    }));
  }

  /**
   * What a period did to the shelves.
   *
   * Grouped in SQL rather than by loading movements and adding them up in
   * JavaScript, because a busy month is tens of thousands of rows and the
   * database is better at this than we are.
   *
   * The money figures come from the movements, not from today's cost per unit.
   * Each movement recorded what it was worth when it happened, so a supplier
   * raising their price does not rewrite last month - which is the whole reason
   * the value is stored on the row.
   *
   * `onHand` is deliberately the figure now, not at the end of the range: it
   * answers "what do I need to order", which is a question about today.
   */
  async report(restaurantId: number, from: string, to: string): Promise<InventoryReport> {
    const ingredients = await this.listStock(restaurantId);

    const sums = await this.movements
      .createQueryBuilder('movement')
      .select('movement.ingredient_id', 'ingredientId')
      .addSelect('movement.movement_type', 'movementType')
      .addSelect('SUM(movement.quantity)', 'quantity')
      .addSelect('SUM(movement.value_paise)', 'valuePaise')
      .where('movement.restaurant_id = :restaurantId', { restaurantId })
      .andWhere('movement.business_date BETWEEN :from AND :to', { from, to })
      .groupBy('movement.ingredient_id')
      .addGroupBy('movement.movement_type')
      .getRawMany<{
        ingredientId: number;
        movementType: InventoryMovementType;
        quantity: string | number;
        valuePaise: string | number;
      }>();

    const byIngredient = new Map<number, InventoryReportLine>();

    for (const ingredient of ingredients) {
      byIngredient.set(ingredient.id, {
        ingredientId: ingredient.id,
        ingredientName: ingredient.name,
        unit: ingredient.unit,
        category: ingredient.category,
        consumed: 0,
        consumedPaise: 0,
        wasted: 0,
        wastedPaise: 0,
        adjusted: 0,
        adjustedPaise: 0,
        received: 0,
        receivedPaise: 0,
        onHand: ingredient.currentQuantity,
        onHandPaise: Math.round(ingredient.currentQuantity * Number(ingredient.costPerUnitPaise)),
      });
    }

    for (const row of sums) {
      const line = byIngredient.get(Number(row.ingredientId));
      // An ingredient switched off since the movement happened has no line. Its
      // history is still in the ledger; it is just not in this summary.
      if (!line) continue;

      const quantity = roundQuantity(Number(row.quantity));
      const value = Number(row.valuePaise);

      switch (row.movementType) {
        case InventoryMovementType.SALE_CONSUMPTION:
          line.consumed = roundQuantity(line.consumed + quantity);
          line.consumedPaise += value;
          break;
        case InventoryMovementType.WASTAGE:
          line.wasted = roundQuantity(line.wasted + quantity);
          line.wastedPaise += value;
          break;
        case InventoryMovementType.STOCK_IN:
        case InventoryMovementType.OPENING_STOCK:
          line.received = roundQuantity(line.received + quantity);
          line.receivedPaise += value;
          break;
        case InventoryMovementType.ADJUSTMENT_INCREASE:
        case InventoryMovementType.REVERSAL:
          line.adjusted = roundQuantity(line.adjusted + quantity);
          line.adjustedPaise += value;
          break;
        case InventoryMovementType.ADJUSTMENT_DECREASE:
          // Signed, so the two directions do not cancel into a meaningless total.
          line.adjusted = roundQuantity(line.adjusted - quantity);
          line.adjustedPaise -= value;
          break;
      }
    }

    const lines = [...byIngredient.values()];

    return {
      from,
      to,
      lines,
      totals: {
        consumedPaise: lines.reduce((sum, line) => sum + line.consumedPaise, 0),
        wastedPaise: lines.reduce((sum, line) => sum + line.wastedPaise, 0),
        adjustedPaise: lines.reduce((sum, line) => sum + line.adjustedPaise, 0),
        receivedPaise: lines.reduce((sum, line) => sum + line.receivedPaise, 0),
        onHandPaise: lines.reduce((sum, line) => sum + line.onHandPaise, 0),
      },
      lowStock: ingredients
        // A minimum of 0 means the restaurant never set one, so it is not a
        // warning that it has been reached.
        .filter(
          (ingredient) =>
            ingredient.minimumQuantity > 0 &&
            ingredient.currentQuantity <= ingredient.minimumQuantity,
        )
        .sort(
          (a, b) =>
            a.currentQuantity / a.minimumQuantity - b.currentQuantity / b.minimumQuantity,
        )
        .map((ingredient) => ({
          ingredientId: ingredient.id,
          ingredientName: ingredient.name,
          unit: ingredient.unit,
          onHand: ingredient.currentQuantity,
          minimum: ingredient.minimumQuantity,
          reorderQuantity: ingredient.reorderQuantity,
        })),
    };
  }

  /** The movements for one ingredient, or for the whole restaurant. */
  movementsFor(
    restaurantId: number,
    ingredientId?: number,
    limit = 100,
  ): Promise<InventoryMovement[]> {
    return this.movements.find({
      where: { restaurantId, ...(ingredientId ? { ingredientId } : {}) },
      relations: { ingredient: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: Math.min(limit, 500),
    });
  }

  /** Every ingredient a restaurant stocks, with the figure on the shelf. */
  listStock(restaurantId: number, includeInactive = false): Promise<Ingredient[]> {
    return this.ingredients.find({
      where: { restaurantId, ...(includeInactive ? {} : { isActive: true }) },
      order: { name: 'ASC' },
    });
  }
}
