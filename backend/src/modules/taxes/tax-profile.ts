import { Repository } from 'typeorm';
import { TaxGroup, TaxKind } from 'src/common/enums';
import type { TaxComponentInput } from 'src/common/utils/tax.util';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { TaxComponent } from './entities/tax-component.entity';

/**
 * The charges a restaurant's bills currently carry.
 *
 * Read fresh on every recalculation of an open bill, so a rate corrected at four
 * o'clock applies to the tables still sitting. Settled bills keep their own
 * snapshot in `order_charges` and are untouched by a change here.
 *
 * Switched-off components are left out rather than sent through at zero, so a
 * bill does not print "Service charge 0%" for something the restaurant stopped
 * charging.
 */
export async function loadTaxComponents(
  repository: Repository<TaxComponent>,
  restaurants: Repository<Restaurant>,
  restaurantId: number,
): Promise<TaxComponentInput[]> {
  const components = await repository.find({
    where: { restaurantId, isActive: true },
    order: { sortOrder: 'ASC', id: 'ASC' },
  });

  if (components.length > 0) {
    return components.map((component) => ({
      name: component.name,
      kind: component.kind,
      rate: component.rate,
      appliesTo: component.appliesTo,
    }));
  }

  // Nothing configured: fall back to the single percentage on the restaurant
  // profile, which is what this billed before components existed and what the
  // profile screen still writes. Without this, a restaurant that had set 5%
  // there would quietly stop charging tax the day this shipped.
  const restaurant = await restaurants.findOne({
    where: { id: restaurantId },
    select: { id: true, taxRate: true },
  });

  const rate = restaurant?.taxRate ?? 0;

  return rate > 0
    ? [{ name: 'Tax', kind: TaxKind.OTHER, rate, appliesTo: TaxGroup.STANDARD }]
    : [];
}

/**
 * What a restaurant most likely owes, offered when it has set nothing up.
 *
 * 5% split in half is the rate for a standalone restaurant, which is the common
 * case; a restaurant inside a hotel charging above the room-tariff threshold, or
 * one billing across a state line as IGST, edits this. These are a starting
 * point a restaurant confirms, never something applied on its behalf.
 */
export const SUGGESTED_PROFILES: Array<{
  id: string;
  label: string;
  description: string;
  components: Array<Omit<TaxComponentInput, 'name'> & { name: string }>;
}> = [
  {
    id: 'restaurant-5',
    label: 'Restaurant · 5% GST',
    description:
      'A standalone restaurant, cafe or coffee shop. 5% GST without input tax credit, split as CGST and SGST.',
    components: [
      { name: 'CGST', kind: TaxKind.CGST, rate: 2.5, appliesTo: TaxGroup.STANDARD },
      { name: 'SGST', kind: TaxKind.SGST, rate: 2.5, appliesTo: TaxGroup.STANDARD },
    ],
  },
  {
    id: 'hotel-18',
    label: 'Restaurant in a hotel · 18% GST',
    description:
      'For a restaurant in a hotel where any room is declared above the tariff threshold. 18% with input tax credit.',
    components: [
      { name: 'CGST', kind: TaxKind.CGST, rate: 9, appliesTo: TaxGroup.STANDARD },
      { name: 'SGST', kind: TaxKind.SGST, rate: 9, appliesTo: TaxGroup.STANDARD },
    ],
  },
  {
    id: 'interstate-5',
    label: 'Across a state line · 5% IGST',
    description: 'One line of IGST instead of CGST and SGST, for a supply billed to another state.',
    components: [{ name: 'IGST', kind: TaxKind.IGST, rate: 5, appliesTo: TaxGroup.STANDARD }],
  },
  {
    id: 'bar-5-vat',
    label: 'Restaurant with a bar',
    description:
      'Adds state VAT on anything marked as alcohol, which stays outside GST. Check your own state rate.',
    components: [
      { name: 'CGST', kind: TaxKind.CGST, rate: 2.5, appliesTo: TaxGroup.STANDARD },
      { name: 'SGST', kind: TaxKind.SGST, rate: 2.5, appliesTo: TaxGroup.STANDARD },
      { name: 'VAT', kind: TaxKind.VAT, rate: 20, appliesTo: TaxGroup.ALCOHOL },
    ],
  },
];
