import { Injectable } from '@nestjs/common';
import {
  DataSource,
  EntitySubscriberInterface,
  EventSubscriber,
  type QueryRunner,
} from 'typeorm';
import { Category } from 'src/modules/categories/entities/category.entity';
import { DishIngredient } from 'src/modules/dishes/entities/dish-ingredient.entity';
import { Dish } from 'src/modules/dishes/entities/dish.entity';
import { Ingredient } from 'src/modules/ingredients/entities/ingredient.entity';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { RestaurantTable } from 'src/modules/tables/entities/restaurant-table.entity';
import { PublicMenuCache } from './public-menu.cache';

/** Everything the public menu displays. A change to any of these makes it stale. */
const MENU_ENTITIES = [
  Restaurant,
  Category,
  Dish,
  DishIngredient,
  Ingredient,
  RestaurantTable,
] as const;

const WATCHED = new Set<string>(MENU_ENTITIES.map((entity) => entity.name));

interface EntityEvent {
  metadata: { name: string };
  queryRunner?: QueryRunner;
}

/**
 * Clears the public menu cache whenever anything the menu shows is written.
 *
 * A database subscriber rather than a `cache.flush()` call in each service, and
 * deliberately so: the alternative is six scattered call sites that every future
 * change has to remember, and the failure mode of forgetting one is a diner being
 * served a dish the kitchen marked sold out. Here there is nothing to remember - a
 * new way to edit a dish is covered the moment it writes through TypeORM, which
 * every path in this codebase does.
 *
 * It flushes twice for a transactional write, which is not redundant:
 *
 *  - **immediately**, so a write made outside a transaction takes effect at once;
 *  - **again after the commit**, because between the first flush and the commit a
 *    reader can repopulate the cache from the not-yet-committed state, and that
 *    stale copy would then outlive the change.
 *
 * The commit flush is scoped to transactions that actually touched menu data.
 * Flushing on every commit would be simpler and useless - settling a bill commits
 * a transaction, so during service the cache would be cleared continuously and
 * never serve anything.
 *
 * The one thing it cannot see is SQL that bypasses the ORM. There is none today:
 * the stock ledger's arithmetic update goes through the query builder, which does
 * emit these events.
 */
@Injectable()
@EventSubscriber()
export class MenuCacheSubscriber implements EntitySubscriberInterface {
  /**
   * Query runners whose open transaction has written menu data. Weak so a runner
   * that is discarded without committing - a rollback - is simply forgotten.
   */
  private readonly touched = new WeakSet<QueryRunner>();

  constructor(
    dataSource: DataSource,
    private readonly cache: PublicMenuCache,
  ) {
    // Registered here rather than through `subscribers: [...]` in the datasource
    // options, so the cache can be injected: a class listed there is constructed
    // by TypeORM, which knows nothing about Nest's container.
    dataSource.subscribers.push(this);
  }

  afterInsert(event: EntityEvent): void {
    this.onWrite(event);
  }

  afterUpdate(event: EntityEvent): void {
    this.onWrite(event);
  }

  afterRemove(event: EntityEvent): void {
    this.onWrite(event);
  }

  afterSoftRemove(event: EntityEvent): void {
    this.onWrite(event);
  }

  afterTransactionCommit(event: { queryRunner: QueryRunner }): void {
    if (!this.touched.has(event.queryRunner)) return;

    this.touched.delete(event.queryRunner);
    this.cache.flush();
  }

  /**
   * Also covers a bulk `UPDATE`/`DELETE` through the query builder, which reports
   * no entity instances - the metadata still names the table, which is all this
   * needs.
   */
  private onWrite(event: EntityEvent): void {
    if (!WATCHED.has(event.metadata.name)) return;

    this.cache.flush();

    if (event.queryRunner?.isTransactionActive) this.touched.add(event.queryRunner);
  }
}
