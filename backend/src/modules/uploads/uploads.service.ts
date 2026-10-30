import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'node:path';
import sharp from 'sharp';
import type { AppConfig } from 'src/config/configuration';
import { CloudflareImagesStorage } from './storage/cloudflare-images.storage';
import { LocalDiskPhotoStorage } from './storage/local-disk.storage';
import { LOGO, PAYMENT_QR, type PhotoStorage, type StoredPhoto } from './storage/photo-storage.interface';

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

/**
 * A payment QR is stored differently from a photograph.
 *
 * 1000px is plenty for something printed at 30mm on a receipt and shown at a few
 * hundred pixels in the admin, and the encoding is lossless PNG rather than
 * WebP: a thermal printer thresholds the image to pure black and white, and the
 * grey fringes a lossy codec leaves on high-contrast edges land exactly on the
 * squares a scanner reads. It is also flattened onto white, because a QR with a
 * transparent background prints as a black rectangle on some drivers and loses
 * the quiet zone scanners need on every other.
 */
const QR_MAX_EDGE = 1000;

/**
 * A logo is printed across the top of a bill at about 40mm, which on a 203 dpi
 * head is 320 dots. 600 gives that headroom without storing a poster.
 */
const LOGO_MAX_EDGE = 600;

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

export type { StoredPhoto };

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private readonly config: AppConfig['uploads'];

  private readonly storage: PhotoStorage;

  constructor(configService: ConfigService) {
    this.config = configService.get<AppConfig['uploads']>('uploads')!;

    // Chosen once, at boot, and logged. Which store is in use decides whether
    // photos survive a deploy, so it should never be a question anybody has to
    // work out from behaviour.
    this.storage = CloudflareImagesStorage.isConfigured(this.config.cloudflare)
      ? new CloudflareImagesStorage(this.config.cloudflare)
      : new LocalDiskPhotoStorage(this.config);

    this.logger.log(`Dish photos are stored in ${this.storage.name}.`);
  }

  /** The grid-sized URL for a photo, whichever store it came from. */
  thumbnailFor(url: string): string {
    return this.storage.thumbnailFor(url);
  }

  /**
   * Removes a photo that is no longer referenced.
   *
   * Never throws. It runs when a dish photo is replaced or a dish is deleted, and
   * failing either of those because an old file could not be removed would be a
   * worse bug than the orphan it is preventing.
   */
  async removeDishPhoto(url: string | null | undefined): Promise<void> {
    return this.removeStored(url);
  }

  /**
   * Removes any image this service stored, whatever kind it was.
   *
   * Same contract as above and for the same reason: it runs when an owner
   * replaces their payment QR, and refusing the replacement because the old file
   * had already gone would leave them unable to fix a wrong code.
   */
  async removeStored(url: string | null | undefined): Promise<void> {
    if (!url) return;

    try {
      await this.storage.remove(url);
    } catch (error) {
      this.logger.warn(`Could not remove a replaced image: ${(error as Error).message}`);
    }
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

    return this.storage.store(restaurantId, output, width, height);
  }

  /**
   * Stores a restaurant's payment QR and returns the URL to save on the profile.
   *
   * Validated the same way as a dish photo - magic bytes, then a real decode -
   * because the threat is identical: this is a file from the internet that will
   * later be served to other people's browsers. What it deliberately does *not*
   * do is read the code. Plateo does not parse the QR, does not learn the UPI
   * handle inside it and never claims a scan was a payment; it stores a picture
   * the owner is responsible for, exactly like the one taped to their counter.
   */
  async storePaymentQr(restaurantId: number, file: Express.Multer.File): Promise<StoredPhoto> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No image was uploaded.');
    }

    if (file.size > this.config.maxBytes) {
      throw new BadRequestException(
        `That image is larger than ${Math.round(this.config.maxBytes / (1024 * 1024))} MB.`,
      );
    }

    if (!ACCEPTED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('The QR must be a JPEG, PNG or WebP image.');
    }

    if (!SIGNATURES.some((signature) => signature.test(file.buffer))) {
      throw new BadRequestException('That file is not a JPEG, PNG or WebP image.');
    }

    let output: Buffer;
    let width: number;
    let height: number;

    try {
      const result = await sharp(file.buffer, { failOn: 'error' })
        .rotate()
        .resize({ width: QR_MAX_EDGE, height: QR_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
        // Onto white, not onto nothing: see QR_MAX_EDGE.
        .flatten({ background: '#ffffff' })
        .png({ compressionLevel: 9 })
        .toBuffer({ resolveWithObject: true });

      output = result.data;
      width = result.info.width;
      height = result.info.height;
    } catch (error) {
      this.logger.warn(`Rejected an unreadable payment QR upload: ${(error as Error).message}`);
      throw new BadRequestException('That image could not be read. Try a different file.');
    }

    return this.storage.store(restaurantId, output, width, height, PAYMENT_QR);
  }

  /**
   * Stores the restaurant's logo for the top of its bills.
   *
   * Flattened onto white and written as a lossless PNG, like the payment code
   * and for the same reason: a logo is type or line art, the thermal head
   * renders it in one bit, and a lossy codec leaves grey fringes that dither
   * into mush. Transparency is flattened rather than kept because a transparent
   * logo prints as a black rectangle on some drivers.
   */
  async storeLogo(restaurantId: number, file: Express.Multer.File): Promise<StoredPhoto> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No image was uploaded.');
    }

    if (file.size > this.config.maxBytes) {
      throw new BadRequestException(
        `That image is larger than ${Math.round(this.config.maxBytes / (1024 * 1024))} MB.`,
      );
    }

    if (!ACCEPTED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('The logo must be a JPEG, PNG or WebP image.');
    }

    if (!SIGNATURES.some((signature) => signature.test(file.buffer))) {
      throw new BadRequestException('That file is not a JPEG, PNG or WebP image.');
    }

    let output: Buffer;
    let width: number;
    let height: number;

    try {
      const result = await sharp(file.buffer, { failOn: 'error' })
        .rotate()
        .resize({
          width: LOGO_MAX_EDGE,
          height: LOGO_MAX_EDGE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .flatten({ background: '#ffffff' })
        .png({ compressionLevel: 9 })
        .toBuffer({ resolveWithObject: true });

      output = result.data;
      width = result.info.width;
      height = result.info.height;
    } catch (error) {
      this.logger.warn(`Rejected an unreadable logo upload: ${(error as Error).message}`);
      throw new BadRequestException('That image could not be read. Try a different file.');
    }

    return this.storage.store(restaurantId, output, width, height, LOGO);
  }

  /** Absolute path of the uploads root, resolved once from the configured value. */
  baseDirectory(): string {
    return resolve(this.config.directory);
  }
}
