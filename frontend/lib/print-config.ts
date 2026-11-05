/**
 * What Plateo prints, and on what.
 *
 * One module, read by both documents, so "the bill is too long" is a change in
 * one place rather than a hunt through two HTML templates.
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

/** The three widths thermal rolls are sold in. */
export const PAPER_WIDTHS_MM = [58, 80, 112] as const;

export type PaperWidthMm = (typeof PAPER_WIDTHS_MM)[number];

/**
 * Each roll, and the type that fits on it.
 *
 * **The printable width is not the roll width.** A print head covers a fixed
 * number of dots and the rest of the paper is margin it physically cannot
 * reach, so the figure that matters is the dot count:
 *
 *     58mm roll   384 dots at 203 dpi =  48.0mm
 *     80mm roll   576 dots at 203 dpi =  72.1mm
 *    112mm roll   832 dots at 203 dpi = 104.1mm
 *
 * Laying a bill out to the roll width instead of the head width is what clips
 * the last characters off the amount column - the one column that must never be
 * cut.
 *
 * 384 for the 58mm roll is the conservative figure. Some printers reach further
 * on 58mm paper - Epson quotes 420 dots for the TM-T82X in that mode - but a
 * layout built for 420 dots loses characters on a 384-dot head, while one built
 * for 384 merely leaves four millimetres of a wider head unused. Only one of
 * those two mistakes is visible on a guest's bill.
 *
 * Type sizes are per roll because the same point size that reads well across
 * 72mm leaves a 58mm bill with nowhere to put the amount. The sizes here hold
 * roughly 23 characters on a 58mm line, 32 on an 80mm line and 46 on 112mm.
 * Measured on the head rather than chosen by eye: rasterising at 203 dpi puts
 * a bill line at 20 dots on 58mm and 21 on 80mm, both above the 17-dot cell of
 * the printer's own Font B, and keeps the strokes that land on a single dot -
 * the ones a worn head prints as broken grey - near or under one percent.
 *
 * 58mm wraps more than 80mm does, and that is the right trade: a narrow roll
 * that wraps a long dish name is readable, and one that shrinks the type until
 * it fits is not.
 */
const papers: Record<PaperWidthMm, { dots: number; kotFontPx: number; billFontPx: number }> = {
  58: { dots: 384, kotFontPx: 14, billFontPx: 13 },
  80: { dots: 576, kotFontPx: 16, billFontPx: 14 },
  112: { dots: 832, kotFontPx: 16, billFontPx: 14 },
};

/** The roll every restaurant printed on before the setting existed. */
export const DEFAULT_PAPER_WIDTH_MM: PaperWidthMm = 80;

export const isPaperWidth = (value: unknown): value is PaperWidthMm =>
  PAPER_WIDTHS_MM.includes(value as PaperWidthMm);

/**
 * The roll to lay a document out for.
 *
 * Anything unrecognised falls back to 80 rather than throwing: a bill that
 * prints on the wrong width is a complaint, and a bill that does not print at
 * all is a table waiting to pay.
 */
export const paperWidthOrDefault = (value: unknown): PaperWidthMm =>
  isPaperWidth(value) ? value : DEFAULT_PAPER_WIDTH_MM;

/** What stays the same whatever paper is loaded. */
export const thermalPrinterConfig = {
  resolutionDpi: 203,
  encoding: 'ESC/POS',
  height: 'dynamic',
  cutPaper: true,

  kot: {
    showPrices: false,
    showTable: true,
    showSpecialInstructions: true,
    showOrderTime: true,
  },

  finalBill: {
    showPrices: true,
    showGST: true,
    showDiscounts: true,
    showPaymentStatus: true,
    showRestaurantDetails: true,
    showInvoiceNumber: true,
  },
} as const;

export type ThermalPrinterConfig = typeof thermalPrinterConfig;

export interface PaperSpec {
  widthMm: PaperWidthMm;
  /** Dots the head covers across the roll. */
  dots: number;
  /** What those dots come to in millimetres, which is what the body is laid out to. */
  printableWidthMm: number;
  kotFontPx: number;
  billFontPx: number;
}

/**
 * Everything the layout needs for one roll.
 *
 * The printable width is derived from the dot count rather than written down
 * twice: 576 dots at 203 dpi is 72.07mm, and rounding that to 72 leaves a
 * column of dots unused down one edge.
 */
export const paperFor = (widthMm: PaperWidthMm): PaperSpec => {
  const paper = papers[widthMm];

  return {
    widthMm,
    dots: paper.dots,
    printableWidthMm: (paper.dots / thermalPrinterConfig.resolutionDpi) * 25.4,
    kotFontPx: paper.kotFontPx,
    billFontPx: paper.billFontPx,
  };
};

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
 * The shortest page a roll printer may be sent, as a multiple of its own width.
 *
 * A page is never allowed to be wider than it is tall. The Windows print driver
 * reads a wider-than-tall page as a landscape job, turns the raster ninety
 * degrees and feeds a long form - a kitchen ticket printed sideways down a roll
 * of blank paper.
 *
 * This was briefly lowered to a flat 40mm after a headless test showed Chrome's
 * PDF export leaving short pages upright. That test was sound and irrelevant:
 * the PDF exporter is not the path a till prints through. The regression it
 * caused is why the rule is stated here as well as at the point of use.
 *
 * `printPageHeightMm` is the only correct way to work a page height out.
 */
export const portraitFloorMm = (paper: PaperSpec): number => paper.widthMm + TAIL_MM;

/** The page height for a document whose laid-out content measures `contentMm`. */
export const printPageHeightMm = (paper: PaperSpec, contentMm: number): number =>
  Math.max(portraitFloorMm(paper), Math.ceil(contentMm + TAIL_MM));

/** The widest line of monospace that fits on this paper, in characters. */
export const charactersPerLine = (paper: PaperSpec, fontSizePx: number): number =>
  Math.floor((paper.printableWidthMm * PX_PER_MM) / (fontSizePx * 0.6));
