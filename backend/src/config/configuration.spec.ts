import {
  configuration,
  isPrivateDatabaseHost,
  parsePem,
  parseTrustProxy,
  validateConfig,
  type AppConfig,
} from './configuration';

const CA = '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIU\n-----END CERTIFICATE-----';

/** A valid production config, so each test changes exactly one thing. */
function productionConfig(overrides: (config: AppConfig) => void = () => undefined): AppConfig {
  const config: AppConfig = {
    nodeEnv: 'production',
    port: 4000,
    corsOrigins: ['https://app.plateoai.in'],
    publicWebUrl: 'https://app.plateoai.in',
    swaggerEnabled: false,
    trustProxy: 1,
    internalProxySecret: 'x'.repeat(48),
    database: {
      host: 'private-db.example.internal',
      port: 25060,
      username: 'plateo_app',
      password: 'secret',
      name: 'plateo',
      synchronize: false,
      logging: false,
      ssl: { enabled: true, ca: CA, rejectUnauthorized: true },
    },
    jwt: { secret: 'j'.repeat(64), expiresIn: '1d' },
    throttle: { loginTtlSeconds: 60, loginLimit: 5 },
  };
  overrides(config);
  return config;
}

const expectInvalid = (config: AppConfig, message: RegExp) => expect(() => validateConfig(config)).toThrow(message);

describe('configuration', () => {
  describe('parseTrustProxy', () => {
    it.each([
      [undefined, false],
      ['', false],
      ['false', false],
      ['0', false],
      ['off', false],
      ['1', 1],
      ['2', 2],
      ['true', true],
      ['loopback', 'loopback'],
      [' 10.0.0.0/8 ,  loopback ', '10.0.0.0/8, loopback'],
    ])('parses %p as %p', (input, expected) => {
      expect(parseTrustProxy(input)).toEqual(expected);
    });
  });

  describe('isPrivateDatabaseHost', () => {
    it.each([
      ['localhost', true],
      ['127.0.0.1', true],
      ['::1', true],
      ['mysql.railway.internal', true],
      [' MYSQL.RAILWAY.INTERNAL ', true],
      ['railway.internal', false],
      ['mysqlrailway.internal', false],
      ['mysql.railway.internal.evil.com', false],
      ['mysql-production.up.railway.app', false],
      ['db.example.com', false],
    ])('%p -> %p', (host, expected) => {
      expect(isPrivateDatabaseHost(host)).toBe(expected);
    });
  });

  describe('parsePem', () => {
    it('returns null when unset or blank', () => {
      expect(parsePem(undefined)).toBeNull();
      expect(parsePem('   ')).toBeNull();
    });

    it('turns literal \\n sequences from single-line env vars into newlines', () => {
      expect(parsePem('-----BEGIN CERTIFICATE-----\\nABC\\n-----END CERTIFICATE-----')).toBe(
        '-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----',
      );
    });

    it('keeps real newlines as they are', () => {
      expect(parsePem(CA)).toBe(CA);
    });
  });

  describe('environment mapping', () => {
    const saved = { ...process.env };
    afterEach(() => {
      process.env = { ...saved };
    });

    it('reads the new deployment settings', () => {
      process.env.TRUST_PROXY = '1';
      process.env.INTERNAL_PROXY_SECRET = '  shared-secret  ';
      process.env.DB_SSL = 'true';
      process.env.DB_SSL_CA = CA.replace(/\n/g, '\\n');
      process.env.PUBLIC_WEB_URL = 'https://app.plateoai.in/';

      const config = configuration();

      expect(config.trustProxy).toBe(1);
      expect(config.internalProxySecret).toBe('shared-secret');
      expect(config.database.ssl).toEqual({ enabled: true, ca: CA, rejectUnauthorized: true });
      expect(config.publicWebUrl).toBe('https://app.plateoai.in');
    });

    it('defaults to no proxy trust, no forwarding secret and no TLS', () => {
      delete process.env.TRUST_PROXY;
      delete process.env.INTERNAL_PROXY_SECRET;
      delete process.env.DB_SSL;
      delete process.env.DB_SSL_CA;
      delete process.env.DB_SSL_REJECT_UNAUTHORIZED;

      const config = configuration();

      expect(config.trustProxy).toBe(false);
      expect(config.internalProxySecret).toBe('');
      expect(config.database.ssl).toEqual({ enabled: false, ca: null, rejectUnauthorized: true });
    });
  });

  describe('validateConfig', () => {
    it('accepts the recommended production setup', () => {
      expect(() => validateConfig(productionConfig())).not.toThrow();
    });

    it('rejects TRUST_PROXY=true in production', () => {
      expectInvalid(productionConfig((c) => (c.trustProxy = true)), /TRUST_PROXY=true/);
    });

    it('allows TRUST_PROXY=true outside production', () => {
      expect(() => validateConfig(productionConfig((c) => ((c.trustProxy = true), (c.nodeEnv = 'development'))))).not.toThrow();
    });

    it('rejects a short INTERNAL_PROXY_SECRET', () => {
      expectInvalid(productionConfig((c) => (c.internalProxySecret = 'too-short')), /INTERNAL_PROXY_SECRET/);
    });

    it('allows running without INTERNAL_PROXY_SECRET (the API logs a warning instead)', () => {
      expect(() => validateConfig(productionConfig((c) => (c.internalProxySecret = '')))).not.toThrow();
    });

    it('requires DB_SSL in production for a remote database', () => {
      expectInvalid(
        productionConfig((c) => (c.database.ssl = { enabled: false, ca: null, rejectUnauthorized: true })),
        /DB_SSL must be enabled in production/,
      );
    });

    it.each([
      'db.example.com',
      'mysql-production.up.railway.app',
      'proxy.rlwy.net',
      'railway.internal',
      'mysql.railway.internal.evil.com',
      'mysqlrailway.internal',
    ])('still requires DB_SSL for the public or look-alike host %s', (host) => {
      expectInvalid(
        productionConfig((c) => {
          c.database.host = host;
          c.database.ssl = { enabled: false, ca: null, rejectUnauthorized: true };
        }),
        /DB_SSL must be enabled in production/,
      );
    });

    it.each(['localhost', '127.0.0.1', '::1', 'mysql.railway.internal', 'MySQL.Railway.Internal'])('does not require DB_SSL for a database on %s', (host) => {
      expect(() =>
        validateConfig(
          productionConfig((c) => {
            c.database.host = host;
            c.database.ssl = { enabled: false, ca: null, rejectUnauthorized: true };
          }),
        ),
      ).not.toThrow();
    });

    it('refuses to skip certificate verification in production', () => {
      expectInvalid(productionConfig((c) => (c.database.ssl.rejectUnauthorized = false)), /DB_SSL_REJECT_UNAUTHORIZED=false/);
    });

    it('rejects a CA without DB_SSL, and a CA that is not PEM', () => {
      expectInvalid(productionConfig((c) => (c.database.ssl.enabled = false)), /DB_SSL_CA is set but DB_SSL is not enabled/);
      expectInvalid(productionConfig((c) => (c.database.ssl.ca = 'not a certificate')), /DB_SSL_CA must be a PEM certificate/);
    });

    it('requires an https PUBLIC_WEB_URL origin in production', () => {
      expectInvalid(productionConfig((c) => (c.publicWebUrl = 'http://app.plateoai.in')), /must use https in production/);
      expectInvalid(productionConfig((c) => (c.publicWebUrl = 'https://app.plateoai.in/menu')), /no path/);
    });
  });
});
