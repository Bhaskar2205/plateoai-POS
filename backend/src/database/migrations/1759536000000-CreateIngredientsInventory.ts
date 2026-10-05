import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stock tracking for ingredients.
 *
 * Additive, and deliberately built on the `ingredients` and `dish_ingredients`
 * tables that already exist rather than beside them. Those tables have been
 * feeding the public menu since the beginning - they are what a diner reads under
 * "what is in this" - and a second set of ingredient rows would mean a restaurant
 * maintaining the same list twice and the two lists disagreeing within a week.
 *
 * Every new column has a default, so existing rows become valid without being
 * rewritten and `inventory_mode` arrives DISABLED for every restaurant that
 * already exists. A restaurant that never opens the inventory screen cannot tell
 * this migration ran: no deduction, no warning, no change to how a bill settles.
 *
 * `UQ_inventory_movements_reference_line` is the load-bearing part. It is what
 * makes consuming a bill's ingredients safe to attempt twice - a retried settle,
 * a double-clicked button, two waiters on two tills - because the second attempt
 * collides in the database inside the same transaction that settles the bill.
 * Manual movements carry NULL references and SQL treats NULLs as distinct, so a
 * person adding the same ingredient twice in an afternoon is unaffected.
 *
 * Quantities are DECIMAL(12,3): three decimals is one gram when the unit is a
 * kilogram, which is finer than a kitchen scale reads. Money stays in whole
 * paise, as BIGINT, like the rest of Plateo.
 */
export class CreateIngredientsInventory1759536000000 implements MigrationInterface {
  name = 'CreateIngredientsInventory1759536000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`ingredients\`
        ADD COLUMN \`category\` VARCHAR(24) NOT NULL DEFAULT 'OTHER',
        ADD COLUMN \`unit\` VARCHAR(16) NOT NULL DEFAULT 'GRAM',
        ADD COLUMN \`current_quantity\` DECIMAL(12,3) NOT NULL DEFAULT 0,
        ADD COLUMN \`minimum_quantity\` DECIMAL(12,3) NOT NULL DEFAULT 0,
        ADD COLUMN \`reorder_quantity\` DECIMAL(12,3) NOT NULL DEFAULT 0,
        ADD COLUMN \`cost_per_unit_paise\` BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN \`is_active\` TINYINT(1) NOT NULL DEFAULT 1
    `);

    // The two questions the inventory screen asks: everything in use, and
    // everything running low.
    await queryRunner.query(`
      CREATE INDEX \`IDX_ingredients_restaurant_active\`
        ON \`ingredients\` (\`restaurant_id\`, \`is_active\`)
    `);

    await queryRunner.query(`
      ALTER TABLE \`restaurants\`
        ADD COLUMN \`inventory_mode\` VARCHAR(16) NOT NULL DEFAULT 'DISABLED',
        ADD COLUMN \`inventory_consumption_mode\` VARCHAR(20) NOT NULL DEFAULT 'BILL_SETTLED',
        ADD COLUMN \`allow_negative_stock\` TINYINT(1) NOT NULL DEFAULT 0,
        ADD COLUMN \`auto_disable_out_of_stock_dishes\` TINYINT(1) NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      CREATE TABLE \`inventory_movements\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`restaurant_id\` INT UNSIGNED NOT NULL,
        \`ingredient_id\` INT UNSIGNED NOT NULL,
        \`movement_type\` VARCHAR(24) NOT NULL,
        \`quantity\` DECIMAL(12,3) NOT NULL,
        \`unit\` VARCHAR(16) NOT NULL,
        \`quantity_before\` DECIMAL(12,3) NOT NULL,
        \`quantity_after\` DECIMAL(12,3) NOT NULL,
        \`value_paise\` BIGINT NOT NULL DEFAULT 0,
        \`reference_type\` VARCHAR(16) NULL,
        \`reference_id\` INT UNSIGNED NULL,
        \`reason\` VARCHAR(24) NULL,
        \`note\` VARCHAR(255) NULL,
        \`business_date\` DATE NOT NULL,
        \`created_by\` INT UNSIGNED NULL,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`UQ_inventory_movements_reference_line\`
          (\`restaurant_id\`, \`reference_type\`, \`reference_id\`, \`ingredient_id\`, \`movement_type\`),
        KEY \`IDX_inventory_movements_ingredient\` (\`ingredient_id\`, \`created_at\`),
        KEY \`IDX_inventory_movements_restaurant_date\` (\`restaurant_id\`, \`business_date\`),
        KEY \`IDX_inventory_movements_reference\`
          (\`restaurant_id\`, \`reference_type\`, \`reference_id\`),
        CONSTRAINT \`FK_inventory_movements_restaurant\` FOREIGN KEY (\`restaurant_id\`)
          REFERENCES \`restaurants\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_inventory_movements_ingredient\` FOREIGN KEY (\`ingredient_id\`)
          REFERENCES \`ingredients\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_inventory_movements_user\` FOREIGN KEY (\`created_by\`)
          REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE `inventory_movements`');

    await queryRunner.query(`
      ALTER TABLE \`restaurants\`
        DROP COLUMN \`auto_disable_out_of_stock_dishes\`,
        DROP COLUMN \`allow_negative_stock\`,
        DROP COLUMN \`inventory_consumption_mode\`,
        DROP COLUMN \`inventory_mode\`
    `);

    await queryRunner.query('DROP INDEX `IDX_ingredients_restaurant_active` ON `ingredients`');

    // The ingredient itself survives - it predates inventory and the menu needs
    // it. Only the stock columns go.
    await queryRunner.query(`
      ALTER TABLE \`ingredients\`
        DROP COLUMN \`is_active\`,
        DROP COLUMN \`cost_per_unit_paise\`,
        DROP COLUMN \`reorder_quantity\`,
        DROP COLUMN \`minimum_quantity\`,
        DROP COLUMN \`current_quantity\`,
        DROP COLUMN \`unit\`,
        DROP COLUMN \`category\`
    `);
  }
}
