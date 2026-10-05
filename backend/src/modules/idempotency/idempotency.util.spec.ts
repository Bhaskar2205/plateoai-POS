import { hashPayload } from './idempotency.service';

/**
 * The payload hash decides whether a repeat is a retry or a different request,
 * so it has to be stable against things that do not change meaning and sensitive
 * to everything that does.
 */
describe('hashPayload', () => {
  it('ignores the order keys were written in', () => {
    expect(hashPayload({ tableId: 1, items: [{ dishId: 2, quantity: 1 }] })).toBe(
      hashPayload({ items: [{ dishId: 2, quantity: 1 }], tableId: 1 }),
    );
  });

  it('ignores key order inside nested objects too', () => {
    expect(hashPayload({ items: [{ dishId: 2, quantity: 1, note: 'x' }] })).toBe(
      hashPayload({ items: [{ note: 'x', quantity: 1, dishId: 2 }] })
    );
  });

  it('treats an absent field and an undefined one as the same request', () => {
    expect(hashPayload({ tableId: 1, note: undefined })).toBe(hashPayload({ tableId: 1 }));
  });

  it('notices a changed quantity', () => {
    expect(hashPayload({ items: [{ dishId: 2, quantity: 1 }] })).not.toBe(
      hashPayload({ items: [{ dishId: 2, quantity: 2 }] }),
    );
  });

  it('notices a changed order of items, because two of a dish is not one of each', () => {
    expect(hashPayload({ items: [{ dishId: 1 }, { dishId: 2 }] })).not.toBe(
      hashPayload({ items: [{ dishId: 2 }, { dishId: 1 }] }),
    );
  });

  it('distinguishes null from absent', () => {
    expect(hashPayload({ rate: null })).not.toBe(hashPayload({}));
  });

  it('handles an empty payload without throwing', () => {
    expect(hashPayload(undefined)).toHaveLength(64);
    expect(hashPayload({})).toHaveLength(64);
  });
});
