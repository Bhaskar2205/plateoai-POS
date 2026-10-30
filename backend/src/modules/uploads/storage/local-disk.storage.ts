import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AppConfig } from 'src/config/configuration';
import { DISH_PHOTO, LOGO, PAYMENT_QR, type AssetKind, type PhotoStorage, type StoredPhoto } from './photo-storage.interface';

/**
 * Photos on the API's own volume, served by Express.
 *
 * What Plateo has always done, and still the default: a restaurant that has not
 * configured Cloudflare keeps working exactly as before, and the test suite runs
 * with no network and no account.
 *
 * It offers no thumbnail - `thumbnailFor` returns the original URL. Generating a
 * second file here would mean a second write, a second path to clean up and a
 * backfill for every photo already stored, which is work that Cloudflare does for
 * nothing. A local menu serves full-size images and is slightly heavier; that is
 * the honest trade rather than a URL that resolves to nothing.
 */
@Injectable()
export class LocalDiskPhotoStorage implements PhotoStorage {
  readonly name = 'LOCAL_DISK';

  private readonly logger = new Logger(LocalDiskPhotoStorage.name);

  constructor(private readonly config: AppConfig['uploads']) {}

  async store(
    restaurantId: number,
    image: Buffer,
    width: number,
    height: number,
    kind: AssetKind = DISH_PHOTO,
  ): Promise<StoredPhoto> {
    // Random, so it cannot collide, cannot be guessed, and cannot contain a path
    // the caller chose.
    const name = `${randomBytes(16).toString('hex')}.${kind.extension}`;
    const directory = join(this.baseDirectory(), kind.folder, String(restaurantId));

    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, name), image);

    const url = `${this.config.publicApiUrl}/uploads/${kind.folder}/${restaurantId}/${name}`;

    return { url, thumbnailUrl: url, width, height, bytes: image.length };
  }

  async remove(url: string): Promise<void> {
    const path = this.pathFor(url);

    if (!path) return;

    try {
      await unlink(path);
    } catch (error) {
      // Already gone is the expected case on a retry, and nothing downstream
      // cares. Anything else is worth knowing about but must not fail the upload
      // that triggered it.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(`Could not remove an old photo: ${(error as Error).message}`);
      }
    }
  }

  thumbnailFor(url: string): string {
    return url;
  }

  /**
   * The file a stored URL refers to, or null when it is not one of ours.
   *
   * The path is rebuilt from the parsed segments rather than concatenated from
   * the URL, and the result is checked to sit under the uploads root. A URL is
   * attacker-influenced in principle, and `../` in a filename would otherwise
   * delete something else entirely.
   */
  private pathFor(url: string): string | null {
    const root = `${this.config.publicApiUrl}/uploads/`;

    if (!url.startsWith(root)) return null;

    const segments = url.slice(root.length).split('/');

    if (segments.length !== 3) return null;

    const [folder, restaurantId, name] = segments;

    // Matched against the folders we actually write, never against whatever the
    // URL happens to contain: this is the check that keeps a delete inside the
    // uploads tree even before the resolved path is re-tested below.
    const kind = [DISH_PHOTO, PAYMENT_QR, LOGO].find((candidate) => candidate.folder === folder);

    if (!kind) return null;
    if (!/^\d+$/.test(restaurantId)) return null;
    // `\\.` so the built pattern carries an escaped dot: in a template literal
    // `\.` is simply `.`, which would match any character.
    if (!new RegExp(`^[a-f0-9]{32}\\.${kind.extension}$`).test(name)) return null;

    const path = join(this.baseDirectory(), kind.folder, restaurantId, name);

    return path.startsWith(this.baseDirectory()) ? path : null;
  }

  private baseDirectory(): string {
    return resolve(this.config.directory);
  }
}
