import { randomBytes } from 'node:crypto';

/**
 * 24 random bytes from the OS CSPRNG = 192 bits, far beyond guessing or
 * enumeration. base64url keeps it URL-safe without escaping: 32 characters of
 * [A-Za-z0-9_-].
 */
const TOKEN_BYTES = 24;

export const TABLE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export const generateTableToken = (): string => randomBytes(TOKEN_BYTES).toString('base64url');

/** Cheap shape check before touching the database with an untrusted value. */
export const isWellFormedTableToken = (value: unknown): value is string =>
  typeof value === 'string' && TABLE_TOKEN_PATTERN.test(value);
