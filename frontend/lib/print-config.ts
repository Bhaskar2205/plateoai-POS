/**
 * What Plateo prints, and on what.
 *
 * One object, read by both documents, so "the bill is too long" is a change in
 * one place rather than a hunt through two HTML templates. The numbers describe
 * the paper every restaurant on Plateo uses: an 80mm thermal roll on a 203 dpi
 * head, which prints 576 dots - 72mm - of usable width and feeds continuous
 * paper rather than sheets.
 *
 * Two entries describe the printer rather than the layout, and are worth being
 * straight about, because Plateo prints through the browser rather than over a
 * socket:
 *
 *  - `encoding: 'ESC/POS'` is the language the printer speaks. The driver
 *    installed on the till emits it; this app hands the driver a page. Going
 *    through the browser is what lets the same code print to a thermal roll, to
 *    A4, or to a PDF when the roll printer is jammed and the kitchen still needs
 *    the ticket.
 *  - `cutPaper` is likewise performed by the driver at the end of the page. What
 *    this app controls is the page being exactly as long as the content, which
 *    is what puts the cut in the right place.
 */
export const thermalPrinterConfig = {
  paperWidthMm: 80,
  printableWidthMm: 72,
  resolutionDpi: 203,
  printableDots: 576,
  encoding: 'ESC/POS',
  height: 'dynamic',
  cutPaper: true,

  kot: {
    showPrices: false,
    showTable: true,
    showSpecialInstructions: true,
    showOrderTime: true,
    fontSizePx: 14,
  },

  finalBill: {
    showPrices: true,
    showGST: true,
    showDiscounts: true,
    showPaymentStatus: true,
    showRestaurantDetails: true,
    showInvoiceNumber: true,
    fontSizePx: 12,
  },
} as const;

export type ThermalPrinterConfig = typeof thermalPrinterConfig;

/** CSS pixels are 96 to the inch by definition, whatever the screen does. */
export const PX_PER_MM = 96 / 25.4;

/**
 * A little paper after the last line, so the cutter does not clip the footer.
 *
 * Thermal rolls are continuous, so this costs two millimetres rather than a
 * sheet - and two is the figure that stopped tickets coming out with a hand of
 * blank paper under them.
 */
export const TAIL_MM = 2;

/**
 * How wide the printable area is, worked out from the dot count rather than
 * taken from `printableWidthMm`.
 *
 * 576 dots at 203 dpi is 72.07mm. The declared 72 is the same number rounded,
 * and rounding the other way - asking for 72mm of a 72.07mm head - is what
 * leaves a column of dots unused down one edge.
 */
export const printableWidthMm = (): number =>
  (thermalPrinterConfig.printableDots / thermalPrinterConfig.resolutionDpi) * 25.4;

/** The widest line of monospace that fits, in characters, at a given size. */
export const charactersPerLine = (fontSizePx: number): number =>
  Math.floor((printableWidthMm() * PX_PER_MM) / (fontSizePx * 0.6));
