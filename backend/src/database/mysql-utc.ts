import * as mysql2 from 'mysql2';
import type { Pool, PoolOptions } from 'mysql2';

/**
 * Every timestamp Plateo stores is UTC.
 *
 * Two settings are needed for that, and they must agree:
 *
 * - `timezone: 'Z'` tells mysql2 how to convert between JS `Date` and DATETIME:
 *   values are read and written as UTC.
 * - The MySQL *session* `time_zone` decides what `CURRENT_TIMESTAMP(6)` returns.
 *   `created_at` / `updated_at` are filled by MySQL itself (column defaults, and
 *   the `CURRENT_TIMESTAMP` TypeORM writes on update), not by Node.
 *
 * MySQL's default session zone is `SYSTEM` - the server machine's clock zone
 * (IST on the development machine). With only `timezone: 'Z'` set, rows were
 * stored as IST wall-clock time but read back as UTC, so the API reported every
 * timestamp 5h30m in the future. Pinning the session to UTC on every pooled
 * connection makes stored values independent of the server's OS time zone, so
 * development and production behave the same.
 *
 * mysql2 has no "init SQL" pool option, so the pool is created through a thin
 * wrapper that sets the zone as each physical connection opens. The pool emits
 * `connection` before handing the connection to TypeORM, so the `SET` is queued
 * ahead of any application query.
 */
export const MYSQL_SESSION_TIME_ZONE = '+00:00';

function createUtcPool(config: PoolOptions): Pool {
  const pool = mysql2.createPool(config);

  pool.on('connection', (connection) => {
    connection.query(`SET time_zone = '${MYSQL_SESSION_TIME_ZONE}'`, (error) => {
      // Never let a connection write timestamps in the wrong zone: drop it so
      // the query using it fails loudly instead.
      if (error) connection.destroy();
    });
  });

  return pool;
}

// Everything else (createPoolCluster, types, ...) is inherited from mysql2
// unchanged. `createPool` is an own enumerable property because TypeORM treats
// a driver object with no own keys as "package not installed".
const mysqlUtcDriver = Object.create(mysql2, {
  createPool: { value: createUtcPool, enumerable: true },
}) as typeof mysql2;

/**
 * Connection options shared by the Nest runtime, the migration CLI and the
 * MySQL test run. Spread into each MySQL `DataSourceOptions`.
 */
export const mysqlUtcConnectionOptions = {
  connectorPackage: 'mysql2' as const,
  driver: mysqlUtcDriver,
  timezone: 'Z',
};
