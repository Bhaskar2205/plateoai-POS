import { MigrationInterface, QueryRunner } from 'typeorm';
import { generateKitchenCode } from 'src/modules/restaurants/kitchen-code';

/**
 * Adds the code a kitchen screen signs in with.
 *
 * Additive: one column on `restaurants`. Existing restaurants are given a code
 * here rather than lazily, so every restaurant has one the moment this ships and
 * nothing has to handle "no code yet".
 *
 * The column is added nullable, backfilled row by row (each code is random, so
 * they cannot be set in one statement), then made NOT NULL and unique - unique
 * because the code alone identifies the restaurant at sign-in. `updated_at` is
 * written back to itself during the backfill so adding the code does not look
 * like someone edited every restaurant.
 */
export class AddRestaurantKitchenCode1758844800000 implements MigrationInterface {
  name = 'AddRestaurantKitchenCode1758844800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `restaurants` ADD `kitchen_code` VARCHAR(16) NULL AFTER `public_slug`',
    );

    const restaurants = (await queryRunner.query('SELECT `id` FROM `restaurants`')) as Array<{
      id: number;
    }>;

    const used = new Set<string>();

    for (const restaurant of restaurants) {
      let code = generateKitchenCode();

      // Astronomically unlikely inside one restaurant list, but a collision here
      // would fail the unique index below and strand the migration half-done.
      while (used.has(code)) code = generateKitchenCode();
      used.add(code);

      await queryRunner.query(
        'UPDATE `restaurants` SET `kitchen_code` = ?, `updated_at` = `updated_at` WHERE `id` = ?',
        [code, restaurant.id],
      );
    }

    await queryRunner.query(
      'ALTER TABLE `restaurants` MODIFY `kitchen_code` VARCHAR(16) NOT NULL',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX `UQ_restaurants_kitchen_code` ON `restaurants` (`kitchen_code`)',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX `UQ_restaurants_kitchen_code` ON `restaurants`');
    await queryRunner.query('ALTER TABLE `restaurants` DROP COLUMN `kitchen_code`');
  }
}
