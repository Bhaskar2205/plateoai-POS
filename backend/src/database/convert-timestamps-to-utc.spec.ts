import type { QueryRunner } from 'typeorm';
import { ConvertTimestampsToUtc1758153600000 } from './migrations/1758153600000-ConvertTimestampsToUtc';

// Lives outside migrations/ on purpose: that folder is globbed as migrations.

const UP_SQL = [
  'UPDATE `users` SET `created_at` = `created_at` - INTERVAL 330 MINUTE, `updated_at` = `updated_at` - INTERVAL 330 MINUTE',
  'UPDATE `restaurants` SET `created_at` = `created_at` - INTERVAL 330 MINUTE, `updated_at` = `updated_at` - INTERVAL 330 MINUTE',
  'UPDATE `restaurant_users` SET `created_at` = `created_at` - INTERVAL 330 MINUTE',
  'UPDATE `categories` SET `created_at` = `created_at` - INTERVAL 330 MINUTE, `updated_at` = `updated_at` - INTERVAL 330 MINUTE',
  'UPDATE `dishes` SET `created_at` = `created_at` - INTERVAL 330 MINUTE, `updated_at` = `updated_at` - INTERVAL 330 MINUTE',
  'UPDATE `ingredients` SET `created_at` = `created_at` - INTERVAL 330 MINUTE, `updated_at` = `updated_at` - INTERVAL 330 MINUTE',
  'UPDATE `dish_ingredients` SET `created_at` = `created_at` - INTERVAL 330 MINUTE',
];

/** A query runner that answers the guard's two SELECTs and records every statement. */
function fakeRunner({ rows, offset }: { rows: number; offset: number | string | null }) {
  const statements: string[] = [];
  const runner = {
    query: jest.fn(async (sql: string) => {
      statements.push(sql);
      if (sql.includes('COUNT(*)')) return Array.from({ length: 7 }, (_, i) => ({ rowCount: i === 0 ? String(rows) : '0' }));
      if (sql.includes('TIMESTAMPDIFF')) return [{ offsetMinutes: offset }];
      return undefined;
    }),
  };
  return { runner: runner as unknown as QueryRunner, statements, updates: () => statements.filter((s) => s.startsWith('UPDATE')) };
}

describe('ConvertTimestampsToUtc1758153600000', () => {
  const migration = new ConvertTimestampsToUtc1758153600000();

  it('shifts exactly the timestamp columns back by 330 minutes on an IST server', async () => {
    const fake = fakeRunner({ rows: 3, offset: '330' });

    await migration.up(fake.runner);

    expect(fake.updates()).toEqual(UP_SQL);
  });

  it('adds the 330 minutes back on down()', async () => {
    const fake = fakeRunner({ rows: 3, offset: 330 });

    await migration.down(fake.runner);

    expect(fake.statements).toEqual(UP_SQL.map((sql) => sql.replaceAll(' - INTERVAL', ' + INTERVAL')));
  });

  it('never touches any other column', async () => {
    const fake = fakeRunner({ rows: 1, offset: 330 });

    await migration.up(fake.runner);

    for (const sql of fake.updates()) {
      const assigned = [...sql.matchAll(/`(\w+)` = /g)].map((match) => match[1]);
      expect(assigned.every((column) => column === 'created_at' || column === 'updated_at')).toBe(true);
      expect(sql).not.toMatch(/WHERE/);
    }
  });

  it.each([0, -300, 60, null])('refuses to change data when the server zone offset is %p minutes', async (offset) => {
    const fake = fakeRunner({ rows: 5, offset });

    await expect(migration.up(fake.runner)).rejects.toThrow(/expected the MySQL server zone to be UTC\+05:30/);
    expect(fake.updates()).toEqual([]);
  });

  it('runs on an empty database regardless of the server zone', async () => {
    const fake = fakeRunner({ rows: 0, offset: 0 });

    await migration.up(fake.runner);

    expect(fake.statements.some((sql) => sql.includes('TIMESTAMPDIFF'))).toBe(false);
    expect(fake.updates()).toEqual(UP_SQL);
  });
});
