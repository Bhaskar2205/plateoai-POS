import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * No-charge bills and lines: food the restaurant gave away.
 *
 * An owner eating with their family, a plate sent back and comped, a friend of
 * the house - all real, all food that left the kitchen, none of it a sale. Until
 * now the only way to record it was a 100% discount, which made a giveaway look
 * like a sale that happened to be free and quietly inflated every revenue figure.
 *
 * Deliberately a flag rather than an `OrderStatus`. An NC bill must still travel
 * the ordinary settle path, because that path is what takes the ingredients out
 * of stock, closes the kitchen tickets and frees the table. A fourth status
 * would mean every `status === SETTLED` in the codebase quietly stopping being
 * true for giveaways, including the ones inventory depends on.
 *
 * `nc_for` is who ate, not who authorised it: "Owner's family", "Staff meal".
 * The user who punched it is already on the order and in the audit log, and
 * conflating the two would lose the question an owner actually asks at the end
 * of a month, which is who the restaurant has been feeding.
 */
export class AddNonChargeableBills1760140800000 implements MigrationInterface {
  name = 'AddNonChargeableBills1760140800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`orders\`
        ADD COLUMN \`is_non_chargeable\` TINYINT(1) NOT NULL DEFAULT 0,
        ADD COLUMN \`nc_reason\` VARCHAR(255) NULL,
        ADD COLUMN \`nc_for\` VARCHAR(120) NULL
    `);

    // A single line comped inside a bill the guest is otherwise paying.
    await queryRunner.query(`
      ALTER TABLE \`order_items\`
        ADD COLUMN \`is_non_chargeable\` TINYINT(1) NOT NULL DEFAULT 0,
        ADD COLUMN \`nc_reason\` VARCHAR(255) NULL
    `);

    // Reports read "every giveaway in this period" constantly and would
    // otherwise scan the whole table to find the few that are.
    await queryRunner.query(`
      CREATE INDEX \`IDX_orders_restaurant_nc\`
        ON \`orders\` (\`restaurant_id\`, \`is_non_chargeable\`, \`business_date\`)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX `IDX_orders_restaurant_nc` ON `orders`');
    await queryRunner.query(`
      ALTER TABLE \`order_items\`
        DROP COLUMN \`nc_reason\`,
        DROP COLUMN \`is_non_chargeable\`
    `);
    await queryRunner.query(`
      ALTER TABLE \`orders\`
        DROP COLUMN \`nc_for\`,
        DROP COLUMN \`nc_reason\`,
        DROP COLUMN \`is_non_chargeable\`
    `);
  }
}
