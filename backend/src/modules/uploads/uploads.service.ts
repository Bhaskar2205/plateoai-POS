import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import type { AppConfig } from 'src/config/configuration';

/**
 * Dish photos: accept a file from a phone, and store something safe to serve.
 *
 * Every upload is **re-encoded** with sharp rather than stored as it arrived.
 * That one decision does most of the security work here:
 *
 *  - a file that is not really an image fails to decode, so a renamed script or
 *    a polyglot never reaches the disk;
 *  - EXIF is dropped, and phone photos routinely carry the GPS coordinates of
 *    the restaurant's kitchen;
 *  - the bytes served are produced by us, not by the uploader.
 *
 * The filename is random, so it cannot collide, cannot be guessed, and cannot
 * contain a path the caller chose.
 */

/** Longest edge kept. A menu photo is displayed at ~300px; 1600 covers retina and zoom. */
const MAX_WIDTH = 1600;
const MAX_HEIGHT = 1600;
const WEBP_QUALITY = 80;

/** Magic bytes for the formats we accept, checked before handing anything to sharp. */
const SIGNATURES: Array<{ format: string; test: (bytes: Buffer) => boolean }> = [
  { format: 'jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    format: 'png',
    test: (b) =>
      b.length > 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    format: 'webp',
    test: (b) =>
      b.length > 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
];

export const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export interface StoredPhoto {
  /** Absolute URL to save on the dish. */
  url: string;
  width: number;
  height: number;
  bytes: number;
}

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private readonly config: AppConfig['uploads'];

  constructor(configService: ConfigService) {
    this.config = configService.get<AppConfig['uploads']>('uploads')!;
  }

  get maxBytes(): number {
    return this.config.maxBytes;
  }

  /**
   * Stores one dish photo for a restaurant and returns the URL to save on the dish.
   *
   * Files are filed under the restaurant's own id. The URL is unguessable either
   * way, but it means a restaurant's photos can be found, counted and removed as
   * a set - which matters the day someone closes their account.
   */
  async storeDishPhoto(restaurantId: number, file: Express.Multer.File): Promise<StoredPhoto> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No photo was uploaded.');
    }

    if (file.size > this.config.maxBytes) {
      throw new BadRequestException(
        `That photo is larger than ${Math.round(this.config.maxBytes / (1024 * 1024))} MB.`,
      );
    }

    if (!ACCEPTED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Photos must be a JPEG, PNG or WebP image.');
    }

    // The declared type is whatever the browser said; the bytes are the truth.
    if (!SIGNATURES.some((signature) => signature.test(file.buffer))) {
      throw new BadRequestException('That file is not a JPEG, PNG or WebP image.');
    }

    let output: Buffer;
    let width: number;
    let height: number;

    try {
      const result = await sharp(file.buffer, { failOn: 'error' })
        // Honour the EXIF orientation before stripping EXIF, or portrait photos
        // taken on a phone come out sideways.
        .rotate()
        .resize({ width: MAX_WIDTH, height: MAX_HEIGHT, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer({ resolveWithObject: true });

      output = result.data;
      width = result.info.width;
      height = result.info.height;
    } catch (error) {
      this.logger.warn(`Rejected an unreadable image upload: ${(error as Error).message}`);
      throw new BadRequestException('That image could not be read. Try a different photo.');
    }

    const name = `${randomBytes(16).toString('hex')}.webp`;
    const directory = join(this.baseDirectory(), 'dishes', String(restaurantId));

    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, name), output);

    return {
      url: `${this.config.publicApiUrl}/uploads/dishes/${restaurantId}/${name}`,
      width,
      height,
      bytes: output.length,
    };
  }

  /** Absolute path of the uploads root, resolved once from the configured value. */
  baseDirectory(): string {
    return resolve(this.config.directory);
  }
}
