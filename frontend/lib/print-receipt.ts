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
 * Monospace and 72mm of usable width, because an 80mm roll prints about 72mm and
 * aligned columns are what makes a ticket readable at a glance across a kitchen.
 */

/** An 80mm roll prints about 72mm; the rest is the printer's own margin. */
const ROLL_WIDTH_MM = 80;
const CONTENT_WIDTH_MM = 72;

/** CSS pixels are 96 to the inch by definition, whatever the screen does. */
const PX_PER_MM = 96 / 25.4;

/**
 * A little paper after the last line, so a cutter does not clip the footer.
 * Thermal rolls are continuous, so this costs millimetres rather than a sheet.
 */
const TAIL_MM = 4;

const PAPER_CSS = `
  @page { margin: 0; }
  html, body { margin: 0; background: #fff; }
  body {
    width: ${CONTENT_WIDTH_MM}mm;
    padding: 3mm;
    font-family: "Courier New", ui-monospace, monospace;
    font-size: 12px;
    line-height: 1.35;
    color: #000;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h1 { margin: 0; font-size: 15px; letter-spacing: .02em; text-align: center; }
  .sub { text-align: center; font-size: 11px; }
  .big { font-size: 17px; font-weight: 700; text-align: center; margin: 2mm 0 1mm; }
  hr { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }
  table { width: 100%; border-collapse: collapse; }
  td { vertical-align: top; padding: .6mm 0; }
  td.qty { width: 9mm; font-weight: 700; }
  td.amount { text-align: right; white-space: nowrap; padding-left: 2mm; }
  .note { font-size: 11px; font-style: italic; padding-left: 9mm; }
  .totals td { padding: .4mm 0; }
  .totals .label { text-align: right; }
  .grand td { font-size: 14px; font-weight: 700; border-top: 1px solid #000; padding-top: 1mm; }
  .foot { text-align: center; font-size: 11px; margin-top: 3mm; }
`;

/**
 * Waits until the frame has actually laid out, so a measurement means something.
 *
 * Fonts are the reason this is not a single frame: a receipt measured before the
 * monospace face loads is measured against a fallback with different metrics,
 * and comes out a few millimetres short - which on a thermal roll clips the
 * footer. `fonts.ready` covers it where it exists, and two animation frames
 * cover the browsers where it does not.
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

  await new Promise<void>((resolve) =>
    win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve())),
  );
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );

/** Indian-format money without a currency symbol: thermal fonts rarely have one. */
const money = (value: number) =>
  value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const timestamp = (value: string) =>
  new Date(value).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Renders HTML in a hidden iframe and opens the print dialog.
 *
 * Resolves once printing has been *requested*, not once paper has moved - the
 * browser will not tell us that, so nothing in the UI should claim it did.
 */
async function printHtml(title: string, bodyHtml: string): Promise<void> {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
    title,
  )}</title><style>${PAPER_CSS}</style></head><body>${bodyHtml}</body></html>`;

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
  // lengths or the keyword `auto`, never both, so the `80mm auto` this used to
  // carry was invalid and silently dropped - which is why a six-line receipt
  // came out on a full sheet with a hand of blank paper under it. So the content
  // is measured once it has laid out, and the page is cut to fit.
  await whenLaidOut(frame);

  const heightMm = Math.max(
    20,
    Math.ceil((doc.body.scrollHeight / PX_PER_MM) + TAIL_MM),
  );

  const page = doc.createElement('style');
  page.textContent = `@page { size: ${ROLL_WIDTH_MM}mm ${heightMm}mm; margin: 0; }`;
  doc.head.appendChild(page);

  const cleanup = () => setTimeout(() => frame.remove(), 500);
  win.addEventListener('afterprint', cleanup, { once: true });
  win.focus();
  win.print();
  // Browsers that print synchronously never fire afterprint on the frame.
  setTimeout(cleanup, 60_000);
}

/**
 * A kitchen ticket.
 *
 * No prices anywhere - the kitchen is cooking, not charging - and quantities are
 * the heaviest thing on the page, because that is what a cook reads first.
 */
export function printKotTicket(ticket: KotPrint): Promise<void> {
  const lines = ticket.items
    .map(
      (item) =>
        `<tr><td class="qty">${item.quantity} x</td><td>${escapeHtml(item.name)}</td></tr>` +
        (item.note ? `<tr><td colspan="2" class="note">${escapeHtml(item.note)}</td></tr>` : ''),
    )
    .join('');

  const body = `
    <h1>KITCHEN ORDER</h1>
    <div class="sub">${escapeHtml(ticket.restaurantName)}</div>
    <div class="big">${escapeHtml(ticket.tableName ?? 'Counter')}</div>
    <div class="sub">KOT #${ticket.ticketNumber} &middot; Bill #${ticket.orderNumber}</div>
    <div class="sub">${escapeHtml(timestamp(ticket.createdAt))}</div>
    <hr>
    <table>${lines}</table>
    <hr>
    <div class="foot">${ticket.items.length} item${ticket.items.length === 1 ? '' : 's'}</div>
  `;

  return printHtml(`KOT ${ticket.ticketNumber} - ${ticket.tableName ?? 'Counter'}`, body);
}

/** The diner's bill. Cancelled lines never reach it - the API leaves them out. */
export function printBill(bill: Bill): Promise<void> {
  const lines = bill.lines
    .map(
      (line) =>
        `<tr><td class="qty">${line.quantity} x</td><td>${escapeHtml(
          line.name,
        )}<br><span class="note" style="padding:0">@ ${money(line.unitPrice)}</span></td>` +
        `<td class="amount">${money(line.lineTotal)}</td></tr>`,
    )
    .join('');

  const row = (label: string, value: string) =>
    `<tr><td class="label" colspan="2">${escapeHtml(label)}</td><td class="amount">${value}</td></tr>`;

  const body = `
    <h1>${escapeHtml(bill.restaurantName)}</h1>
    ${bill.restaurantAddress ? `<div class="sub">${escapeHtml(bill.restaurantAddress)}</div>` : ''}
    ${bill.restaurantPhone ? `<div class="sub">${escapeHtml(bill.restaurantPhone)}</div>` : ''}
    ${bill.taxNumber ? `<div class="sub">GSTIN ${escapeHtml(bill.taxNumber)}</div>` : ''}
    <hr>
    <div class="sub">Bill #${bill.orderNumber} &middot; ${escapeHtml(
      bill.tableName ?? 'Counter',
    )}</div>
    <div class="sub">${escapeHtml(
      bill.settledAt ? timestamp(bill.settledAt) : timestamp(new Date().toISOString()),
    )}</div>
    <hr>
    <table>${lines}</table>
    <hr>
    <table class="totals">
      ${row('Subtotal', money(bill.subtotal))}
      ${
        bill.discountAmount > 0
          ? row(
              bill.discountReason ? `Discount (${bill.discountReason})` : 'Discount',
              `-${money(bill.discountAmount)}`,
            )
          : ''
      }
      ${
        /* Each component on its own line. A tax invoice that shows one combined
           "tax 5%" is not a valid GST invoice: CGST and SGST are filed
           separately and the guest is entitled to see both. */
        bill.charges.length > 0
          ? bill.charges
              .map((charge) => row(`${escapeHtml(charge.name)} @ ${charge.rate}%`, money(charge.amount)))
              .join('')
          : bill.taxAmount > 0
            ? row(`Tax @ ${bill.taxRate}%`, money(bill.taxAmount))
            : ''
      }
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
    <hr>
    <div class="foot">
      ${
        bill.status === 'SETTLED'
          ? `Paid by ${escapeHtml(bill.paymentMethod ?? 'cash')}`
          : 'Not settled yet'
      }
      <br>Thank you. Please visit again.
    </div>
  `;

  return printHtml(`Bill ${bill.orderNumber}`, body);
}
