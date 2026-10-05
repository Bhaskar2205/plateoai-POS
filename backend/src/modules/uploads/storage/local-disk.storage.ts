import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AppConfig } from 'src/config/configuration';
import type { PhotoStorage, StoredPhoto } from './photo-storage.interface';

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
  ): Promise<StoredPhoto> {
    // Random, so it cannot collide, cannot be guessed, and cannot contain a path
    // the caller chose.
    const name = `${randomBytes(16).toString('hex')}.webp`;
    const directory = join(this.baseDirectory(), 'dishes', String(restaurantId));

    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, name), image);

    const url = `${this.config.publicApiUrl}/uploads/dishes/${restaurantId}/${name}`;

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
    if (!url.startsWith(`${this.config.publicApiUrl}/uploads/dishes/`)) return null;

    const segments = url.slice(`${this.config.publicApiUrl}/uploads/dishes/`.length).split('/');

    if (segments.length !== 2) return null;

    const [restaurantId, name] = segments;

    if (!/^\d+$/.test(restaurantId) || !/^[a-f0-9]{32}\.webp$/.test(name)) return null;

    const path = join(this.baseDirectory(), 'dishes', restaurantId, name);

    return path.startsWith(this.baseDirectory()) ? path : null;
  }

  private baseDirectory(): string {
    return resolve(this.config.directory);
  }
}
