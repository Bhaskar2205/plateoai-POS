import { InternalServerErrorException } from '@nestjs/common';
import type { AppConfig } from 'src/config/configuration';
import { CloudflareImagesStorage } from './cloudflare-images.storage';

/**
 * The Cloudflare image store, checked without a Cloudflare account.
 *
 * Nothing here proves Plateo can talk to Cloudflare - no credentials exist in
 * this project and no request has ever been made. What it does prove is the part
 * that can be reasoned about: which URLs are treated as ours, what happens when
 * the API says no, and that a missing credential means the store is off rather
 * than half on.
 */
const config = (over: Partial<AppConfig['uploads']['cloudflare']> = {}): AppConfig['uploads']['cloudflare'] => ({
  accountId: 'acc-1',
  token: 'token-1',
  accountHash: 'HASH',
  thumbnailVariant: 'thumb',
  fullVariant: 'full',
  ...over,
});

describe('isConfigured', () => {
  it('needs all three credentials', () => {
    expect(CloudflareImagesStorage.isConfigured(config())).toBe(true);
  });

  it.each([['accountId'], ['token'], ['accountHash']] as const)(
    'is off when %s is missing',
    (missing) => {
      // Partial credentials are the dangerous state: a token without an account
      // hash uploads a photo it cannot then build a URL for, so the restaurant is
      // billed for an image nobody can see.
      expect(CloudflareImagesStorage.isConfigured(config({ [missing]: '' }))).toBe(false);
    },
  );
});

describe('delivery URLs', () => {
  const storage = new CloudflareImagesStorage(config());

  it('derives the grid-sized URL from the full-sized one', () => {
    expect(storage.thumbnailFor('https://imagedelivery.net/HASH/img-7/full')).toBe(
      'https://imagedelivery.net/HASH/img-7/thumb',
    );
  });

  it('leaves a photo from the local volume alone', () => {
    // Photos uploaded before Cloudflare was configured keep working untouched -
    // this is what makes the switch need no migration.
    const onDisk = 'https://api.plateoai.in/uploads/dishes/3/abc.webp';

    expect(storage.thumbnailFor(onDisk)).toBe(onDisk);
  });

  it('does not claim another Cloudflare account as its own', () => {
    // Matched against this account's hash specifically. Otherwise a URL naming
    // somebody else's account could aim a delete at an id we do not own.
    const foreign = 'https://imagedelivery.net/SOMEONE_ELSE/img-7/full';

    expect(storage.thumbnailFor(foreign)).toBe(foreign);
  });
});

describe('talking to Cloudflare', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const respond = (status: number, body: unknown) => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as unknown as typeof fetch;
  };

  it('returns both URLs for a stored photo', async () => {
    respond(200, { success: true, result: { id: 'img-7' } });

    const stored = await new CloudflareImagesStorage(config()).store(
      3,
      Buffer.from('not-really-an-image'),
      1600,
      1067,
    );

    expect(stored).toEqual({
      url: 'https://imagedelivery.net/HASH/img-7/full',
      thumbnailUrl: 'https://imagedelivery.net/HASH/img-7/thumb',
      width: 1600,
      height: 1067,
      bytes: 19,
    });
  });

  it('fails the upload when Cloudflare rejects it', async () => {
    respond(401, { success: false, errors: [{ code: 10000, message: 'Authentication error' }] });

    await expect(
      new CloudflareImagesStorage(config()).store(3, Buffer.from('x'), 10, 10),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('tells the uploader nothing about why Cloudflare refused', async () => {
    respond(403, { success: false, errors: [{ code: 10000, message: 'token lacks images:edit on account acc-1' }] });

    // Cloudflare's errors name the account and the token's shortcomings. Useful
    // in a log, not in a response to whoever is uploading a photo.
    await expect(
      new CloudflareImagesStorage(config()).store(3, Buffer.from('x'), 10, 10),
    ).rejects.toThrow(/could not be saved to image storage/i);
  });

  it('fails rather than returning a URL when the response carries no id', async () => {
    respond(200, { success: true, result: {} });

    await expect(
      new CloudflareImagesStorage(config()).store(3, Buffer.from('x'), 10, 10),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('never throws when deleting, even if Cloudflare is down', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch;

    // Replacing a photo must not fail because the *old* one could not be removed,
    // or a bad photo becomes impossible to correct.
    await expect(
      new CloudflareImagesStorage(config()).remove('https://imagedelivery.net/HASH/img-7/full'),
    ).resolves.toBeUndefined();
  });

  it('does not call Cloudflare to delete a photo that is not theirs', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await new CloudflareImagesStorage(config()).remove(
      'https://api.plateoai.in/uploads/dishes/3/abc.webp',
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
