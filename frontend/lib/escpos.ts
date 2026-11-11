/**
 * ESC/POS: the printer's own language.
 *
 * Everything printed through a browser goes Chrome -> a page -> the Windows
 * driver, and the driver decides the paper: its form length, its margins, its
 * orientation and how far to scale. That is where a restaurant's bill came out
 * sideways down two metres of blank roll, and no CSS can reach it.
 *
 * A command stream has no page. The printer prints each line as it arrives in
 * its own Font A, and the receipt is exactly as long as the lines sent, ending
 * with a cut. Petpooja, Posnic and every till-side POS print this way.
 *
 * Only the commands every Epson TM printer since the TM-T88 understands are used,
 * so a TM-T82X, a TM-T82X-II and the many ESC/POS clones in Indian restaurants
 * all read the same bytes.
 */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** Font A is 12 dots wide on every TM printer, at 203 dpi. */
export const FONT_A_DOTS_WIDE = 12;

export type Align = 'left' | 'center' | 'right';

/** A 1-bit image, one row after another, eight dots to a byte, MSB first. */
export interface Bitmap {
  widthDots: number;
  heightDots: number;
  /** `ceil(widthDots / 8)` bytes per row; a set bit is a burned dot. */
  data: Uint8Array;
}

/**
 * Text the printer can actually print.
 *
 * Code page 437 has no rupee sign and no Devanagari, and a byte it does not know
 * prints as a box or, on some clones, as a different letter entirely. So text is
 * reduced to printable ASCII: accents dropped, typographic punctuation made
 * plain, and anything left over replaced rather than sent raw.
 */
export const printable = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/₹/g, 'Rs')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/×/g, 'x')
    .replace(/…/g, '...')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/[^\x20-\x7e]/g, '?');

/**
 * Breaks text into lines of at most `width` characters, on spaces where it can.
 *
 * A word longer than the line is cut rather than allowed to overflow: an
 * overflowing ESC/POS line wraps on the printer at an arbitrary character and
 * throws every column after it out of alignment.
 */
export function wrap(value: string, width: number): string[] {
  const text = printable(value).trim();
  if (width < 1) return [text];
  if (text === '') return [''];

  const lines: string[] = [];
  let current = '';

  for (const word of text.split(/ +/)) {
    let rest = word;

    while (rest.length > width) {
      if (current) {
        lines.push(current);
        current = '';
      }
      lines.push(rest.slice(0, width));
      rest = rest.slice(width);
    }

    if (!current) current = rest;
    else if (current.length + 1 + rest.length <= width) current += ' ' + rest;
    else {
      lines.push(current);
      current = rest;
    }
  }

  if (current) lines.push(current);
  return lines;
}

/** Builds one print job as bytes. */
export class EscPosBuilder {
  private readonly bytes: number[] = [];
  private widthScale = 1;

  /**
   * @param dots    dots the head covers across the roll (576 on 80mm)
   */
  constructor(readonly dots: number) {}

  /** Characters per line at the current width scale. */
  get columns(): number {
    return Math.floor(this.dots / (FONT_A_DOTS_WIDE * this.widthScale));
  }

  private push(...values: number[]): this {
    for (const value of values) this.bytes.push(value & 0xff);
    return this;
  }

  /**
   * Resets the printer and sets the house style.
   *
   * Line spacing is 30 dots (3.75mm) rather than the 1/6-inch default: Font A is
   * 24 dots tall, so this leaves a clean 6-dot gap and reads as tightly as the
   * Petpooja receipt a restaurant held up as the standard.
   */
  init(): this {
    this.push(ESC, 0x40); // ESC @   initialise
    this.push(ESC, 0x74, 0); // ESC t 0 code page 437
    this.push(ESC, 0x4d, 0); // ESC M 0 Font A
    this.push(ESC, 0x33, 30); // ESC 3 n line spacing in dots
    this.widthScale = 1;
    return this;
  }

  align(align: Align): this {
    return this.push(ESC, 0x61, align === 'left' ? 0 : align === 'center' ? 1 : 2);
  }

  bold(on: boolean): this {
    return this.push(ESC, 0x45, on ? 1 : 0);
  }

  /** Character size, as multiples of Font A. Double width halves the columns. */
  size(width: 1 | 2, height: 1 | 2): this {
    this.widthScale = width;
    return this.push(GS, 0x21, ((width - 1) << 4) | (height - 1));
  }

  /** Raw text, without a line feed. Callers keep it within `columns`. */
  text(value: string): this {
    for (const char of printable(value)) this.bytes.push(char.charCodeAt(0));
    return this;
  }

  line(value = ''): this {
    return this.text(value).push(LF);
  }

  /** Every wrapped line of `value`, under the current alignment. */
  paragraph(value: string): this {
    for (const line of wrap(value, this.columns)) this.line(line);
    return this;
  }

  /** A dashed rule across the full width. */
  rule(): this {
    return this.line('-'.repeat(this.columns));
  }

  /**
   * A label on the left and a figure flush right, the figure never broken.
   *
   * The label wraps within the space the figure leaves, and only its first line
   * carries the figure - so a long dish name costs a second line, never a
   * misaligned amount column.
   */
  columnsRow(left: string, right: string, leftIndent = 0): this {
    const figure = printable(right);
    const space = Math.max(1, this.columns - figure.length - 1);
    const lines = wrap(left, space - leftIndent);

    lines.forEach((text, index) => {
      const body = ' '.repeat(index === 0 ? 0 : leftIndent) + text;
      this.line(index === 0 ? body.padEnd(this.columns - figure.length) + figure : body);
    });

    return this;
  }

  /**
   * A label right-aligned against a figure, the way totals are set on a bill:
   *
   *                          Subtotal      700.00
   */
  totalRow(label: string, figure: string, figureWidth = 12): this {
    const value = printable(figure).padStart(figureWidth);
    const room = this.columns - value.length;
    const text = printable(label);

    return this.line((text.length > room ? text.slice(0, room) : text.padStart(room)) + value);
  }

  feed(lines: number): this {
    return this.push(ESC, 0x64, Math.max(0, Math.min(255, lines)));
  }

  /**
   * A raster image, centred by padding rather than by ESC a.
   *
   * Not every ESC/POS clone honours justification for images, and an image sent
   * at its own width prints hard against the left edge on those that do not.
   * Padding it to the full head width centres it on all of them. Sent in bands
   * because some printers cap a single raster command's height.
   */
  image(bitmap: Bitmap): this {
    const rowBytes = Math.ceil(this.dots / 8);
    const sourceRowBytes = Math.ceil(bitmap.widthDots / 8);
    const offsetDots = Math.max(0, Math.floor((this.dots - bitmap.widthDots) / 2));
    const BAND = 256;

    for (let top = 0; top < bitmap.heightDots; top += BAND) {
      const rows = Math.min(BAND, bitmap.heightDots - top);
      const band = new Uint8Array(rowBytes * rows);

      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < bitmap.widthDots && offsetDots + x < this.dots; x += 1) {
          const on = bitmap.data[(top + y) * sourceRowBytes + (x >> 3)] & (0x80 >> (x & 7));
          if (on) {
            const tx = offsetDots + x;
            band[y * rowBytes + (tx >> 3)] |= 0x80 >> (tx & 7);
          }
        }
      }

      // GS v 0 m xL xH yL yH d1...dk - raster bit image, normal density
      this.push(GS, 0x76, 0x30, 0, rowBytes & 0xff, rowBytes >> 8, rows & 0xff, rows >> 8);
      for (const byte of band) this.bytes.push(byte);
    }

    return this;
  }

  /**
   * Feeds the last line clear of the cutter, then cuts.
   *
   * GS V 66 n feeds n dots and then performs a partial cut, which leaves a hinge
   * of paper so the receipt hangs rather than dropping on the floor. The feed is
   * what the TM-T82X needs between its head and its blade; nothing else is fed.
   */
  cut(): this {
    return this.push(GS, 0x56, 66, 24);
  }

  build(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

/**
 * Loads an image and reduces it to printer dots.
 *
 * `dither` is for logos: a thermal head has no grey, so a coloured mark is
 * error-diffused (Floyd-Steinberg) into a dot pattern that keeps its shape. A
 * flat threshold turns a yellow taxi white. `threshold` is for QR codes, which
 * must stay hard-edged to scan, and are scaled without smoothing for the same
 * reason.
 *
 * Throws if the image cannot be read; callers print without it rather than not
 * printing at all.
 */
export async function loadBitmap(
  url: string,
  maxWidthDots: number,
  maxHeightDots: number,
  mode: 'dither' | 'threshold',
): Promise<Bitmap> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  await img.decode();

  const scale = Math.min(maxWidthDots / img.naturalWidth, maxHeightDots / img.naturalHeight, 1e6);
  const widthDots = Math.max(8, Math.floor(img.naturalWidth * scale));
  const heightDots = Math.max(1, Math.floor(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = widthDots;
  canvas.height = heightDots;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No 2D canvas available.');

  // Transparent pixels are paper, not ink.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, widthDots, heightDots);
  // Smoothing on when shrinking, off when enlarging. Shrinking a QR photo with
  // nearest-neighbour drops whole rows of modules and the code stops scanning;
  // averaging then thresholding keeps them. Enlarging with smoothing blurs the
  // module edges, so there the hard pixels are kept.
  ctx.imageSmoothingEnabled = mode === 'dither' || scale < 1;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, widthDots, heightDots);

  const { data } = ctx.getImageData(0, 0, widthDots, heightDots);
  const lum = new Float32Array(widthDots * heightDots);
  for (let i = 0; i < lum.length; i += 1) {
    lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }

  const rowBytes = Math.ceil(widthDots / 8);
  const out = new Uint8Array(rowBytes * heightDots);

  for (let y = 0; y < heightDots; y += 1) {
    for (let x = 0; x < widthDots; x += 1) {
      const i = y * widthDots + x;
      const old = lum[i];
      const on = old < 128;
      if (on) out[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);

      if (mode === 'dither') {
        const err = old - (on ? 0 : 255);
        if (x + 1 < widthDots) lum[i + 1] += (err * 7) / 16;
        if (y + 1 < heightDots) {
          if (x > 0) lum[i + widthDots - 1] += (err * 3) / 16;
          lum[i + widthDots] += (err * 5) / 16;
          if (x + 1 < widthDots) lum[i + widthDots + 1] += err / 16;
        }
      }
    }
  }

  return { widthDots, heightDots, data: out };
}
