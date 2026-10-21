import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The restaurant's payment QR, printed on bills.
 *
 * A guest at the table is handed the bill and pays by scanning it, which is how
 * most small Indian restaurants already take money - the code is taped to the
 * counter and a waiter carries it to the table. Printing it on the bill itself
 * removes that walk.
 *
 * Plateo stores a picture and nothing else. It does not generate the code, does
 * not know the UPI handle inside it, and cannot tell whether a scan resulted in
 * a payment, so no part of the till treats this as a payment integration: a bill
 * is still settled by a person pressing the button. That is why there is no
 * verification here and no reconciliation anywhere - it is exactly as reliable
 * as the printed code taped to the counter, and no more.
 *
 * `print_payment_qr` defaults to 0, so every restaurant already running keeps
 * printing exactly what it printed yesterday until an owner turns this on.
 */
export class AddBillPaymentQr1761004800000 implements MigrationInterface {
  name = 'AddBillPaymentQr1761004800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`restaurants\`
        ADD COLUMN \`payment_qr_url\` VARCHAR(512) NULL,
        ADD COLUMN \`payment_qr_label\` VARCHAR(100) NULL,
        ADD COLUMN \`print_payment_qr\` TINYINT(1) NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`restaurants\`
        DROP COLUMN \`print_payment_qr\`,
        DROP COLUMN \`payment_qr_label\`,
        DROP COLUMN \`payment_qr_url\`
    `);
  }
}
