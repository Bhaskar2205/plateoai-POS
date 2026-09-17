/**
 * Centralised, typed access to environment configuration.
 *
 * Every value the application needs is read here exactly once so that the rest
 * of the codebase never touches `process.env` directly.
 */

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  corsOrigins: string[];
  swaggerEnabled: boolean;
  database: {
    host: string;
    port: number;
    username: string;
    password: string;
    name: string;
    /** `true` only for throwaway local experiments - never in production. */
    synchronize: boolean;
    logging: boolean;
  };
  jwt: {
    secret: string;
    expiresIn: string;
  };
  throttle: {
    loginTtlSeconds: number;
    loginLimit: number;
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

export const configuration = (): AppConfig => {
  const nodeEnv = (process.env.NODE_ENV ?? 'development') as AppConfig['nodeEnv'];

  return {
    nodeEnv,
    port: toInt(process.env.PORT, 4000),
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    swaggerEnabled: toBool(process.env.SWAGGER_ENABLED, nodeEnv !== 'production'),
    database: {
      host: process.env.DB_HOST ?? 'localhost',
      port: toInt(process.env.DB_PORT, 3306),
      username: process.env.DB_USERNAME ?? 'root',
      password: process.env.DB_PASSWORD ?? '',
      name: process.env.DB_DATABASE ?? 'plateo',
      synchronize: toBool(process.env.DB_SYNCHRONIZE, false),
      logging: toBool(process.env.DB_LOGGING, false),
    },
    jwt: {
      secret: process.env.JWT_SECRET ?? '',
      expiresIn: process.env.JWT_EXPIRES_IN ?? '1d',
    },
    throttle: {
      loginTtlSeconds: toInt(process.env.LOGIN_THROTTLE_TTL, 60),
      loginLimit: toInt(process.env.LOGIN_THROTTLE_LIMIT, 5),
    },
  };
};

/**
 * Fails fast at boot when a required secret is missing, rather than starting an
 * insecure server that signs tokens with a predictable key.
 */
export const validateConfig = (config: AppConfig): AppConfig => {
  const errors: string[] = [];

  if (!config.jwt.secret) {
    errors.push('JWT_SECRET is required (see .env.example).');
  } else if (config.nodeEnv === 'production' && config.jwt.secret.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters in production.');
  }

  if (!config.database.name) {
    errors.push('DB_DATABASE is required.');
  }

  if (config.nodeEnv === 'production' && config.database.synchronize) {
    errors.push('DB_SYNCHRONIZE must be false in production - use migrations.');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n  - ${errors.join('\n  - ')}`);
  }

  return config;
};
