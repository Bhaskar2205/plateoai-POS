import { createHash, randomInt } from 'node:crypto';

/**
 * The code a kitchen screen signs in with.
 *
 * It is the only credential a kitchen device has, so the shape is a deliberate
 * trade-off between "a cook can type it from a sticker" and "nobody guesses it".
 *
 *  - **Six characters, not four or five digits.** Four digits is ten thousand
 *    possibilities: a script walks the whole space in minutes. Six characters
 *    from this 31-letter alphabet is about 887 million, which is far past
 *    guessing, while still being one short line to read out over a noisy pass.
 *  - **No 0/O, 1/I/L or 8/B.** Codes get written on tape and stuck to a tablet;
 *    every character that can be misread is a support call.
 *  - **Case-insensitive.** Typed on a tablet keyboard in a hurry, case is noise.
 *    Codes are stored and shown uppercase, and compared uppercase.
 *
 * What it can do is limited on purpose: a kitchen token reaches the kitchen
 * board and nothing else - no bills, no menu, no takings - so a leaked code
 * exposes what is cooking, not what the restaurant earns.
 */

/** Digits and letters that cannot be confused with each other on a printed label. */
const ALPHABET = 'ACDEFGHJKMNPQRTUVWXY2345679';

export const KITCHEN_CODE_LENGTH = 6;

/** What a valid code looks like, after normalising. */
export const KITCHEN_CODE_PATTERN = new RegExp(`^[${ALPHABET}]{${KITCHEN_CODE_LENGTH}}$`);

/**
 * A fresh code from the OS random source.
 *
 * `randomInt` rather than `Math.random`: this is a credential, and a predictable
 * one is no credential at all.
 */
export function generateKitchenCode(): string {
  let code = '';

  for (let index = 0; index < KITCHEN_CODE_LENGTH; index += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }

  return code;
}

/**
 * Tidies what someone typed: trims, uppercases, and drops the spaces and dashes
 * people add when reading a code aloud ("K7F - 2QM").
 */
export function normaliseKitchenCode(value: unknown): string {
  if (typeof value !== 'string') return '';

  return value.trim().toUpperCase().replace(/[\s-]/g, '');
}

export const isWellFormedKitchenCode = (value: unknown): value is string =>
  KITCHEN_CODE_PATTERN.test(normaliseKitchenCode(value));

/**
 * A short fingerprint of a code, for stamping into a kitchen token.
 *
 * The token carries this rather than the code itself, and every request compares
 * it against the restaurant's current code. That is what makes "issue a new code"
 * cut off screens that are *already* signed in, instead of only blocking fresh
 * sign-ins until their tokens happen to expire - which is the whole point when a
 * tablet has walked out of the kitchen.
 */
export const kitchenCodeFingerprint = (code: string): string =>
  createHash('sha256').update(normaliseKitchenCode(code)).digest('hex').slice(0, 16);

/** `K7F2QM` -> `K7F-2QM`, for showing on screen and on a printed card. */
export const formatKitchenCode = (code: string): string =>
  `${code.slice(0, 3)}-${code.slice(3)}`;
