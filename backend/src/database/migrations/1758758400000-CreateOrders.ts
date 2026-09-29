import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds table ordering, kitchen tickets and billing.
 *
 * Additive only: three new tables plus two new columns on `restaurants`. No
 * existing row is rewritten - `tax_rate` gets a DEFAULT 0, so restaurants that
 * have not configured tax keep billing exactly what they charge today, and
 * `tax_number` is nullable. `down()` drops what `up()` created and nothing else.
 *
 * Shape notes, because these choices are load-bearing:
 *
 *  - Money is DECIMAL(10,2) throughout, never FLOAT. Totals are stored rather
 *    than derived, so a settled bill keeps the exact figures the diner paid even
 *    after the menu, a dish price or the restaurant's tax rate changes.
 *  - `order_items` snapshots `name` and `unit_price`. `dish_id` is ON DELETE SET
 *    NULL: deleting a dish must not delete or silently rewrite history.
 *  - `orders.table_id` is ON DELETE SET NULL for the same reason - a bill
 *    outlives the table it was served at.
 *  - Order and ticket numbers are per restaurant *per business day*, enforced by
 *    a unique index rather than by the application, so two concurrent orders
 *    cannot end up sharing a number.
 *  - `order_items.restaurant_id` is denormalised so kitchen and reporting
 *    queries stay tenant-scoped and index-covered without joining `orders`.
 *  - Every foreign key to `restaurants` cascades on delete, like every other
 *    tenant-owned table.
 */
export class CreateOrders1758758400000 implements MigrationInterface {
  name = 'CreateOrders1758758400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `restaurants` ADD `tax_rate` DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER `status`',
    );
    await queryRunner.query(
      'ALTER TABLE `restaurants` ADD `tax_number` VARCHAR(32) NULL AFTER `tax_rate`',
    );

    await queryRunner.query(`
      CREATE TABLE \`orders\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`restaurant_id\` INT UNSIGNED NOT NULL,
        \`table_id\` INT UNSIGNED NULL,
        \`order_number\` INT UNSIGNED NOT NULL,
        \`business_date\` DATE NOT NULL,
        \`status\` VARCHAR(16) NOT NULL DEFAULT 'OPEN',
        \`source\` VARCHAR(16) NOT NULL DEFAULT 'STAFF',
        \`subtotal\` DECIMAL(10,2) NOT NULL DEFAULT 0,
        \`discount_type\` VARCHAR(8) NULL,
        \`discount_value\` DECIMAL(10,2) NULL,
        \`discount_amount\` DECIMAL(10,2) NOT NULL DEFAULT 0,
        \`discount_reason\` VARCHAR(255) NULL,
        \`tax_rate\` DECIMAL(5,2) NOT NULL DEFAULT 0,
        \`tax_amount\` DECIMAL(10,2) NOT NULL DEFAULT 0,
        \`total\` DECIMAL(10,2) NOT NULL DEFAULT 0,
        \`payment_method\` VARCHAR(16) NULL,
        \`settled_at\` DATETIME(6) NULL,
        \`settled_by_user_id\` INT UNSIGNED NULL,
        \`opened_by_user_id\` INT UNSIGNED NULL,
        \`cancelled_reason\` VARCHAR(255) NULL,
        \`notes\` VARCHAR(500) NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`UQ_orders_restaurant_date_number\` (\`restaurant_id\`, \`business_date\`, \`order_number\`),
        INDEX \`IDX_orders_restaurant_status\` (\`restaurant_id\`, \`status\`),
        INDEX \`IDX_orders_table_status\` (\`table_id\`, \`status\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE \`kot_tickets\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`restaurant_id\` INT UNSIGNED NOT NULL,
        \`order_id\` INT UNSIGNED NOT NULL,
        \`ticket_number\` INT UNSIGNED NOT NULL,
        \`business_date\` DATE NOT NULL,
        \`status\` VARCHAR(16) NOT NULL DEFAULT 'NEW',
        \`printed_at\` DATETIME(6) NULL,
        \`created_by_user_id\` INT UNSIGNED NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`UQ_kot_tickets_restaurant_date_number\` (\`restaurant_id\`, \`business_date\`, \`ticket_number\`),
        INDEX \`IDX_kot_tickets_restaurant_status\` (\`restaurant_id\`, \`status\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE \`order_items\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`order_id\` INT UNSIGNED NOT NULL,
        \`restaurant_id\` INT UNSIGNED NOT NULL,
        \`dish_id\` INT UNSIGNED NULL,
        \`name\` VARCHAR(150) NOT NULL,
        \`unit_price\` DECIMAL(10,2) NOT NULL,
        \`quantity\` SMALLINT UNSIGNED NOT NULL,
        \`line_total\` DECIMAL(10,2) NOT NULL,
        \`note\` VARCHAR(255) NULL,
        \`status\` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
        \`kot_ticket_id\` INT UNSIGNED NULL,
        \`created_by_user_id\` INT UNSIGNED NULL,
        \`cancelled_reason\` VARCHAR(255) NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX \`IDX_order_items_order\` (\`order_id\`),
        INDEX \`IDX_order_items_restaurant_status\` (\`restaurant_id\`, \`status\`),
        INDEX \`IDX_order_items_kot\` (\`kot_ticket_id\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      ALTER TABLE \`orders\`
        ADD CONSTRAINT \`FK_orders_restaurant\` FOREIGN KEY (\`restaurant_id\`)
          REFERENCES \`restaurants\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION,
        ADD CONSTRAINT \`FK_orders_table\` FOREIGN KEY (\`table_id\`)
          REFERENCES \`restaurant_tables\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION,
        ADD CONSTRAINT \`FK_orders_settled_by\` FOREIGN KEY (\`settled_by_user_id\`)
          REFERENCES \`users\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION,
        ADD CONSTRAINT \`FK_orders_opened_by\` FOREIGN KEY (\`opened_by_user_id\`)
          REFERENCES \`users\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE \`kot_tickets\`
        ADD CONSTRAINT \`FK_kot_tickets_restaurant\` FOREIGN KEY (\`restaurant_id\`)
          REFERENCES \`restaurants\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION,
        ADD CONSTRAINT \`FK_kot_tickets_order\` FOREIGN KEY (\`order_id\`)
          REFERENCES \`orders\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION,
        ADD CONSTRAINT \`FK_kot_tickets_created_by\` FOREIGN KEY (\`created_by_user_id\`)
          REFERENCES \`users\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE \`order_items\`
        ADD CONSTRAINT \`FK_order_items_order\` FOREIGN KEY (\`order_id\`)
          REFERENCES \`orders\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION,
        ADD CONSTRAINT \`FK_order_items_restaurant\` FOREIGN KEY (\`restaurant_id\`)
          REFERENCES \`restaurants\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION,
        ADD CONSTRAINT \`FK_order_items_dish\` FOREIGN KEY (\`dish_id\`)
          REFERENCES \`dishes\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION,
        ADD CONSTRAINT \`FK_order_items_kot\` FOREIGN KEY (\`kot_ticket_id\`)
          REFERENCES \`kot_tickets\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION,
        ADD CONSTRAINT \`FK_order_items_created_by\` FOREIGN KEY (\`created_by_user_id\`)
          REFERENCES \`users\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE `order_items`');
    await queryRunner.query('DROP TABLE `kot_tickets`');
    await queryRunner.query('DROP TABLE `orders`');
    await queryRunner.query('ALTER TABLE `restaurants` DROP COLUMN `tax_number`');
    await queryRunner.query('ALTER TABLE `restaurants` DROP COLUMN `tax_rate`');
  }
}
