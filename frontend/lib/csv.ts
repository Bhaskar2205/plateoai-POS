/**
 * Writing CSV a spreadsheet and an accountant will both accept.
 *
 * Restaurants send these files on, so the rules that matter are the boring
 * ones: a field containing a comma, a quote or a newline is quoted and its
 * quotes doubled, and the file is written with CRLF line endings, which is what
 * RFC 4180 says and what stops Excel on Windows running a whole statement into
 * one cell.
 */

type Cell = string | number | null | undefined;

const escape = (value: Cell): string => {
  const text = value === null || value === undefined ? '' : String(value);

  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const toCsv = (rows: Cell[][]): string =>
  rows.map((row) => row.map(escape).join(',')).join('\r\n');

/**
 * Hands the browser a file.
 *
 * The BOM is deliberate: without it Excel reads a UTF-8 CSV as the system
 * codepage, and a rupee sign or a dish name in Devanagari arrives as mojibake
 * on the one machine that matters - the accountant's.
 */
export function downloadCsv(fileName: string, rows: Cell[][]): void {
  const blob = new Blob(['﻿', toCsv(rows)], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');

  link.href = URL.createObjectURL(blob);
  link.download = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}
