/** Money and time formatting shared by the ordering screens. */

const RUPEES = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `499` -> `₹499.00`. Always two decimals: a bill that hides paise looks wrong. */
export const formatMoney = (value: number): string => RUPEES.format(value);

/**
 * `111660` -> `₹1,11,660`. For a headline figure only.
 *
 * A bill shows paise because a diner is owed them to the paisa. A day's takings
 * at display size do not: the `.00` is two characters of noise on the largest
 * number on the page, and nobody reconciles a till from a dashboard.
 */
const RUPEES_WHOLE = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export const formatMoneyWhole = (value: number): string => RUPEES_WHOLE.format(value);

export const formatTime = (value: string): string =>
  new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

/** `3` -> `3 min`, `0` -> `just now`, `95` -> `1 h 35 min`. */
export function formatWait(minutes: number): string {
  if (minutes <= 0) return 'just now';
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);

  return `${hours} h ${minutes % 60} min`;
}
