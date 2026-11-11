import { EscPosBuilder, loadBitmap, wrap } from './escpos';
import { paperFor, paperWidthOrDefault, thermalPrinterConfig as config } from './print-config';
import { clock, money, timestamp } from './print-format';
import type { Bill, KotPrint } from './types';

/**
 * The kitchen ticket and the bill, as ESC/POS.
 *
 * Field for field the same documents as the browser-printed ones in
 * `print-receipt.ts`, in the same order, governed by the same config flags - a
 * restaurant switching a till over to direct printing should see the paper
 * change shape and nothing else. What changes is everything the browser could
 * not control: no page, so no form length, no margins and no orientation, and
 * the printer's own Font A instead of a screen font burned at 203 dpi.
 */

/** The logo's box, as in the browser version: 44 x 14mm. */
const LOGO_MAX_DOTS = { width: 352, height: 112 };

/** 30mm, the size the payment QR was verified to scan at off a 203 dpi head. */
const QR_DOTS = 240;

/** Width of the quantity column, digits plus a gap. */
const QTY_COLUMNS = 4;

/** Rendered images are cached per URL: a busy service prints the same logo all night. */
const bitmapCache = new Map<string, ReturnType<typeof loadBitmap>>();

async function cachedBitmap(...args: Parameters<typeof loadBitmap>) {
  const key = args.join('|');
  let pending = bitmapCache.get(key);

  if (!pending) {
    pending = loadBitmap(...args);
    // A failed load is not cached, so a logo uploaded mid-service is picked up.
    pending.catch(() => bitmapCache.delete(key));
    bitmapCache.set(key, pending);
  }

  return pending;
}

/**
 * One line of a ticket or bill: the quantity, then the name wrapped under itself,
 * and an amount flush right on the first line when there is one.
 */
function itemLines(
  doc: EscPosBuilder,
  quantity: number,
  name: string,
  amount: string | null,
): void {
  const qty = String(quantity).padEnd(QTY_COLUMNS);
  const amountWidth = amount ? amount.length + 1 : 0;
  const nameWidth = Math.max(8, doc.columns - QTY_COLUMNS - amountWidth);
  const lines = wrap(name, nameWidth);

  lines.forEach((text, index) => {
    const lead = index === 0 ? qty : ' '.repeat(QTY_COLUMNS);
    const body = lead + text;
    doc.line(index === 0 && amount ? body.padEnd(doc.columns - amount.length) + amount : body);
  });
}

/** The kitchen ticket. Never prices, and the table in the biggest type the printer has. */
export function kotEscPos(ticket: KotPrint): Uint8Array {
  const { kot } = config;
  const paper = paperFor(paperWidthOrDefault(ticket.paperWidthMm));
  const doc = new EscPosBuilder(paper.dots).init();

  if (kot.showTable) {
    doc.align('center').bold(true).size(2, 2);
    doc.paragraph(ticket.tableName ?? 'COUNTER');
    doc.size(1, 1).bold(false);
  }

  const meta = [
    `KOT ${ticket.ticketNumber}`,
    `Bill ${ticket.orderNumber}`,
    kot.showOrderTime ? clock(ticket.createdAt) : null,
  ]
    .filter(Boolean)
    .join(' | ');

  doc.align('center').paragraph(meta);
  doc.align('left').rule();

  // Bold throughout: a cook reads this at arm's length over a pass.
  doc.bold(true);
  for (const item of ticket.items) {
    itemLines(doc, item.quantity, item.name, null);

    if (kot.showSpecialInstructions && item.note) {
      doc.bold(false);
      for (const text of wrap(`* ${item.note}`, doc.columns - QTY_COLUMNS)) {
        doc.line(' '.repeat(QTY_COLUMNS) + text);
      }
      doc.bold(true);
    }
  }
  doc.bold(false);

  doc.rule();
  doc.align('center').line(`${ticket.items.length} item${ticket.items.length === 1 ? '' : 's'}`);

  return doc.cut().build();
}

/**
 * The diner's bill.
 *
 * Async only because the logo and the payment QR have to be turned into dots.
 * Either image failing to load costs that image, never the bill: the figures
 * are the part that matters.
 */
export async function billEscPos(bill: Bill): Promise<Uint8Array> {
  const { finalBill } = config;
  const paper = paperFor(paperWidthOrDefault(bill.paperWidthMm));
  const doc = new EscPosBuilder(paper.dots).init();

  const [logo, qr] = await Promise.all([
    bill.logoUrl
      ? cachedBitmap(
          bill.logoUrl,
          Math.min(LOGO_MAX_DOTS.width, paper.dots),
          LOGO_MAX_DOTS.height,
          'dither',
        ).catch(() => null)
      : null,
    bill.paymentQrUrl
      ? cachedBitmap(bill.paymentQrUrl, QR_DOTS, QR_DOTS, 'threshold').catch(() => null)
      : null,
  ]);

  // --- who issued it -------------------------------------------------------
  doc.align('center');
  if (logo) doc.image(logo);

  doc.bold(true).size(1, 2).paragraph(bill.restaurantName).size(1, 1).bold(false);

  if (finalBill.showRestaurantDetails) {
    for (const detail of [bill.restaurantAddress, bill.restaurantPhone]) {
      if (detail) doc.paragraph(detail);
    }
    if (finalBill.showGST && bill.taxNumber) doc.paragraph(`GSTIN ${bill.taxNumber}`);
  }

  // --- which bill ----------------------------------------------------------
  doc.align('left').rule();
  const meta = [
    finalBill.showInvoiceNumber ? `Bill ${bill.orderNumber}` : null,
    bill.tableName ?? 'Counter',
    timestamp(bill.settledAt ?? new Date().toISOString()),
  ]
    .filter(Boolean)
    .join(' | ');
  doc.align('center').paragraph(meta);
  doc.align('left').rule();

  // --- what was had --------------------------------------------------------
  for (const line of bill.lines) {
    // The unit price only when it is not the line total, as on the paper bill.
    const unit = finalBill.showPrices && line.quantity > 1 ? ` @${money(line.unitPrice)}` : '';
    itemLines(
      doc,
      line.quantity,
      line.name + unit,
      finalBill.showPrices ? money(line.lineTotal) : null,
    );
  }
  doc.rule();

  // --- what it comes to ----------------------------------------------------
  if (finalBill.showPrices) doc.totalRow('Subtotal', money(bill.subtotal));

  if (finalBill.showDiscounts && bill.discountAmount > 0) {
    doc.totalRow(
      bill.discountReason ? `Discount (${bill.discountReason})` : 'Discount',
      `-${money(bill.discountAmount)}`,
    );
  }

  if (finalBill.showGST && bill.charges.length > 0) {
    // Each component on its own line: CGST and SGST are filed separately and a
    // guest is entitled to see both.
    for (const charge of bill.charges) {
      doc.totalRow(`${charge.name} @ ${charge.rate}%`, money(charge.amount));
    }
  } else if (finalBill.showGST && bill.taxAmount > 0) {
    doc.totalRow(`Tax @ ${bill.taxRate}%`, money(bill.taxAmount));
  }

  doc.bold(true).size(1, 2).totalRow('TOTAL', money(bill.total)).size(1, 1).bold(false);

  if (bill.tdsAmount > 0) {
    doc.totalRow(`TDS withheld @ ${bill.tdsRate}%`, `-${money(bill.tdsAmount)}`);
    doc.totalRow('Amount payable', money(bill.amountPayable));
  }

  if (finalBill.showPaymentStatus) {
    doc
      .align('center')
      .paragraph(
        bill.status === 'SETTLED' ? `Paid by ${bill.paymentMethod ?? 'cash'}` : 'Not settled yet',
      );
  }

  // --- how to pay, while there is still something to pay -------------------
  // The API leaves the QR off a settled bill, so a paid receipt never asks for
  // payment twice; this only prints what it is given.
  if (qr) {
    doc.align('left').rule().align('center');
    doc.image(qr);
    doc.line('Scan to pay');
    if (bill.paymentQrLabel) doc.paragraph(bill.paymentQrLabel);
  }

  doc.align('center').bold(true).line('Thanks for visiting us').bold(false);

  return doc.cut().build();
}
