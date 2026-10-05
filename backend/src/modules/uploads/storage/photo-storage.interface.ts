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
  store(restaurantId: number, image: Buffer, width: number, height: number): Promise<StoredPhoto>;

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
