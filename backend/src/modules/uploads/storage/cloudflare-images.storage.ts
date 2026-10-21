import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import type { AppConfig } from 'src/config/configuration';
import {
  DISH_PHOTO,
  type AssetKind,
  type PhotoStorage,
  type StoredPhoto,
} from './photo-storage.interface';

/**
 * Dish photos in Cloudflare Images.
 *
 * Two things make this worth the dependency. Photos stop living on the API's own
 * volume, so a deploy, a volume problem or a second API instance cannot lose or
 * hide them; and Cloudflare derives the sizes, so the menu grid can be served a
 * 400px variant of a photo that was uploaded at 1600px without Plateo storing,
 * naming or backfilling a second file.
 *
 * **It never falls back to local disk.** A photo that silently lands somewhere
 * other than where the restaurant was told is worse than an upload the owner
 * retries: it is on one instance's disk, invisible to the others, and nobody
 * discovers it until the menu is half broken.
 */

/** Cloudflare's upload response, narrowed to what is used. */
interface UploadResponse {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  result?: {
    id: string;
    /** Full delivery URLs, one per configured variant. */
    variants?: string[];
  };
}

const API_ROOT = 'https://api.cloudflare.com/client/v4';
const DELIVERY_HOST = 'https://imagedelivery.net';

/** An upload that hangs must not hold a request open until the proxy gives up. */
const UPLOAD_TIMEOUT_MS = 20_000;

@Injectable()
export class CloudflareImagesStorage implements PhotoStorage {
  readonly name = 'CLOUDFLARE_IMAGES';

  private readonly logger = new Logger(CloudflareImagesStorage.name);

  constructor(private readonly config: AppConfig['uploads']['cloudflare']) {}

  /** True only with all three credentials. See the config comment on why. */
  static isConfigured(config: AppConfig['uploads']['cloudflare']): boolean {
    return Boolean(config.accountId && config.token && config.accountHash);
  }

  async store(
    restaurantId: number,
    image: Buffer,
    width: number,
    height: number,
    kind: AssetKind = DISH_PHOTO,
  ): Promise<StoredPhoto> {
    const form = new FormData();

    // Already re-encoded by the caller: EXIF stripped, orientation applied, and
    // the bytes are ours rather than the uploader's. The kind decides the
    // encoding - a photograph is WebP, a payment QR is lossless PNG.
    form.append(
      'file',
      new Blob([new Uint8Array(image)], { type: kind.mimeType }),
      `${kind.folder}.${kind.extension}`,
    );
    // Metadata is returned by Cloudflare's own listing, which is what makes an
    // orphaned image traceable back to a restaurant months later. The kind is
    // recorded too: there are no folders here, so this is the only thing that
    // distinguishes a menu photo from a restaurant's payment code.
    form.append('metadata', JSON.stringify({ restaurantId: String(restaurantId), kind: kind.folder }));
    // Served straight from the delivery URL; there are no private menu photos.
    form.append('requireSignedURLs', 'false');

    const body = await this.call<UploadResponse>('POST', `/images/v1`, form);
    const id = body.result?.id;

    if (!id) {
      throw new InternalServerErrorException('Cloudflare accepted the photo but returned no id.');
    }

    return {
      url: this.deliveryUrl(id, this.config.fullVariant),
      thumbnailUrl: this.deliveryUrl(id, this.config.thumbnailVariant),
      width,
      height,
      bytes: image.length,
    };
  }

  async remove(url: string): Promise<void> {
    const id = this.idFrom(url);

    // Not one of ours: a photo uploaded before this was configured still lives on
    // the local volume, and its URL must not be mistaken for an image id.
    if (!id) return;

    try {
      await this.call('DELETE', `/images/v1/${encodeURIComponent(id)}`);
    } catch (error) {
      // Deliberately swallowed. This runs when a photo is replaced, and failing
      // the replacement because the *old* image could not be deleted would block
      // the owner from fixing a bad photo. The cost of a miss is one orphaned
      // image, which Cloudflare's own listing can reconcile later.
      this.logger.warn(`Could not delete a Cloudflare image: ${(error as Error).message}`);
    }
  }

  thumbnailFor(url: string): string {
    const id = this.idFrom(url);

    return id ? this.deliveryUrl(id, this.config.thumbnailVariant) : url;
  }

  private deliveryUrl(id: string, variant: string): string {
    return `${DELIVERY_HOST}/${this.config.accountHash}/${id}/${variant}`;
  }

  /**
   * The image id inside one of our delivery URLs, or null.
   *
   * Matched against this account's hash specifically, so a URL pointing at some
   * other Cloudflare account is not treated as ours and cannot be used to aim a
   * delete at an id we do not own.
   */
  private idFrom(url: string): string | null {
    const prefix = `${DELIVERY_HOST}/${this.config.accountHash}/`;

    if (!url.startsWith(prefix)) return null;

    const [id] = url.slice(prefix.length).split('/');

    return id || null;
  }

  private async call<T>(method: 'POST' | 'DELETE', path: string, body?: FormData): Promise<T> {
    const response = await fetch(`${API_ROOT}/accounts/${this.config.accountId}${path}`, {
      method,
      // No Content-Type: fetch sets it with the multipart boundary, and setting
      // it by hand omits the boundary and makes Cloudflare reject the body.
      headers: { Authorization: `Bearer ${this.config.token}` },
      body,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });

    const parsed = (await response.json().catch(() => null)) as
      | { success?: boolean; errors?: Array<{ code: number; message: string }> }
      | null;

    if (!response.ok || !parsed?.success) {
      const detail = parsed?.errors?.map((error) => `${error.code}: ${error.message}`).join('; ');

      // Logged in full, reported vaguely. Cloudflare's errors name the account
      // and the token's shortcomings, and neither belongs in a response to
      // whoever is uploading.
      this.logger.error(
        `Cloudflare Images ${method} ${path} failed (HTTP ${response.status}): ${detail ?? 'no detail'}`,
      );

      throw new InternalServerErrorException(
        'The photo could not be saved to image storage. Please try again.',
      );
    }

    return parsed as T;
  }
}
