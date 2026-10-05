/**
 * Centralised, typed access to environment configuration.
 *
 * Every value the application needs is read here exactly once so that the rest
 * of the codebase never touches `process.env` directly.
 */

/**
 * Express `trust proxy` setting: `false` (direct connections), a hop count, or a
 * comma-separated list of trusted proxy addresses / subnets.
 */
export type TrustProxySetting = false | true | number | string;

export interface DatabaseSslConfig {
  /** Encrypt the MySQL connection (required by managed MySQL services). */
  enabled: boolean;
  /** PEM CA certificate for the server, e.g. a managed provider's CA. */
  ca: string | null;
  /** Verify the server certificate. Only ever `false` for local experiments. */
  rejectUnauthorized: boolean;
}

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  corsOrigins: string[];
  /**
   * Public origin of the Plateo QR web app, e.g. https://app.plateoai.in. Table QR
   * codes encode menu URLs on this origin, so it must be where diners can reach
   * the app - not the marketing site.
   */
  publicWebUrl: string;
  swaggerEnabled: boolean;
  /**
   * How many reverse proxies / load balancers sit in front of the API. Needed so
   * `req.ip` - and with it rate limiting - sees the real client instead of the
   * proxy. Leave off when the API is reached directly, or clients could spoof
   * their IP with `X-Forwarded-For`.
   */
  trustProxy: TrustProxySetting;
  /**
   * Shared secret the Next.js server sends when it calls the API on a diner's
   * behalf (server-rendered public menu). It lets the API rate-limit by the
   * diner's IP instead of the frontend server's. Empty disables the feature.
   */
  internalProxySecret: string;
  database: {
    host: string;
    port: number;
    username: string;
    password: string;
    name: string;
    /** `true` only for throwaway local experiments - never in production. */
    synchronize: boolean;
    logging: boolean;
    /**
     * Connections mysql2 keeps open. The driver default is 10, which queues a
     * burst of QR scans behind each other - each menu read is a few queries, so
     * ten connections serialise a hundred diners.
     */
    poolSize: number;
    ssl: DatabaseSslConfig;
  };
  jwt: {
    secret: string;
    expiresIn: string;
  };
  throttle: {
    loginTtlSeconds: number;
    loginLimit: number;
    /**
     * Requests a minute, per IP, for the anonymous menu.
     *
     * Far above the general limit on purpose. A restaurant's diners all sit
     * behind one NAT address, so 150 people scanning the QR code at the start of
     * service look to the API like one client making 150 requests in a second.
     * Under the general 120 they would not all be served.
     */
    publicMenuTtlSeconds: number;
    publicMenuLimit: number;
  };
  idempotency: {
    /** Days a used key is kept, so a late retry replays instead of re-running. */
    retentionDays: number;
  };
  payments: {
    /** How long an unpaid intent stays open before it is treated as abandoned. */
    intentExpiryMinutes: number;
    razorpay: {
      /** All three, or the provider reports itself NOT_CONFIGURED. */
      keyId: string;
      keySecret: string;
      webhookSecret: string;
    };
  };
  uploads: {
    /**
     * Directory dish photos are written to and served from.
     *
     * On Railway this must point at a mounted volume: a container's own
     * filesystem is wiped on every deploy, so photos written beside the code
     * would disappear the next time the API ships.
     */
    directory: string;
    /**
     * Public origin of this API, used to build the photo URLs stored on dishes
     * (e.g. https://api.plateoai.in). Changing it later does not rewrite URLs
     * already saved, so it is set once per environment.
     */
    publicApiUrl: string;
    /** Largest upload accepted, in bytes, before re-encoding. */
    maxBytes: number;
    /**
     * Cloudflare Images. All three, or photos stay on the local volume.
     *
     * Partial credentials are the dangerous state - a token without an account
     * hash can upload a photo it then cannot build a URL for, so the restaurant
     * is billed for an image nobody can see.
     */
    cloudflare: {
      accountId: string;
      token: string;
      /** The middle segment of every imagedelivery.net URL. */
      accountHash: string;
      /** Variant names configured in the Cloudflare dashboard. */
      thumbnailVariant: string;
      fullVariant: string;
    };
  };
}

const toBool = (value: string | undefined, fallback = false): boolean => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const toInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const parseTrustProxy = (value: string | undefined): TrustProxySetting => {
  const trimmed = (value ?? '').trim();

  if (trimmed === '' || ['false', 'off', 'no', '0'].includes(trimmed.toLowerCase())) return false;
  if (trimmed.toLowerCase() === 'true') return true;
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);

  // Addresses / subnets / Express keywords such as "loopback, 10.0.0.0/8".
  return trimmed
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
};

/**
 * Environment variables are usually single-line, so a PEM certificate is often
 * stored with literal `\n` sequences. Both forms are accepted.
 */
export const parsePem = (value: string | undefined): string | null => {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed.replace(/\\n/g, '\n') : null;
};

const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * Private-network hostnames whose traffic never leaves the hosting platform, so
 * a database reached through them does not need TLS. Railway's private network
 * (`<service>.railway.internal`) carries no TLS for its MySQL service.
 */
const PRIVATE_NETWORK_HOST_SUFFIXES = ['.railway.internal'];

/** True when an unencrypted connection to `host` never crosses a public network. */
export const isPrivateDatabaseHost = (host: string): boolean => {
  const normalised = host.trim().toLowerCase();
  return (
    LOCAL_DATABASE_HOSTS.has(normalised) ||
    PRIVATE_NETWORK_HOST_SUFFIXES.some((suffix) => normalised.endsWith(suffix) && normalised.length > suffix.length)
  );
};

export const configuration = (): AppConfig => {
  const nodeEnv = (process.env.NODE_ENV ?? 'development') as AppConfig['nodeEnv'];
  const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    nodeEnv,
    port: toInt(process.env.PORT, 4000),
    corsOrigins,
    // Falls back to the admin app's own origin, which is the same site in a
    // single-domain deployment.
    publicWebUrl: (process.env.PUBLIC_WEB_URL || corsOrigins[0] || 'http://localhost:3000').replace(/\/+$/, ''),
    swaggerEnabled: toBool(process.env.SWAGGER_ENABLED, nodeEnv !== 'production'),
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
    internalProxySecret: (process.env.INTERNAL_PROXY_SECRET ?? '').trim(),
    uploads: {
      directory: (process.env.UPLOADS_DIR || './uploads').trim(),
      publicApiUrl: (process.env.PUBLIC_API_URL || `http://localhost:${toInt(process.env.PORT, 4000)}`).replace(
        /\/+$/,
        '',
      ),
      maxBytes: toInt(process.env.UPLOAD_MAX_BYTES, 8 * 1024 * 1024),
      cloudflare: {
        accountId: (process.env.CLOUDFLARE_ACCOUNT_ID ?? '').trim(),
        token: (process.env.CLOUDFLARE_IMAGES_TOKEN ?? '').trim(),
        accountHash: (process.env.CLOUDFLARE_IMAGES_ACCOUNT_HASH ?? '').trim(),
        thumbnailVariant: (process.env.CLOUDFLARE_IMAGES_THUMB_VARIANT || 'thumb').trim(),
        fullVariant: (process.env.CLOUDFLARE_IMAGES_FULL_VARIANT || 'full').trim(),
      },
    },
    payments: {
      intentExpiryMinutes: toInt(process.env.PAYMENT_INTENT_EXPIRY_MINUTES, 30),
      razorpay: {
        keyId: (process.env.RAZORPAY_KEY_ID ?? '').trim(),
        keySecret: (process.env.RAZORPAY_KEY_SECRET ?? '').trim(),
        webhookSecret: (process.env.RAZORPAY_WEBHOOK_SECRET ?? '').trim(),
      },
    },
    idempotency: {
      // How long a used key is kept so a late retry still replays rather than
      // running the operation again. Long enough to cover a till reconnecting
      // after an outage, short enough that the table does not grow forever.
      retentionDays: toInt(process.env.IDEMPOTENCY_RETENTION_DAYS, 7),
    },
    database: {
      host: process.env.DB_HOST ?? 'localhost',
      port: toInt(process.env.DB_PORT, 3306),
      username: process.env.DB_USERNAME ?? 'root',
      password: process.env.DB_PASSWORD ?? '',
      name: process.env.DB_DATABASE ?? 'plateo',
      synchronize: toBool(process.env.DB_SYNCHRONIZE, false),
      logging: toBool(process.env.DB_LOGGING, false),
      poolSize: toInt(process.env.DB_POOL_SIZE, 20),
      ssl: {
        enabled: toBool(process.env.DB_SSL, false),
        ca: parsePem(process.env.DB_SSL_CA),
        rejectUnauthorized: toBool(process.env.DB_SSL_REJECT_UNAUTHORIZED, true),
      },
    },
    jwt: {
      secret: process.env.JWT_SECRET ?? '',
      expiresIn: process.env.JWT_EXPIRES_IN ?? '1d',
    },
    throttle: {
      loginTtlSeconds: toInt(process.env.LOGIN_THROTTLE_TTL, 60),
      loginLimit: toInt(process.env.LOGIN_THROTTLE_LIMIT, 5),
      publicMenuTtlSeconds: toInt(process.env.PUBLIC_MENU_THROTTLE_TTL, 60),
      publicMenuLimit: toInt(process.env.PUBLIC_MENU_THROTTLE_LIMIT, 600),
    },
  };
};

/**
 * Fails fast at boot when a required secret is missing, rather than starting an
 * insecure server that signs tokens with a predictable key.
 */
export const validateConfig = (config: AppConfig): AppConfig => {
  const errors: string[] = [];
  const production = config.nodeEnv === 'production';

  if (!config.jwt.secret) {
    errors.push('JWT_SECRET is required (see .env.example).');
  } else if (production && config.jwt.secret.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters in production.');
  }

  if (!/^https?:\/\/[^/\s]+$/i.test(config.uploads.publicApiUrl)) {
    errors.push('PUBLIC_API_URL must be an origin such as https://api.plateoai.in (no path).');
  } else if (production && !config.uploads.publicApiUrl.startsWith('https://')) {
    errors.push('PUBLIC_API_URL must be https in production: dish photo URLs are stored with it.');
  }

  // A relative directory in production means photos are being written beside the
  // code, inside the container - which is wiped on every deploy. Insist on an
  // absolute path, which is what a mounted volume gives you.
  if (production && !config.uploads.directory.startsWith('/')) {
    errors.push(
      'UPLOADS_DIR must be an absolute path on a mounted volume in production (e.g. /data/uploads), ' +
        'or dish photos are lost on the next deploy.',
    );
  }

  if (!/^https?:\/\/[^/\s]+$/i.test(config.publicWebUrl)) {
    errors.push('PUBLIC_WEB_URL must be an origin such as https://app.plateoai.in (no path).');
  } else if (production && !config.publicWebUrl.startsWith('https://')) {
    errors.push('PUBLIC_WEB_URL must use https in production - it is printed into QR codes.');
  }

  if (!config.database.name) {
    errors.push('DB_DATABASE is required.');
  }

  if (production && config.database.synchronize) {
    errors.push('DB_SYNCHRONIZE must be false in production - use migrations.');
  }

  // `true` trusts every X-Forwarded-For hop, which lets any client pick its own
  // IP and walk straight past the login rate limit.
  if (production && config.trustProxy === true) {
    errors.push('TRUST_PROXY=true trusts spoofable headers - set the number of proxy hops (e.g. 1) instead.');
  }

  if (config.internalProxySecret && config.internalProxySecret.length < 32) {
    errors.push('INTERNAL_PROXY_SECRET must be at least 32 characters when set.');
  }

  const { ssl } = config.database;

  if (ssl.ca && !ssl.enabled) {
    errors.push('DB_SSL_CA is set but DB_SSL is not enabled - set DB_SSL=true.');
  }

  if (ssl.ca && !ssl.ca.includes('-----BEGIN CERTIFICATE-----')) {
    errors.push('DB_SSL_CA must be a PEM certificate (-----BEGIN CERTIFICATE----- ...).');
  }

  if (production && ssl.enabled && !ssl.rejectUnauthorized) {
    errors.push('DB_SSL_REJECT_UNAUTHORIZED=false is not allowed in production.');
  }

  if (production && !ssl.enabled && !isPrivateDatabaseHost(config.database.host)) {
    errors.push(
      'DB_SSL must be enabled in production unless the database is on localhost or a private ' +
        'platform network (*.railway.internal).',
    );
  }

  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n  - ${errors.join('\n  - ')}`);
  }

  return config;
};
