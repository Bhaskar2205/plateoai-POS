import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sign-in codes for floor staff, and a way to switch an account off.
 *
 * A captain takes orders from their own phone during service. Asking them to
 * type a full email address at a table, every shift, is the kind of friction
 * that ends with one shared login for the whole floor - which destroys the only
 * thing that makes per-waiter figures mean anything.
 *
 * So they sign in with a short code instead. It is unique across Plateo rather
 * than per restaurant, because captain.plateoai.in is one address shared by
 * every restaurant: with a per-restaurant code there would be nothing in the
 * form to say which "ramesh" was signing in.
 *
 * `email` stays NOT NULL and unique. Captains get a placeholder on the reserved
 * `.invalid` domain (RFC 2606), which can never route anywhere - it exists to
 * satisfy the column, is never shown to anyone and is never sent mail. Making
 * the column nullable instead would have meant auditing every lookup that
 * assumes an address is there.
 *
 * `is_active` is what happens when somebody leaves. Deleting the account would
 * take their name off every bill they ever opened and silently rewrite the
 * month's staff report; switching it off stops the logins and leaves the history
 * telling the truth.
 */
export class AddStaffCodes1760572800000 implements MigrationInterface {
  name = 'AddStaffCodes1760572800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`users\`
        ADD COLUMN \`staff_code\` VARCHAR(32) NULL,
        ADD COLUMN \`is_active\` TINYINT(1) NOT NULL DEFAULT 1
    `);

    // Unique where present. MySQL lets a unique index hold many NULLs, which is
    // what we want: every owner and manager created before today has no code.
    await queryRunner.query(
      'CREATE UNIQUE INDEX `UQ_users_staff_code` ON `users` (`staff_code`)',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX `UQ_users_staff_code` ON `users`');
    await queryRunner.query(`
      ALTER TABLE \`users\`
        DROP COLUMN \`is_active\`,
        DROP COLUMN \`staff_code\`
    `);
  }
}
