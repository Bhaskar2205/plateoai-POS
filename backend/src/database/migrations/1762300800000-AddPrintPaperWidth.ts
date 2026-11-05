import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Which roll a restaurant's printer actually takes.
 *
 * Thermal rolls are sold in three widths and the printable area is not the roll
 * width: a head covers a fixed number of dots and the rest of the paper is
 * margin it cannot reach. At 203 dpi that is 384 dots (48.0mm) on a 58mm roll,
 * 576 dots (72.1mm) on an 80mm roll and 832 dots (104.1mm) on a 112mm roll.
 * Laying a bill out to the roll width instead of the head width is what clips
 * the last characters of the amount column - the one column that must never be
 * cut.
 *
 * Until now 80 was hard-coded in the apps, which is right for every restaurant
 * currently on Plateo and wrong the first time one arrives with a 58mm printer:
 * every line would come off the right-hand edge with nothing in the product
 * able to correct it.
 *
 * Defaults to 80, so every restaurant already running prints tomorrow exactly
 * what it printed today.
 */
export class AddPrintPaperWidth1762300800000 implements MigrationInterface {
  name = 'AddPrintPaperWidth1762300800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`restaurants\`
        ADD COLUMN \`print_paper_width_mm\` SMALLINT UNSIGNED NOT NULL DEFAULT 80
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`restaurants\`
        DROP COLUMN \`print_paper_width_mm\`
    `);
  }
}
