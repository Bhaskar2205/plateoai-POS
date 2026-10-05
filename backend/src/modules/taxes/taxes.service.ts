import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  AuditAction,
  AuditEntity,
  OrderStatus,
  TAX_KINDS,
  TaxGroup,
  TaxKind,
} from 'src/common/enums';
import { Order } from 'src/modules/orders/entities/order.entity';
import { recalculateOrder } from 'src/modules/orders/order-writer';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import {
  ApplyTaxProfileDto,
  CreateTaxComponentDto,
  TaxComponentDto,
  TaxProfileDto,
  UpdateTaxComponentDto,
} from './dto/tax-component.dto';
import { AuditService, type AuditContext } from 'src/modules/audit/audit.service';
import { TaxComponent } from './entities/tax-component.entity';
import { loadTaxComponents, SUGGESTED_PROFILES } from './tax-profile';

/** A restaurant cannot stack an unbounded list of charges onto its guests. */
const MAX_COMPONENTS = 12;

const toDto = (component: TaxComponent): TaxComponentDto => ({
  id: component.id,
  name: component.name,
  kind: component.kind,
  rate: component.rate,
  appliesTo: component.appliesTo,
  isActive: component.isActive,
  sortOrder: component.sortOrder,
});

/**
 * The restaurant's own tax profile.
 *
 * Everything here is scoped by the restaurant id taken from the access token, so
 * one restaurant can neither read nor edit another's rates. A component that
 * belongs to someone else is a 404, never a 403 - the same rule the rest of the
 * API follows, so a probe cannot learn that an id exists.
 */
@Injectable()
export class TaxesService {
  constructor(
    @InjectRepository(TaxComponent)
    private readonly componentsRepository: Repository<TaxComponent>,
    @InjectRepository(Restaurant)
    private readonly restaurantsRepository: Repository<Restaurant>,
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async profile(restaurantId: number): Promise<TaxProfileDto> {
    const components = await this.componentsRepository.find({
      where: { restaurantId },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });

    const restaurant = await this.restaurantsRepository.findOne({
      where: { id: restaurantId },
      select: { id: true, taxNumber: true },
    });

    return {
      components: components.map(toDto),
      suggested: SUGGESTED_PROFILES.map((profile) => ({
        id: profile.id,
        label: profile.label,
        description: profile.description,
        totalRate: profile.components
          .filter((c) => c.appliesTo === TaxGroup.STANDARD && TAX_KINDS.includes(c.kind))
          .reduce((sum, c) => sum + c.rate, 0),
      })),
      standardRate: this.standardRateOf(components),
      taxNumber: restaurant?.taxNumber ?? null,
    };
  }

  /**
   * Records a change to what the restaurant charges.
   *
   * A service charge gets its own action because it is not a tax: it is the
   * restaurant's own money, it is the charge a guest is most likely to query,
   * and an owner looking for "when did we start adding 10%" should not have to
   * read every GST edit to find it.
   */
  private recordTaxChange(
    restaurantId: number,
    userId: number | null,
    component: Pick<TaxComponent, 'id' | 'kind' | 'name'>,
    oldValue: Record<string, unknown> | null,
    newValue: Record<string, unknown> | null,
    context?: AuditContext,
  ): Promise<void> {
    return this.auditService.record({
      restaurantId,
      userId,
      action:
        component.kind === TaxKind.SERVICE_CHARGE
          ? AuditAction.SERVICE_CHARGE_CHANGED
          : AuditAction.TAX_CONFIGURATION_CHANGED,
      entityType: AuditEntity.TAX_COMPONENT,
      entityId: component.id,
      oldValue,
      newValue,
      context,
    });
  }

  async create(
    restaurantId: number,
    dto: CreateTaxComponentDto,
    userId?: number,
    context?: AuditContext,
  ): Promise<TaxComponentDto> {
    const existing = await this.componentsRepository.count({ where: { restaurantId } });

    if (existing >= MAX_COMPONENTS) {
      throw new BadRequestException(
        `A bill cannot carry more than ${MAX_COMPONENTS} charges. Remove one before adding another.`,
      );
    }

    const appliesTo = dto.appliesTo ?? TaxGroup.STANDARD;

    await this.assertNotDuplicate(restaurantId, dto.kind, dto.rate, appliesTo);

    const component = await this.componentsRepository.save(
      this.componentsRepository.create({
        restaurantId,
        name: dto.name,
        kind: dto.kind,
        rate: dto.rate,
        appliesTo,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? existing + 1,
      }),
    );

    await this.repriceOpenBills(restaurantId);
    await this.recordTaxChange(
      restaurantId,
      userId ?? null,
      component,
      null,
      { name: component.name, kind: component.kind, rate: component.rate, appliesTo: component.appliesTo },
      context,
    );

    return toDto(component);
  }

  async update(
    restaurantId: number,
    id: number,
    dto: UpdateTaxComponentDto,
    userId?: number,
    context?: AuditContext,
  ): Promise<TaxComponentDto> {
    const component = await this.ownedOrNotFound(restaurantId, id);
    const before = {
      name: component.name,
      kind: component.kind,
      rate: component.rate,
      appliesTo: component.appliesTo,
      isActive: component.isActive,
    };

    await this.assertNotDuplicate(
      restaurantId,
      dto.kind ?? component.kind,
      dto.rate ?? component.rate,
      dto.appliesTo ?? component.appliesTo,
      id,
    );

    Object.assign(component, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
      ...(dto.rate !== undefined ? { rate: dto.rate } : {}),
      ...(dto.appliesTo !== undefined ? { appliesTo: dto.appliesTo } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
    });

    const saved = await this.componentsRepository.save(component);

    await this.repriceOpenBills(restaurantId);
    await this.recordTaxChange(
      restaurantId,
      userId ?? null,
      saved,
      before,
      { name: saved.name, kind: saved.kind, rate: saved.rate, appliesTo: saved.appliesTo, isActive: saved.isActive },
      context,
    );

    return toDto(saved);
  }

  async remove(
    restaurantId: number,
    id: number,
    userId?: number,
    context?: AuditContext,
  ): Promise<void> {
    const component = await this.ownedOrNotFound(restaurantId, id);
    const before = {
      name: component.name,
      kind: component.kind,
      rate: component.rate,
      appliesTo: component.appliesTo,
    };
    const identity = { id: component.id, kind: component.kind, name: component.name };

    await this.componentsRepository.remove(component);
    await this.repriceOpenBills(restaurantId);
    await this.recordTaxChange(restaurantId, userId ?? null, identity, before, null, context);
  }

  /**
   * Replaces the profile with a suggested one.
   *
   * Replaces rather than merges, because these are whole profiles: a restaurant
   * moving from 5% to 18% must not end up charging 23%.
   */
  async applyProfile(
    restaurantId: number,
    dto: ApplyTaxProfileDto,
    userId?: number,
    context?: AuditContext,
  ): Promise<TaxProfileDto> {
    const profile = SUGGESTED_PROFILES.find((candidate) => candidate.id === dto.profileId);

    if (!profile) {
      throw new NotFoundException(`No suggested tax profile called "${dto.profileId}".`);
    }

    const previous = await this.componentsRepository.find({ where: { restaurantId } });

    await this.componentsRepository.delete({ restaurantId });
    await this.componentsRepository.insert(
      profile.components.map((component, index) =>
        this.componentsRepository.create({
          restaurantId,
          name: component.name,
          kind: component.kind,
          rate: component.rate,
          appliesTo: component.appliesTo,
          isActive: true,
          sortOrder: index + 1,
        }),
      ),
    );

    await this.repriceOpenBills(restaurantId);

    const applied = await this.profile(restaurantId);

    // Replacing the whole profile is one event, not one per component: it was
    // one decision, and splitting it would hide that the old rates went away.
    await this.auditService.record({
      restaurantId,
      userId: userId ?? null,
      action: AuditAction.TAX_CONFIGURATION_CHANGED,
      entityType: AuditEntity.TAX_COMPONENT,
      entityId: null,
      oldValue: { components: previous.map((c) => `${c.name} ${c.rate}% ${c.appliesTo}`) },
      newValue: { profile: profile.id, components: applied.components.map((c) => `${c.name} ${c.rate}% ${c.appliesTo}`) },
      reason: `Applied the "${profile.label}" profile`,
      context,
    });

    return applied;
  }

  /** The combined percentage on ordinary food, which is what a restaurant quotes. */
  private standardRateOf(components: TaxComponent[]): number {
    return components
      .filter(
        (component) =>
          component.isActive &&
          component.appliesTo === TaxGroup.STANDARD &&
          TAX_KINDS.includes(component.kind) &&
          component.kind !== TaxKind.CESS,
      )
      .reduce((sum, component) => sum + component.rate, 0);
  }

  /**
   * Re-prices every bill still running at this restaurant.
   *
   * A bill is only recalculated when something on it changes, so without this a
   * rate corrected at four o'clock would not reach the tables already sitting -
   * and would then appear on one of them later, the moment a waiter added a
   * coffee, as a total that moved for no reason anyone could see.
   *
   * Settled bills are never touched: they keep the breakdown they were charged.
   */
  private async repriceOpenBills(restaurantId: number): Promise<void> {
    const open = await this.ordersRepository.find({
      where: { restaurantId, status: OrderStatus.OPEN },
      select: { id: true },
    });

    if (open.length === 0) return;

    const components = await loadTaxComponents(
      this.componentsRepository,
      this.restaurantsRepository,
      restaurantId,
    );

    await this.dataSource.transaction(async (manager) => {
      for (const order of open) {
        await recalculateOrder(manager, order.id, components);
      }
    });
  }

  /**
   * Refuses a charge the restaurant already has.
   *
   * Two CGST lines at 2.5% on the same dishes is not a configuration anyone
   * wants: it charges 5% CGST and the restaurant finds out from a guest, or from
   * a return. The name is not part of the test, because what double-charges is
   * the same kind at the same rate on the same group, whatever it is called.
   */
  private async assertNotDuplicate(
    restaurantId: number,
    kind: TaxKind,
    rate: number,
    appliesTo: TaxGroup,
    exceptId?: number,
  ): Promise<void> {
    const clashes = await this.componentsRepository.find({
      where: { restaurantId, kind, appliesTo },
    });

    const duplicate = clashes.find(
      (candidate) => candidate.id !== exceptId && Number(candidate.rate) === Number(rate),
    );

    if (duplicate) {
      throw new BadRequestException(
        `${duplicate.name} is already charged at ${rate}% on these dishes. Change that one instead, or it would be charged twice.`,
      );
    }
  }

  private async ownedOrNotFound(restaurantId: number, id: number): Promise<TaxComponent> {
    const component = await this.componentsRepository.findOne({ where: { id, restaurantId } });

    if (!component) {
      throw new NotFoundException(`Charge ${id} was not found.`);
    }

    return component;
  }
}
