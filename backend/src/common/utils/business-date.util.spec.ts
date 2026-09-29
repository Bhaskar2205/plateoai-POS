import { businessDateFor } from './business-date.util';

/** IST is UTC+05:30, so 05:00 IST is 23:30 UTC on the previous calendar day. */
describe('businessDateFor', () => {
  it('puts a lunchtime order on its own calendar date', () => {
    // 13:00 IST on 28 Sep 2026.
    expect(businessDateFor(new Date('2026-09-28T07:30:00Z'))).toBe('2026-09-28');
  });

  it('keeps a late-night order on the day the service started', () => {
    // 01:30 IST on 29 Sep is still Monday 28th's dinner service.
    expect(businessDateFor(new Date('2026-09-28T20:00:00Z'))).toBe('2026-09-28');
    // 04:59 IST on 29 Sep - one minute before the cutoff.
    expect(businessDateFor(new Date('2026-09-28T23:29:00Z'))).toBe('2026-09-28');
  });

  it('starts the new business day exactly at the cutoff', () => {
    // 05:00 IST on 29 Sep 2026.
    expect(businessDateFor(new Date('2026-09-28T23:30:00Z'))).toBe('2026-09-29');
  });

  it('rolls over month and year boundaries', () => {
    // 05:00 IST on 1 Oct.
    expect(businessDateFor(new Date('2026-09-30T23:30:00Z'))).toBe('2026-10-01');
    // 04:00 IST on 1 Jan 2027 still belongs to 31 Dec 2026.
    expect(businessDateFor(new Date('2026-12-31T22:30:00Z'))).toBe('2026-12-31');
    // 05:00 IST on 1 Jan 2027.
    expect(businessDateFor(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
  });

  it('handles a leap day', () => {
    expect(businessDateFor(new Date('2028-02-29T07:30:00Z'))).toBe('2028-02-29');
    expect(businessDateFor(new Date('2028-02-29T23:30:00Z'))).toBe('2028-03-01');
  });

  it('does not depend on the server timezone', () => {
    const original = process.env.TZ;

    try {
      process.env.TZ = 'America/New_York';
      expect(businessDateFor(new Date('2026-09-28T07:30:00Z'))).toBe('2026-09-28');
      process.env.TZ = 'UTC';
      expect(businessDateFor(new Date('2026-09-28T07:30:00Z'))).toBe('2026-09-28');
    } finally {
      process.env.TZ = original;
    }
  });
});
