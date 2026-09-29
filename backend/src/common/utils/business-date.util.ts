/**
 * The "business day" a bill belongs to.
 *
 * A restaurant's trading day is not a calendar day: an order taken at 01:30 on
 * Saturday belongs to Friday's service, Friday's KOT numbering and Friday's
 * takings. Numbering therefore restarts at a cutoff hour, not at midnight.
 *
 * Timestamps are stored and compared in UTC everywhere in Plateo (see
 * `mysql-utc.ts`), so the cutoff has to be applied in the restaurant's own local
 * time. There is no per-restaurant timezone column yet - every Plateo restaurant
 * is in India - so the offset is a single constant here rather than a guess made
 * from the server's own clock, which would move the cutoff whenever the API is
 * deployed to a different region. When restaurants outside IST are onboarded,
 * this becomes a column on `restaurants` and these two constants become its
 * defaults.
 */

/** Minutes east of UTC the business day is measured in. 330 = IST (UTC+05:30). */
export const BUSINESS_DAY_UTC_OFFSET_MINUTES = 330;

/** Local hour a new business day starts at. Orders before it belong to the previous day. */
export const BUSINESS_DAY_START_HOUR = 5;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * The business date for an instant, as the `YYYY-MM-DD` string the `DATE`
 * columns store.
 */
export function businessDateFor(instant: Date = new Date()): string {
  const localMs = instant.getTime() + BUSINESS_DAY_UTC_OFFSET_MINUTES * MINUTE_MS;
  // Shifting back by the cutoff makes "before 05:00" land on the previous date,
  // which is exactly the rule, with no branch on the hour.
  const shifted = new Date(localMs - BUSINESS_DAY_START_HOUR * HOUR_MS);

  return shifted.toISOString().slice(0, 10);
}
