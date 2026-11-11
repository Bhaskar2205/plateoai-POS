/**
 * How figures and times read on a printed document.
 *
 * Shared by the browser-printed page and the ESC/POS stream so the two can never
 * disagree about a number: a bill printed one way and re-printed the other must
 * say exactly the same thing.
 */

/** Indian-format money without a currency symbol: thermal fonts rarely have one. */
export const money = (value: number) =>
  value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Date and time, for a bill that may be read back weeks later. */
export const timestamp = (value: string) =>
  new Date(value).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Time alone, for a ticket the kitchen reads within the hour. */
export const clock = (value: string) =>
  new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
