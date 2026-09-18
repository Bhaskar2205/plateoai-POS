/**
 * Browser-side QR code rendering for table cards.
 *
 * The `qrcode` package is loaded on demand, so it never weighs on pages that
 * show no QR codes, and nothing here runs during server rendering.
 */

export interface QrCardInput {
  /** The public menu URL encoded into the QR code. */
  url: string;
  tableName: string;
  restaurantName: string;
}

const INK = '#1c1917';
const MUTED = '#78716c';

async function loadQrCode() {
  const qrcode = await import('qrcode');
  return qrcode.default ?? qrcode;
}

/** A plain square QR code as a PNG data URL, for on-screen previews. */
export async function renderQrDataUrl(url: string, size = 320): Promise<string> {
  const QRCode = await loadQrCode();

  return QRCode.toDataURL(url, {
    // "M" survives a scuffed or slightly creased table card.
    errorCorrectionLevel: 'M',
    margin: 2,
    width: size,
    color: { dark: INK, light: '#ffffff' },
  });
}

/** Largest font size (<= max) at which `text` fits in `width`. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, max: number, width: number, family: string) {
  let size = max;
  do {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= width) return;
    size -= 2;
  } while (size > 16);
}

/**
 * A print-ready card: restaurant name, the QR code, the table name and a short
 * instruction, on a white 1200x1600 canvas (4 x 5.33 in at 300 dpi).
 */
export async function renderQrCard({ url, tableName, restaurantName }: QrCardInput): Promise<string> {
  const QRCode = await loadQrCode();

  const width = 1200;
  const height = 1600;
  const qrSize = 880;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available in this browser.');

  const family = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // Restaurant name
  ctx.fillStyle = MUTED;
  fitFont(ctx, restaurantName, 600, 56, width - 160, family);
  ctx.fillText(restaurantName, width / 2, 170);

  // QR code
  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, url, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: qrSize,
    color: { dark: INK, light: '#ffffff' },
  });
  const qrTop = 230;
  ctx.drawImage(qrCanvas, (width - qrSize) / 2, qrTop, qrSize, qrSize);

  // Table name
  ctx.fillStyle = INK;
  fitFont(ctx, tableName, 700, 104, width - 160, family);
  ctx.fillText(tableName, width / 2, qrTop + qrSize + 150);

  // Instruction + footer
  ctx.fillStyle = MUTED;
  ctx.font = `400 44px ${family}`;
  ctx.fillText('Scan to view the menu', width / 2, qrTop + qrSize + 240);
  ctx.font = `500 30px ${family}`;
  ctx.fillText('Powered by Plateo', width / 2, height - 60);

  return canvas.toDataURL('image/png');
}

/** `Town Coffee` + `Table 01` -> `town-coffee-table-01-qr.png` */
export function qrFileName(restaurantName: string, tableName: string): string {
  const slug = (value: string) =>
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  return `${[slug(restaurantName), slug(tableName)].filter(Boolean).join('-') || 'table'}-qr.png`;
}

export async function downloadQrCard(input: QrCardInput): Promise<void> {
  const dataUrl = await renderQrCard(input);
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = qrFileName(input.restaurantName, input.tableName);
  document.body.appendChild(link);
  link.click();
  link.remove();
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

/**
 * Prints one or more QR cards, one per page, from a hidden iframe - so the admin
 * shell never ends up on paper and no pop-up blocker gets involved.
 */
export async function printQrCards(cards: QrCardInput[]): Promise<void> {
  if (cards.length === 0) return;

  const images = await Promise.all(cards.map((card) => renderQrCard(card)));
  const title = cards.length === 1 ? `${cards[0].restaurantName} - ${cards[0].tableName}` : `${cards[0].restaurantName} - table QR codes`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { size: auto; margin: 12mm; }
  html, body { margin: 0; background: #fff; }
  .page { display: flex; align-items: center; justify-content: center; height: calc(100vh - 1px); page-break-after: always; break-after: page; }
  .page:last-child { page-break-after: auto; break-after: auto; }
  img { max-width: 100%; max-height: 100%; object-fit: contain; }
</style></head><body>
${images
  .map((src, index) => `<div class="page"><img src="${src}" alt="${escapeHtml(`QR code for ${cards[index].tableName}`)}"></div>`)
  .join('\n')}
</body></html>`;

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
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

  await Promise.all([...doc.images].map((img) => img.decode().catch(() => undefined)));

  const cleanup = () => setTimeout(() => frame.remove(), 500);
  win.addEventListener('afterprint', cleanup, { once: true });
  win.focus();
  win.print();
  // Browsers that print synchronously never fire afterprint on the frame.
  setTimeout(cleanup, 60_000);
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  // Fallback for non-secure contexts (e.g. testing over a LAN IP).
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  Object.assign(field.style, { position: 'fixed', opacity: '0' });
  document.body.appendChild(field);
  field.select();
  const ok = document.execCommand('copy');
  field.remove();
  if (!ok) throw new Error('Copy failed');
}
