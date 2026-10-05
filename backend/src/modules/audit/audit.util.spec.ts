import { sanitiseAuditValue } from './audit.service';

/**
 * An audit record is read by people and kept for a long time, so what goes into
 * it matters: a credential written here is a credential disclosed to everyone
 * who can read the log, including anyone who should not be able to.
 */
describe('sanitiseAuditValue', () => {
  it('keeps ordinary fields', () => {
    expect(sanitiseAuditValue({ discountValue: 10, reason: 'Regular guest' })).toEqual({
      discountValue: 10,
      reason: 'Regular guest',
    });
  });

  it('drops anything that looks like a credential, whatever its case', () => {
    expect(
      sanitiseAuditValue({
        price: 100,
        password: 'hunter2',
        passwordHash: '$argon2id$...',
        accessToken: 'eyJhbGciOi...',
        JWT: 'x',
        kitchenCode: 'HUYJ4K',
        apiKey: 'sk_live_x',
        cardNumber: '4111111111111111',
      }),
    ).toEqual({ price: 100 });
  });

  it('returns null rather than an empty object when nothing survives', () => {
    expect(sanitiseAuditValue({ password: 'hunter2' })).toBeNull();
  });

  it('passes null and undefined straight through', () => {
    expect(sanitiseAuditValue(null)).toBeNull();
    expect(sanitiseAuditValue(undefined)).toBeNull();
  });

  it('truncates a long string so one record cannot fill the table', () => {
    const long = 'x'.repeat(2000);
    const result = sanitiseAuditValue({ note: long });

    expect((result?.note as string).length).toBeLessThan(long.length);
    expect(result?.note as string).toMatch(/\.\.\.$/);
  });

  it('drops undefined fields rather than recording them as present', () => {
    expect(sanitiseAuditValue({ a: 1, b: undefined })).toEqual({ a: 1 });
  });
});
