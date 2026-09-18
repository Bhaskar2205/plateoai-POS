import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a permanent public identifier to restaurants.
 *
 * `restaurants.slug` follows the restaurant name, so renaming used to break every
 * link that contained it - including table QR codes. `public_slug` is set once
 * and never changed by profile edits; QR codes and shared links use it.
 *
 * Backfill: every existing restaurant gets `public_slug = slug`, so every menu
 * URL that exists today becomes permanent. Current slugs are already unique and
 * each row's two values are equal, so the shared slug/public_slug namespace
 * starts without conflicts.
 *
 * Existing data: only the new column is written. `updated_at` is assigned to
 * itself in the backfill so `ON UPDATE CURRENT_TIMESTAMP(6)` does not stamp every
 * restaurant with the migration time. No other column or table is touched.
 *
 * Rollback (`down`) drops the index and column. Current slugs are unaffected,
 * but a restaurant renamed after this migration would lose its permanent
 * identifier, and its QR codes would stop resolving - revert together with the
 * code that uses `publicSlug`.
 */
export class AddRestaurantPublicSlug1758326400000 implements MigrationInterface {
  name = 'AddRestaurantPublicSlug1758326400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `restaurants` ADD `public_slug` VARCHAR(190) NULL AFTER `slug`',
    );
    await queryRunner.query(
      'UPDATE `restaurants` SET `public_slug` = `slug`, `updated_at` = `updated_at`',
    );
    await queryRunner.query(
      'ALTER TABLE `restaurants` MODIFY `public_slug` VARCHAR(190) NOT NULL',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX `UQ_restaurants_public_slug` ON `restaurants` (`public_slug`)',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX `UQ_restaurants_public_slug` ON `restaurants`');
    await queryRunner.query('ALTER TABLE `restaurants` DROP COLUMN `public_slug`');
  }
}
