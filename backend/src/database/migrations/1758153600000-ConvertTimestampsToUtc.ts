import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Converts existing created_at / updated_at values from IST to UTC.
 *
 * Why: until the connection pinned the MySQL session to UTC (see
 * src/database/mysql-utc.ts), `CURRENT_TIMESTAMP(6)` ran in the server's SYSTEM
 * zone - IST (UTC+05:30) - while the app read every DATETIME as UTC. Stored
 * values are therefore IST wall-clock times, 330 minutes ahead of UTC.
 *
 * Changes exactly these DATETIME(6) columns, and nothing else:
 *
 *   users             created_at, updated_at
 *   restaurants       created_at, updated_at
 *   restaurant_users  created_at
 *   categories        created_at, updated_at
 *   dishes            created_at, updated_at
 *   ingredients       created_at, updated_at
 *   dish_ingredients  created_at
 *
 * up() subtracts 330 minutes, down() adds them back. Microseconds are kept.
 * Assigning `updated_at` explicitly stops `ON UPDATE CURRENT_TIMESTAMP(6)` from
 * overwriting it with the migration's own run time.
 *
 * IST has a fixed offset (no daylight saving), so one constant shift is exact
 * for every row. Deploy order matters: stop the backend, run this migration,
 * then start the backend with the UTC session fix - rows written by the old
 * backend in between would otherwise stay in IST. Reverting it only makes sense
 * together with reverting that connection fix.
 */
const IST_OFFSET_MINUTES = 330;

const TIMESTAMP_COLUMNS: ReadonlyArray<readonly [table: string, columns: readonly string[]]> = [
  ['users', ['created_at', 'updated_at']],
  ['restaurants', ['created_at', 'updated_at']],
  ['restaurant_users', ['created_at']],
  ['categories', ['created_at', 'updated_at']],
  ['dishes', ['created_at', 'updated_at']],
  ['ingredients', ['created_at', 'updated_at']],
  ['dish_ingredients', ['created_at']],
];

const shiftStatements = (operator: '-' | '+'): string[] =>
  TIMESTAMP_COLUMNS.map(
    ([table, columns]) =>
      `UPDATE \`${table}\` SET ${columns
        .map((column) => `\`${column}\` = \`${column}\` ${operator} INTERVAL ${IST_OFFSET_MINUTES} MINUTE`)
        .join(', ')}`,
  );

export class ConvertTimestampsToUtc1758153600000 implements MigrationInterface {
  name = 'ConvertTimestampsToUtc1758153600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.assertExistingRowsWereWrittenInIst(queryRunner);

    for (const statement of shiftStatements('-')) {
      await queryRunner.query(statement);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const statement of shiftStatements('+')) {
      await queryRunner.query(statement);
    }
  }

  /**
   * Refuses to shift data unless the server's default zone really is UTC+05:30.
   *
   * Existing rows were written in the global/SYSTEM zone. On a server already
   * running in UTC they are correct as they are, and subtracting 330 minutes
   * would corrupt them. An empty database has nothing to convert, so it passes.
   */
  private async assertExistingRowsWereWrittenInIst(queryRunner: QueryRunner): Promise<void> {
    const counts: Array<{ rowCount: string | number }> = await queryRunner.query(
      TIMESTAMP_COLUMNS.map(([table]) => `SELECT COUNT(*) AS rowCount FROM \`${table}\``).join(' UNION ALL '),
    );
    if (counts.every(({ rowCount }) => Number(rowCount) === 0)) return;

    const [{ offsetMinutes }]: Array<{ offsetMinutes: string | number | null }> = await queryRunner.query(
      `SELECT TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', @@global.time_zone)) AS offsetMinutes`,
    );

    if (offsetMinutes === null || Number(offsetMinutes) !== IST_OFFSET_MINUTES) {
      throw new Error(
        `ConvertTimestampsToUtc: expected the MySQL server zone to be UTC+05:30 (${IST_OFFSET_MINUTES} min), ` +
          `found ${offsetMinutes ?? 'an unknown offset'}. Existing timestamps may not be IST; nothing was changed.`,
      );
    }
  }
}
