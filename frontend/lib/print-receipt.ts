import {
  PX_PER_MM,
  type PaperSpec,
  paperFor,
  paperWidthOrDefault,
  printPageHeightMm,
  thermalPrinterConfig as config,
} from './print-config';
import { billEscPos, kotEscPos } from './escpos-documents';
import { agentEnabled, type PrinterRole, sendToAgent } from './print-agent';
import { clock, money, timestamp } from './print-format';
import type { Bill, KotPrint } from './types';

/**
 * Printing kitchen tickets and bills on an 80mm thermal roll.
 *
 * Deliberately the browser's own print dialog rather than a driver or a native
 * bridge: a restaurant's KOT printer is already installed on the till as a normal
 * printer, and going through the browser means the same code prints to a thermal
 * roll, to A4, or to a PDF when the printer is jammed and the kitchen needs the
 * ticket written down. Everything renders in a hidden iframe, so the admin shell
 * itself never ends up on paper and no pop-up blocker is involved.
 *
 * Every measurement comes from `print-config.ts`. Both documents are built to be
 * **short**: a thermal roll is a consumable, a waiter carries the bill across a
 * room, and a cook reads the ticket at arm's length over a pass. So nothing is
 * printed twice, nothing is printed that the reader already knows, and no line
 * exists to make the paper look balanced.
 */


/** Shared by both documents. What differs between them is set per document. */
const basePaperCss = (paper: PaperSpec, fontSizePx: number) => `
  @page { margin: 0; }
  html, body { margin: 0; background: #fff; }
  body {
    width: ${paper.printableWidthMm}mm;
    padding: 1.5mm;
    box-sizing: border-box;
    font-family: "Courier New", ui-monospace, monospace;
    font-size: ${fontSizePx}px;
    /* 600, not normal. A thermal head burns thin strokes lighter than a screen
       draws them, and a receipt from the field came back barely readable. Bold
       type costs nothing on paper and survives a worn print head. */
    font-weight: 600;
    line-height: 1.25;
    color: #000;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .mid { text-align: center; }
  .big { font-size: ${fontSizePx + 7}px; font-weight: 700; text-align: center; margin: .5mm 0; }
  .name { font-size: ${fontSizePx + 2}px; font-weight: 700; text-align: center; }
  /* Address, phone and GSTIN: a notch down and tighter-leaded than the rest.
     A guest reads these once, if ever, and at full size a long street address
     wraps to three lines and pushes the whole bill down the roll. Still bold,
     so a worn print head cannot swallow it. */
  .sub { text-align: center; font-size: .88em; line-height: 1.15; }
  hr { border: 0; border-top: 1px dashed #000; margin: .7mm 0; }
  table { width: 100%; border-collapse: collapse; }
  td { vertical-align: top; padding: .2mm 0; }
  td.qty { width: 7mm; font-weight: 700; }
  td.amount, .totals td { font-variant-numeric: tabular-nums; }
  td.amount { text-align: right; white-space: nowrap; padding-left: 1.5mm; }
  .note { font-style: italic; padding-left: 7mm; }
  /* Slightly smaller, so a long dish name and its unit price still share one
     line - and never broken mid-figure, which is what the nowrap is for. Not
     smaller than this: a guest checking what they were charged per dish has to
     be able to read it off thermal paper. */
  .unit { font-style: normal; font-size: .9em; opacity: .85; white-space: nowrap; }
  .totals .label { text-align: right; }
  .grand td { font-size: ${fontSizePx + 2}px; font-weight: 700; border-top: 1px solid #000; padding-top: .8mm; }
  .foot { text-align: center; margin-top: 1mm; }
  .qr { text-align: center; margin-top: 1mm; }
  .qr img { width: 30mm; height: 30mm; object-fit: contain; display: block; margin: 0 auto 0.5mm; }
  /* The logo is the first thing on the bill. Capped by height as well as width
     so a tall, narrow mark cannot push the whole receipt down the roll. */
  .logo { text-align: center; margin-bottom: .5mm; }
  /* 14mm, down from 32 by way of 20. The mark still reads as the
     restaurant's - it is the first thing on the paper, with nothing competing
     with it - and every millimetre here comes off every bill of the day. */
  .logo img { max-width: 44mm; max-height: 14mm; width: auto; height: auto; display: block; margin: 0 auto; }
  .thanks { text-align: center; font-weight: 700; margin-top: 1mm; }
  /* Each part of the meta line stays whole when the line wraps, so a long table
     name never leaves "am" stranded on a line of its own. */
  .part { white-space: nowrap; }
`;

/**
 * Waits until the frame has actually laid out, so a measurement means something.
 *
 * Three things can change the height after the HTML is written, and all three
 * have shipped a clipped receipt at some point:
 *
 *  - **fonts**, because a receipt measured against a fallback face has different
 *    metrics from one measured against the monospace that finally loads;
 *  - **images**, because the payment QR occupies 30mm the moment it decodes and
 *    nothing at all before that;
 *  - **layout**, which two animation frames settle on browsers with no font
 *    loading API.
 */
async function whenLaidOut(frame: HTMLIFrameElement): Promise<void> {
  const win = frame.contentWindow;
  const doc = frame.contentDocument;

  if (!win || !doc) return;

  try {
    await doc.fonts?.ready;
  } catch {
    // An older browser without the font loading API still prints.
  }

  // A QR that fails to load must not stop the bill printing: the figures are
  // the part that matters, and a missing code is better than no bill.
  await Promise.all(
    Array.from(doc.images).map((image) =>
      image.complete ? Promise.resolve() : image.decode().catch(() => undefined),
    ),
  );

  await new Promise<void>((resolve) =>
    win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve())),
  );
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );

/**
 * Renders HTML in a hidden iframe and opens the print dialog.
 *
 * Resolves once printing has been *requested*, not once paper has moved - the
 * browser will not tell us that, so nothing in the UI should claim it did.
 */
async function printHtml(
  title: string,
  bodyHtml: string,
  paper: PaperSpec,
  fontSizePx: number,
): Promise<void> {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
    title,
  )}</title><style>${basePaperCss(paper, fontSizePx)}</style></head><body>${bodyHtml}</body></html>`;

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  Object.assign(frame.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: '0',
  });
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  const win = frame.contentWindow;

  if (!doc || !win) {
    frame.remove();
    throw new Error('Printing is not available in this browser.');
  }

  doc.open();
  doc.write(html);
  doc.close();

  // The page has to be told how tall it is.
  //
  // CSS has no way to say "as tall as the content" in paged media: `size` takes
  // lengths or the keyword `auto`, never both, so an `80mm auto` is invalid and
  // silently dropped - which is why a six-line receipt used to come out on a
  // full sheet with a hand of blank paper under it. So the content is measured
  // once it has laid out, and the page is cut to fit. This is what
  // `height: 'dynamic'` in the config means in practice, and it is also what
  // puts the driver's cut in the right place.
  await whenLaidOut(frame);

  // As long as the content, but NEVER WIDER THAN IT IS TALL.
  //
  // Do not lower this floor. It has been removed once, on the strength of a
  // test that rendered short pages through Chrome's PDF export and found
  // upright text, no /Rotate entry and an unrotated text matrix at 37, 60 and
  // 79mm. All of that was true and none of it was the point: the PDF exporter
  // is not the path a till prints through. A real receipt goes Chrome -> the
  // Windows driver -> the printer, and to that driver a page wider than it is
  // tall IS a landscape job. It rotates the raster ninety degrees and feeds a
  // long form, which is how a restaurant got a kitchen ticket printed sideways
  // down a roll of otherwise blank paper the day after the floor came out.
  //
  // So the floor is the roll's own width plus the tail. It costs a few
  // millimetres on the shortest tickets. The alternative costs a roll.
  //
  // Any future attempt to reclaim those millimetres has to be verified on
  // paper, through a driver, not in a headless browser.
  const heightMm = printPageHeightMm(paper, doc.body.scrollHeight / PX_PER_MM);

  const page = doc.createElement('style');
  page.textContent = `@page { size: ${paper.widthMm}mm ${heightMm}mm; margin: 0; }`;
  doc.head.appendChild(page);

  const cleanup = () => setTimeout(() => frame.remove(), 500);
  win.addEventListener('afterprint', cleanup, { once: true });
  win.focus();
  win.print();
  // Browsers that print synchronously never fire afterprint on the frame.
  setTimeout(cleanup, 60_000);
}

/**
 * Prints straight to the printer through the Plateo Print Agent, when this till
 * has been connected to one.
 *
 * True when the job went to paper that way. False when the browser should print
 * it instead: the till is not connected, the agent is not running, it has no
 * printer for this job, or the printer refused the connection - in every one of
 * those cases nothing reached the printer, so the browser cannot make a second
 * copy. A failure after bytes started flowing is thrown instead, because
 * printing again another way could put two bills on the table.
 */
async function printedDirect(
  role: PrinterRole,
  build: () => Promise<Uint8Array>,
): Promise<boolean> {
  if (!agentEnabled()) return false;

  let data: Uint8Array;
  try {
    data = await build();
  } catch (error) {
    console.warn('[print] could not build the ESC/POS job, using the browser:', error);
    return false;
  }

  const result = await sendToAgent(role, data);
  if (result.ok) return true;
  if (result.fallback) {
    console.warn(`[print] ${result.message} Printing through the browser instead.`);
    return false;
  }

  throw new Error(`The printer stopped part-way: ${result.message} Check it before printing again.`);
}

/**
 * A kitchen ticket.
 *
 * Never prices - `kot.showPrices` is false and the kitchen is cooking, not
 * charging - and the table is the heaviest thing on the paper, because that is
 * what a cook reads first and what the ticket is eventually matched against.
 *
 * The restaurant's name is not printed. A kitchen knows which kitchen it is in,
 * and on a roll that is cut by hand every line at the top pushes the first dish
 * further from the tear.
 */
export async function printKotTicket(ticket: KotPrint): Promise<void> {
  if (await printedDirect('kot', async () => kotEscPos(ticket))) return;

  const { kot } = config;
  const paper = paperFor(paperWidthOrDefault(ticket.paperWidthMm));

  const lines = ticket.items
    .map(
      (item) =>
        `<tr><td class="qty">${item.quantity}</td><td>${escapeHtml(item.name)}</td></tr>` +
        (kot.showSpecialInstructions && item.note
          ? `<tr><td colspan="2" class="note">${escapeHtml(item.note)}</td></tr>`
          : ''),
    )
    .join('');

  // One line carries everything that identifies the ticket, instead of three.
  const meta = [
    `KOT ${ticket.ticketNumber}`,
    `Bill ${ticket.orderNumber}`,
    kot.showOrderTime ? clock(ticket.createdAt) : null,
  ]
    .filter(Boolean)
    .map((part) => `<span class="part">${escapeHtml(part as string)}</span>`)
    .join(' | ');

  const body = `
    ${kot.showTable ? `<div class="big">${escapeHtml(ticket.tableName ?? 'COUNTER')}</div>` : ''}
    <div class="mid">${meta}</div>
    <hr>
    <table>${lines}</table>
    <hr>
    <div class="foot">${ticket.items.length} item${ticket.items.length === 1 ? '' : 's'}</div>
  `;

  return printHtml(
    `KOT ${ticket.ticketNumber} - ${ticket.tableName ?? 'Counter'}`,
    body,
    paper,
    paper.kotFontPx,
  );
}

/** The diner's bill. Cancelled lines never reach it - the API leaves them out. */
export async function printBill(bill: Bill): Promise<void> {
  if (await printedDirect('bill', () => billEscPos(bill))) return;

  const { finalBill } = config;
  const paper = paperFor(paperWidthOrDefault(bill.paperWidthMm));

  const lines = bill.lines
    .map((line) => {
      // The unit price earns its place only when it is not the line total.
      // Printing "1 x Dal Makhani @ 280.00 ... 280.00" says the same number
      // twice and costs a line on every single-quantity item, which on a table
      // of six is most of the bill.
      const unit =
        finalBill.showPrices && line.quantity > 1
          ? ` <span class="unit">@${money(line.unitPrice)}</span>`
          : '';
      const amount = finalBill.showPrices
        ? `<td class="amount">${money(line.lineTotal)}</td>`
        : '';

      return `<tr><td class="qty">${line.quantity}</td><td>${escapeHtml(line.name)}${unit}</td>${amount}</tr>`;
    })
    .join('');

  const row = (label: string, value: string) =>
    `<tr><td class="label" colspan="2">${escapeHtml(label)}</td><td class="amount">${value}</td></tr>`;

  /* The top of the bill, in the order a guest reads it: the restaurant's mark,
     then who they are, where, and the registration the invoice is issued under.
     The logo is the one optional part - a restaurant that has not uploaded one
     gets its name in its place rather than a gap. */
  const logo = bill.logoUrl
    ? `<div class="logo"><img src="${escapeHtml(bill.logoUrl)}" alt=""></div>`
    : '';

  const header =
    logo +
    `<div class="name">${escapeHtml(bill.restaurantName)}</div>` +
    (finalBill.showRestaurantDetails
      ? [bill.restaurantAddress, bill.restaurantPhone]
          .filter(Boolean)
          .map((detail) => `<div class="sub">${escapeHtml(detail as string)}</div>`)
          .join('') +
        (finalBill.showGST && bill.taxNumber
          ? `<div class="sub">GSTIN ${escapeHtml(bill.taxNumber)}</div>`
          : '')
      : '');

  // Again one line rather than three: which bill, which table, when.
  const meta = [
    finalBill.showInvoiceNumber ? `Bill ${bill.orderNumber}` : null,
    bill.tableName ?? 'Counter',
    timestamp(bill.settledAt ?? new Date().toISOString()),
  ]
    .filter(Boolean)
    .map((part) => `<span class="part">${escapeHtml(part as string)}</span>`)
    .join(' | ');

  const taxRows =
    finalBill.showGST && bill.charges.length > 0
      ? /* Each component on its own line. A tax invoice that shows one combined
           "tax 5%" is not a valid GST invoice: CGST and SGST are filed
           separately and the guest is entitled to see both. */
        bill.charges
          .map((charge) => row(`${charge.name} @ ${charge.rate}%`, money(charge.amount)))
          .join('')
      : finalBill.showGST && bill.taxAmount > 0
        ? row(`Tax @ ${bill.taxRate}%`, money(bill.taxAmount))
        : '';

  const discountRow =
    finalBill.showDiscounts && bill.discountAmount > 0
      ? row(
          bill.discountReason ? `Discount (${bill.discountReason})` : 'Discount',
          `-${money(bill.discountAmount)}`,
        )
      : '';

  /* The restaurant's own payment code, when the owner has switched it on. The
     API decides whether it belongs on this particular bill - it leaves it out
     once the bill is settled, so a paid receipt never asks for payment twice. */
  const qr = bill.paymentQrUrl
    ? `<hr><div class="qr">
         <img src="${escapeHtml(bill.paymentQrUrl)}" alt="">
         <div>Scan to pay</div>
         ${bill.paymentQrLabel ? `<div>${escapeHtml(bill.paymentQrLabel)}</div>` : ''}
       </div>`
    : '';

  const status = finalBill.showPaymentStatus
    ? bill.status === 'SETTLED'
      ? `Paid by ${escapeHtml(bill.paymentMethod ?? 'cash')}`
      : 'Not settled yet'
    : '';

  const body = `
    ${header}
    <hr>
    <div class="mid">${meta}</div>
    <hr>
    <table>${lines}</table>
    <hr>
    <table class="totals">
      ${finalBill.showPrices ? row('Subtotal', money(bill.subtotal)) : ''}
      ${discountRow}
      ${taxRows}
      <tr class="grand"><td class="label" colspan="2">TOTAL</td><td class="amount">${money(
        bill.total,
      )}</td></tr>
      ${
        bill.tdsAmount > 0
          ? row(`TDS withheld @ ${bill.tdsRate}%`, `-${money(bill.tdsAmount)}`) +
            row('Amount payable', money(bill.amountPayable))
          : ''
      }
    </table>
    <div class="foot">${status}</div>
    ${qr}
    <div class="thanks">Thanks for visiting us</div>
  `;

  return printHtml(`Bill ${bill.orderNumber}`, body, paper, paper.billFontPx);
}
