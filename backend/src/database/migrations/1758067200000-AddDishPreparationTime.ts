import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds an optional preparation time to dishes.
 *
 * Nullable with no default: existing dishes have no known prep time, and
 * inventing one (say 0) would later read as "instant" on the customer menu.
 */
export class AddDishPreparationTime1758067200000 implements MigrationInterface {
  name = 'AddDishPreparationTime1758067200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `dishes` ADD `preparation_time_minutes` SMALLINT UNSIGNED NULL AFTER `fat_grams`',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `dishes` DROP COLUMN `preparation_time_minutes`');
  }
}
