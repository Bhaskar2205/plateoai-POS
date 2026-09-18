import type { DatabaseSslConfig } from 'src/config/configuration';

/**
 * TLS options for the MySQL connection, shared by the Nest runtime, the
 * migration CLI and the MySQL test run.
 *
 * Managed MySQL services require encrypted connections and usually sign their
 * server certificate with their own CA, which is passed as `DB_SSL_CA`. The
 * certificate is always verified unless verification is explicitly disabled
 * (refused in production by `validateConfig`).
 */
export const mysqlSslConnectionOptions = (ssl: DatabaseSslConfig): { ssl?: Record<string, unknown> } =>
  ssl.enabled
    ? {
        ssl: {
          ...(ssl.ca ? { ca: ssl.ca } : {}),
          rejectUnauthorized: ssl.rejectUnauthorized,
          minVersion: 'TLSv1.2',
        },
      }
    : {};
