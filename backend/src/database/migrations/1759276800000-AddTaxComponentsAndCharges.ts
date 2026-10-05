import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Proper tax on a bill: components the restaurant configures, and the breakdown
 * each bill charged.
 *
 * Entirely additive. Nothing is dropped, and `restaurants.tax_rate` stays where
 * it is: a restaurant that has only ever set a single percentage keeps billing
 * exactly as before, because the backfill below turns that percentage into
 * components that add up to the same number.
 *
 * Four pieces:
 *
 *  - `restaurant_tax_components`: the profile. CGST 2.5 + SGST 2.5 rather than
 *    "tax 5%", because an Indian bill must show each component separately.
 *  - `order_charges`: what a given bill actually charged, snapshotted. A rate
 *    change next month must not rewrite a settled bill.
 *  - `dishes.tax_group`: alcohol is outside GST, so a dish has to be able to say
 *    which rules it follows. Everything existing is STANDARD, which is correct
 *    for a menu of food.
 *  - Money columns on `orders` for the service charge, any TDS withheld, and
 *    what is left to collect.
 *
 * The backfill splits an existing rate in half as CGST and SGST, which is what a
 * single-state restaurant charges. A restaurant billing IGST across states edits
 * its profile afterwards; it cannot be inferred from one number.
 */
export class AddTaxComponentsAndCharges1759276800000 implements MigrationInterface {
  name = 'AddTaxComponentsAndCharges1759276800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`restaurant_tax_components\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`restaurant_id\` INT UNSIGNED NOT NULL,
        \`name\` VARCHAR(40) NOT NULL,
        \`kind\` VARCHAR(16) NOT NULL,
        \`rate\` DECIMAL(5,2) NOT NULL,
        \`applies_to\` VARCHAR(16) NOT NULL DEFAULT 'STANDARD',
        \`is_active\` TINYINT NOT NULL DEFAULT 1,
        \`sort_order\` INT NOT NULL DEFAULT 0,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`IDX_tax_components_restaurant\` (\`restaurant_id\`),
        CONSTRAINT \`FK_tax_components_restaurant\` FOREIGN KEY (\`restaurant_id\`)
          REFERENCES \`restaurants\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE \`order_charges\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`order_id\` INT UNSIGNED NOT NULL,
        \`name\` VARCHAR(40) NOT NULL,
        \`kind\` VARCHAR(16) NOT NULL,
        \`rate\` DECIMAL(5,2) NOT NULL,
        \`taxable_amount\` DECIMAL(10,2) NOT NULL DEFAULT 0,
        \`amount\` DECIMAL(10,2) NOT NULL DEFAULT 0,
        \`sort_order\` INT NOT NULL DEFAULT 0,
        PRIMARY KEY (\`id\`),
        KEY \`IDX_order_charges_order\` (\`order_id\`),
        CONSTRAINT \`FK_order_charges_order\` FOREIGN KEY (\`order_id\`)
          REFERENCES \`orders\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(
      "ALTER TABLE `dishes` ADD `tax_group` VARCHAR(16) NOT NULL DEFAULT 'STANDARD' AFTER `diet_type`",
    );

    await queryRunner.query(
      "ALTER TABLE `order_items` ADD `tax_group` VARCHAR(16) NOT NULL DEFAULT 'STANDARD' AFTER `unit_price`",
    );

    await queryRunner.query(
      'ALTER TABLE `orders` ADD `service_charge_amount` DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER `tax_amount`',
    );
    await queryRunner.query(
      'ALTER TABLE `orders` ADD `tds_rate` DECIMAL(5,2) NULL AFTER `total`',
    );
    await queryRunner.query(
      'ALTER TABLE `orders` ADD `tds_amount` DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER `tds_rate`',
    );
    await queryRunner.query(
      'ALTER TABLE `orders` ADD `amount_payable` DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER `tds_amount`',
    );

    // Existing bills owe exactly what they owed; nothing was withheld on them.
    await queryRunner.query('UPDATE `orders` SET `amount_payable` = `total`');

    // Turn each restaurant's single rate into the two components that rate means
    // for a sale within one state. A restaurant on 0 gets nothing, which is right:
    // it was not charging tax and must not start now.
    const restaurants = (await queryRunner.query(
      'SELECT `id`, `tax_rate` FROM `restaurants` WHERE `tax_rate` > 0',
    )) as Array<{ id: number; tax_rate: string }>;

    for (const restaurant of restaurants) {
      const rate = Number(restaurant.tax_rate);
      // An odd rate such as 5 splits to 2.5 + 2.5; DECIMAL(5,2) holds that exactly.
      const half = Math.round((rate / 2) * 100) / 100;
      // Any paisa the halving cannot represent goes to CGST, so the pair still
      // sums to what the restaurant was charging before this migration.
      const cgst = Math.round((rate - half) * 100) / 100;

      await queryRunner.query(
        'INSERT INTO `restaurant_tax_components` (`restaurant_id`, `name`, `kind`, `rate`, `applies_to`, `sort_order`) VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)',
        [
          restaurant.id, 'CGST', 'CGST', cgst, 'STANDARD', 1,
          restaurant.id, 'SGST', 'SGST', half, 'STANDARD', 2,
        ],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `orders` DROP COLUMN `amount_payable`');
    await queryRunner.query('ALTER TABLE `orders` DROP COLUMN `tds_amount`');
    await queryRunner.query('ALTER TABLE `orders` DROP COLUMN `tds_rate`');
    await queryRunner.query('ALTER TABLE `orders` DROP COLUMN `service_charge_amount`');
    await queryRunner.query('ALTER TABLE `order_items` DROP COLUMN `tax_group`');
    await queryRunner.query('ALTER TABLE `dishes` DROP COLUMN `tax_group`');
    await queryRunner.query('DROP TABLE `order_charges`');
    await queryRunner.query('DROP TABLE `restaurant_tax_components`');
  }
}
