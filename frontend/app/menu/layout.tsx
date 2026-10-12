import { Fraunces } from 'next/font/google';
import type { ReactNode } from 'react';

/**
 * Type for the guest menu, and only for the guest menu.
 *
 * A printed menu is set in a serif, and a page that opens from a QR code on a
 * table is competing with that memory rather than with other software. The
 * restaurant's name and its course headings get Fraunces - warm, slightly
 * literary, a little opinionated - while everything a diner actually reads at
 * length stays in the system sans, which is familiar and costs nothing to load.
 *
 * Scoped to this route on purpose. The admin app is a tool people work in all
 * day and wants to stay plain; this is somebody's shop window.
 *
 * `next/font` self-hosts the file at build time, so a table of guests scanning
 * at once makes no request to a font CDN. `display: swap` means the menu is
 * readable before the serif arrives rather than after it.
 */
const display = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  // Variable, so one file covers every weight the menu uses. `axes` is only
  // allowed when the weight is variable, which it is here.
  weight: 'variable',
  axes: ['SOFT', 'WONK'],
  variable: '--font-display-face',
});

export default function MenuLayout({ children }: { children: ReactNode }) {
  return <div className={display.variable}>{children}</div>;
}
