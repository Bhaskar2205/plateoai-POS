/**
 * Prices on the guest menu, formatted the same way everywhere.
 *
 * `Intl.NumberFormat` would be the obvious choice, and it is what this used to
 * be. The trouble is that it reads the device's own ICU data: Node on the server
 * and Chrome on somebody's phone can disagree about whether a rupee sign is
 * followed by a space, and about where the grouping commas fall. The page is
 * server-rendered, so a disagreement means React finds markup it did not expect
 * and throws the tree away to rebuild it - a hydration warning that appears on
 * one person's phone and on nobody's laptop, which is the hardest kind to chase.
 *
 * So the format is written out here instead. It is the Indian convention - the
 * last three digits, then pairs - and it produces identical bytes on every
 * device, which is the only property that matters for markup the server sends.
 *
 * Only for INR. A restaurant billing in anything else falls back to Intl, where
 * a mismatch is possible but the currency is not one Plateo serves today.
 */

/** 1234567.5 -> "12,34,567.50" */
function groupIndian(value: number, decimals: number): string {
  const fixed = Math.abs(value).toFixed(decimals);
  const [whole, fraction] = fixed.split('.');

  // The last three digits stand alone; everything before them pairs up.
  const lastThree = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}` : lastThree;

  const sign = value < 0 ? '-' : '';

  return fraction ? `${sign}${grouped}.${fraction}` : `${sign}${grouped}`;
}

/**
 * A price as a diner reads it: ₹320, or ₹149.50 when there are paise.
 *
 * Whole amounts drop the decimals, because a menu that says ₹320.00 reads like
 * a spreadsheet.
 */
export function rupees(value: number, currency = 'INR'): string {
  if (currency !== 'INR') {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(value);
  }

  return `₹${groupIndian(value, Number.isInteger(value) ? 0 : 2)}`;
}

/**
 * A plain number on the menu - calories, grams of protein.
 *
 * Same reasoning as `rupees`: this ends up in server-rendered markup, so it has
 * to read identically on every device rather than however that device's ICU
 * feels about grouping.
 */
export function amount(value: number, decimals = 1): string {
  const rounded = Number(value.toFixed(decimals));

  return groupIndian(rounded, Number.isInteger(rounded) ? 0 : decimals);
}

