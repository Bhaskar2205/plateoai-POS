import * as argon2 from 'argon2';

/**
 * The one place Plateo decides how passwords are hashed.
 *
 * 19 MiB / 2 iterations / 1 lane is the OWASP baseline for interactive logins.
 * Raise `memoryCost` before `timeCost` if the hardware allows.
 *
 * Argon2 encodes its parameters into the hash string, so changing these values
 * does not invalidate existing hashes - old passwords keep verifying with the
 * parameters they were created under, and are re-hashed on next login only if a
 * future migration chooses to.
 */
export const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export const hashPassword = (plain: string): Promise<string> =>
  argon2.hash(plain, ARGON2_OPTIONS);

export const verifyPassword = (hash: string, plain: string): Promise<boolean> =>
  argon2.verify(hash, plain);

/**
 * A syntactically valid Argon2id hash that nothing verifies against.
 *
 * Login verifies this when the email is unknown so that "no such account" costs
 * the same wall-clock time as "wrong password", and response timing does not
 * reveal which addresses are registered. It must stay parseable with the same
 * cost parameters as {@link ARGON2_OPTIONS}, otherwise verification would fail
 * fast and reopen the timing channel - `password.spec.ts` asserts exactly that.
 */
export const TIMING_DECOY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZXg$Xf7Vv1hQ0nQxq0xq0xq0xq0xq0xq0xq0xq0xq0xq0xo';

/** Burns a comparable amount of time to a real verification, then gives up. */
export async function burnTimingDecoy(): Promise<void> {
  try {
    await argon2.verify(TIMING_DECOY_HASH, 'invalid-password');
  } catch {
    // Expected: the decoy never verifies. Only the elapsed time matters.
  }
}
