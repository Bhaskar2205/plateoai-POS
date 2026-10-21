/**
 * Where a dish photo is kept.
 *
 * Expressed entirely in Plateo's terms - bytes in, URLs out. No Cloudflare type
 * appears outside the Cloudflare implementation, for the same reason no Razorpay
 * type appears outside its provider: the moment a vendor's shape reaches a
 * service, changing vendor means rewriting the service.
 *
 * Two URLs come back rather than one. The menu grid shows sixty-four photos at
 * ~350px and the details sheet shows one at full size; serving the same 115 KB
 * file to both is what makes a long menu expensive to scroll.
 */
/**
 * What kind of image is being stored.
 *
 * Two things differ between an image of a dish and an image of a payment QR, and
 * both have to reach the store: where it is filed, and what it is encoded as. A
 * dish photo is WebP because it is a photograph served to phones over and over;
 * a payment QR is PNG because it is line art that a thermal printer thresholds
 * to one bit, and a lossy codec puts grey fringes on exactly the edges the
 * scanner is looking for.
 *
 * Keeping them in separate folders is not tidiness: it is what lets a
 * restaurant's menu photos be swept without taking its payment code with them.
 */
export interface AssetKind {
  /** Folder on the local volume, and the label recorded in Cloudflare metadata. */
  readonly folder: 'dishes' | 'payment-qr';
  readonly extension: 'webp' | 'png';
  readonly mimeType: 'image/webp' | 'image/png';
}

export const DISH_PHOTO: AssetKind = {
  folder: 'dishes',
  extension: 'webp',
  mimeType: 'image/webp',
};

export const PAYMENT_QR: AssetKind = {
  folder: 'payment-qr',
  extension: 'png',
  mimeType: 'image/png',
};

export interface StoredPhoto {
  /** Full-size URL, saved on the dish. */
  url: string;
  /**
   * Smaller URL for the menu grid. Equal to `url` when the backing store cannot
   * resize - a local-disk photo has no thumbnail, and pretending otherwise would
   * produce a URL that 404s.
   */
  thumbnailUrl: string;
  width: number;
  height: number;
  bytes: number;
}

export interface PhotoStorage {
  /** Named in logs and in the uploads health check. */
  readonly name: string;

  /**
   * Stores one re-encoded image and returns its URLs.
   *
   * `restaurantId` scopes the stored object so a restaurant's photos can be found
   * and removed as a set, which matters the day somebody closes their account.
   */
  store(
    restaurantId: number,
    image: Buffer,
    width: number,
    height: number,
    kind?: AssetKind,
  ): Promise<StoredPhoto>;

  /**
   * Removes a photo previously stored here, given the URL saved on the dish.
   *
   * Best effort by contract: a URL this store does not recognise - an older photo
   * from a different backend, or one already deleted - is a no-op, not an error.
   * Replacing a dish photo must not fail because the previous file had already
   * gone.
   */
  remove(url: string): Promise<void>;

  /**
   * The grid-sized URL for a photo stored earlier.
   *
   * Lets the public menu offer a thumbnail for photos uploaded before this
   * existed, without a migration: the variant is derivable from the URL.
   */
  thumbnailFor(url: string): string;
}
