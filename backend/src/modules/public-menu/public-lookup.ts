import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { RestaurantStatus } from 'src/common/enums';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { RestaurantTable } from 'src/modules/tables/entities/restaurant-table.entity';
import { isWellFormedTableToken } from 'src/modules/tables/table-token';

/**
 * Resolving a public menu URL, shared by the anonymous menu and anonymous
 * ordering.
 *
 * Both surfaces must answer an unknown restaurant, a suspended one, a foreign
 * table and a deactivated table *identically*, or the pair of endpoints becomes
 * an oracle: "the menu 404s but ordering 403s" tells an attacker the restaurant
 * exists. Keeping the rules in one place is what makes that guarantee hold as
 * either endpoint changes.
 */

/** Slugs are generated server-side as lowercase a-z, 0-9 and hyphens. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 190;

export const menuNotFound = (): NotFoundException =>
  new NotFoundException('This menu is not available.');

export const tableNotFound = (): NotFoundException =>
  new NotFoundException('This table is not available.');

/** The columns every public caller may read. Never widen this casually. */
export const PUBLIC_RESTAURANT_COLUMNS = {
  id: true,
  name: true,
  slug: true,
  publicSlug: true,
  description: true,
  address: true,
  logoUrl: true,
} as const;

/**
 * Resolves a menu URL segment by the restaurant's current `slug` or its permanent
 * `publicSlug`, so links issued before a rename (table QR codes, shared links)
 * keep working.
 *
 * The two columns share one namespace on write, so at most one restaurant
 * matches; if that ever failed, the permanent identifier wins, because it is the
 * one printed on QR codes.
 *
 * Unknown, malformed and suspended restaurants all produce the same 404, so the
 * endpoint cannot be used to discover which slugs exist or are suspended.
 */
export async function resolveActiveRestaurant(
  restaurants: Repository<Restaurant>,
  slug: string,
): Promise<Restaurant> {
  const normalised = slug.trim().toLowerCase();

  if (normalised.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(normalised)) {
    throw menuNotFound();
  }

  const matches = await restaurants.find({
    where: [
      { publicSlug: normalised, status: RestaurantStatus.ACTIVE },
      { slug: normalised, status: RestaurantStatus.ACTIVE },
    ],
    select: PUBLIC_RESTAURANT_COLUMNS,
    take: 2,
  });

  const restaurant = matches.find((row) => row.publicSlug === normalised) ?? matches[0];

  if (!restaurant) {
    throw menuNotFound();
  }

  return restaurant;
}

/**
 * Resolves a table from the `?table=` value of a QR link.
 *
 * Unknown tokens, another restaurant's table and deactivated tables all give the
 * same 404, so the endpoint reveals nothing about which tokens exist.
 */
export async function resolveActiveTable(
  tables: Repository<RestaurantTable>,
  restaurantId: number,
  token: unknown,
): Promise<RestaurantTable> {
  if (!isWellFormedTableToken(token)) {
    throw tableNotFound();
  }

  const table = await tables.findOne({
    where: { qrToken: token, restaurantId, isActive: true },
    select: { id: true, name: true, qrToken: true, isActive: true },
  });

  // Exact comparison as well as the binary column collation: tokens are
  // case-sensitive, and SQLite (tests) or a mis-collated column must not relax that.
  if (!table || table.qrToken !== token) {
    throw tableNotFound();
  }

  return table;
}
