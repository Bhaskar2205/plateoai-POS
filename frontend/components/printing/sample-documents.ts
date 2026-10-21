import type { Bill, KotPrint, MeResponse, PrintSettings } from '@/lib/types';

/**
 * A made-up ticket and a made-up bill, for the test-print buttons.
 *
 * Printed through exactly the same code as the real thing, so a test print
 * proves what an owner actually wants proved: that the roll is the right width,
 * that nothing is clipped at the edges, that the page stops where the content
 * does, and that their payment QR comes out dark enough to scan. Putting a live
 * order through the printer to find that out means a real ticket in the kitchen.
 *
 * The figures are obviously fake - a three-line table at prices nobody charges -
 * because a sample that looked like a real bill is a sample somebody will one
 * day hand to a guest.
 */

const SAMPLE_ITEMS = [
  { name: 'Paneer Tikka', quantity: 2, unitPrice: 320, note: 'less spicy' },
  { name: 'Dal Makhani', quantity: 1, unitPrice: 280, note: null },
  { name: 'Butter Naan', quantity: 4, unitPrice: 70, note: null },
];

export function sampleKot(session: MeResponse): KotPrint {
  return {
    restaurantName: session.restaurant.name,
    ticketNumber: 0,
    orderNumber: 0,
    tableName: 'TEST',
    businessDate: new Date().toISOString().slice(0, 10),
    createdAt: new Date().toISOString(),
    items: SAMPLE_ITEMS.map((item, index) => ({
      id: index,
      name: item.name,
      quantity: item.quantity,
      note: item.note,
      status: 'QUEUED',
      ingredients: [],
      allergens: [],
    })),
  };
}

export function sampleBill(session: MeResponse, settings: PrintSettings | undefined): Bill {
  const lines = SAMPLE_ITEMS.map((item) => ({
    name: item.name,
    unitPrice: item.unitPrice,
    quantity: item.quantity,
    lineTotal: item.unitPrice * item.quantity,
  }));

  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const rate = session.restaurant.taxRate ?? 0;
  const taxAmount = Math.round(subtotal * (rate / 100) * 100) / 100;

  return {
    orderId: 0,
    orderNumber: 0,
    businessDate: new Date().toISOString().slice(0, 10),
    restaurantName: session.restaurant.name,
    restaurantAddress: session.restaurant.address ?? null,
    restaurantPhone: session.restaurant.phone ?? null,
    taxNumber: session.restaurant.taxNumber ?? null,
    tableName: 'TEST',
    // The sample shows the QR whenever it is switched on, including on the
    // "settled" line below - this is the one place it is worth seeing it even
    // though a real settled bill never carries it.
    paymentQrUrl: settings?.printPaymentQr ? (settings.paymentQrUrl ?? null) : null,
    paymentQrLabel: settings?.paymentQrLabel ?? null,
    lines,
    subtotal,
    discountAmount: 0,
    discountReason: null,
    taxRate: rate,
    taxAmount,
    serviceChargeAmount: 0,
    charges: [],
    total: subtotal + taxAmount,
    tdsRate: null,
    tdsAmount: 0,
    amountPayable: subtotal + taxAmount,
    status: 'OPEN',
    paymentMethod: null,
    settledAt: null,
  };
}
