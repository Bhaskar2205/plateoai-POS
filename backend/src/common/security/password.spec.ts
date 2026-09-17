import {
  ARGON2_OPTIONS,
  burnTimingDecoy,
  hashPassword,
  TIMING_DECOY_HASH,
  verifyPassword,
} from './password';

describe('password hashing', () => {
  it('produces an argon2id hash, never the plaintext', async () => {
    const hash = await hashPassword('StrongPassword123!');

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('StrongPassword123!');
  });

  it('encodes the configured cost parameters into the hash', async () => {
    const hash = await hashPassword('StrongPassword123!');

    expect(hash).toContain(`m=${ARGON2_OPTIONS.memoryCost}`);
    expect(hash).toContain(`t=${ARGON2_OPTIONS.timeCost}`);
    expect(hash).toContain(`p=${ARGON2_OPTIONS.parallelism}`);
  });

  it('salts each hash differently, so identical passwords do not collide', async () => {
    const [first, second] = await Promise.all([
      hashPassword('SamePassword123!'),
      hashPassword('SamePassword123!'),
    ]);

    expect(first).not.toBe(second);
  });

  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('StrongPassword123!');

    await expect(verifyPassword(hash, 'StrongPassword123!')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'WrongPassword123!')).resolves.toBe(false);
  });
});

describe('login timing decoy', () => {
  it('is a parseable argon2id hash with the same cost parameters', () => {
    // If this string were ever mistyped, argon2.verify would reject it as
    // malformed in microseconds instead of doing the KDF work - and the
    // "unknown email" branch of login would become measurably faster than
    // "wrong password", leaking which addresses are registered.
    expect(TIMING_DECOY_HASH).toMatch(
      new RegExp(
        `^\\$argon2id\\$v=19\\$m=${ARGON2_OPTIONS.memoryCost},` +
          `t=${ARGON2_OPTIONS.timeCost},p=${ARGON2_OPTIONS.parallelism}\\$`,
      ),
    );
  });

  it('costs about as much time as verifying a real hash', async () => {
    const realHash = await hashPassword('StrongPassword123!');

    const decoyStart = process.hrtime.bigint();
    await burnTimingDecoy();
    const decoyMs = Number(process.hrtime.bigint() - decoyStart) / 1e6;

    const realStart = process.hrtime.bigint();
    await verifyPassword(realHash, 'WrongPassword123!');
    const realMs = Number(process.hrtime.bigint() - realStart) / 1e6;

    // A malformed decoy returns in well under a millisecond, which would show
    // up here as a ratio in the hundreds. Generous bounds keep this from
    // flaking on a loaded CI machine while still catching that failure.
    const ratio = realMs / Math.max(decoyMs, 0.001);
    expect(ratio).toBeLessThan(10);
    expect(decoyMs).toBeGreaterThan(1);
  });

  it('never resolves true', async () => {
    await expect(burnTimingDecoy()).resolves.toBeUndefined();
    await expect(verifyPassword(TIMING_DECOY_HASH, 'anything')).resolves.toBe(false);
  });
});
