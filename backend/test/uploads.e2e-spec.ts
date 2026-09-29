import { INestApplication } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { DataSource } from 'typeorm';
import { UserRole } from 'src/common/enums';
import { RestaurantUser } from 'src/modules/restaurants/entities/restaurant-user.entity';
import { User } from 'src/modules/users/entities/user.entity';
import {
  api,
  auth,
  createTestApp,
  registerOwner,
  type RegisteredOwner,
  type TestContext,
} from './test-app';

/**
 * Dish photo uploads.
 *
 * The rules worth protecting: only staff who may edit the menu can upload, only
 * real images are stored, what comes back out is ours rather than what was sent
 * in, and one restaurant's photos are filed apart from another's.
 */
describe('Dish photo uploads (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let dataSource: DataSource;

  let owner: RegisteredOwner;
  let headers: Record<string, string>;
  let uploadsDir: string;

  const endpoint = '/restaurants/me/uploads/dish-photo';

  /** A real JPEG of the given size, so the bytes are genuinely an image. */
  const jpeg = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, background: '#c9822b' } }).jpeg().toBuffer();

  const png = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, background: '#2f7d52' } }).png().toBuffer();

  async function memberWithRole(restaurantId: number, role: UserRole): Promise<string> {
    const member = await registerOwner(app);

    await dataSource.getRepository(User).update({ id: member.userId }, { role });
    await dataSource.getRepository(RestaurantUser).save({ userId: member.userId, restaurantId });

    const login = await api(app)
      .post('/auth/login')
      .send({ email: member.email, password: member.password, restaurantId })
      .expect(200);

    return login.body.accessToken;
  }

  beforeAll(async () => {
    // A throwaway directory, so the suite never writes into the repo.
    uploadsDir = mkdtempSync(join(tmpdir(), 'plateo-uploads-'));
    process.env.UPLOADS_DIR = uploadsDir;
    process.env.PUBLIC_API_URL = 'http://localhost:4000';

    ctx = await createTestApp();
    app = ctx.app;
    dataSource = ctx.dataSource;

    owner = await registerOwner(app, { restaurantName: 'Photo Kitchen' });
    headers = auth(owner.accessToken);
  });

  afterAll(async () => {
    await ctx.close();
    rmSync(uploadsDir, { recursive: true, force: true });
    delete process.env.UPLOADS_DIR;
    delete process.env.PUBLIC_API_URL;
  });

  it('stores a photo and returns a URL to save on the dish', async () => {
    const response = await api(app)
      .post(endpoint)
      .set(headers)
      .attach('file', await jpeg(800, 600), { filename: 'lunch.jpg', contentType: 'image/jpeg' })
      .expect(201);

    expect(response.body.url).toMatch(
      new RegExp(`^http://localhost:4000/uploads/dishes/${owner.restaurantId}/[0-9a-f]{32}\\.webp$`),
    );
    expect(response.body.width).toBe(800);
    expect(response.body.height).toBe(600);
    expect(response.body.bytes).toBeGreaterThan(0);
  });

  it('serves the stored photo back, and lets another origin display it', async () => {
    const { body } = await api(app)
      .post(endpoint)
      .set(headers)
      .attach('file', await jpeg(400, 400), { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(201);

    const path = new URL(body.url).pathname;
    const served = await api(app).get(path).expect(200);

    expect(served.headers['content-type']).toContain('image/webp');
    // helmet defaults to same-origin, which would stop the web app painting it.
    expect(served.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(served.headers['cache-control']).toContain('immutable');
    expect(Buffer.isBuffer(served.body) ? served.body.subarray(8, 12).toString('ascii') : '').toBe('WEBP');
  });

  it('does not need a token to view a photo, since diners see them', async () => {
    const { body } = await api(app)
      .post(endpoint)
      .set(headers)
      .attach('file', await jpeg(300, 300), { filename: 'b.jpg', contentType: 'image/jpeg' })
      .expect(201);

    await api(app).get(new URL(body.url).pathname).expect(200);
  });

  it('re-encodes to WebP whatever was sent, and strips EXIF', async () => {
    // A JPEG carrying EXIF, including a GPS tag - a phone photo of the kitchen.
    const withExif = await sharp({ create: { width: 500, height: 400, channels: 3, background: '#fff' } })
      .withExif({ IFD0: { Copyright: 'Test', Make: 'TestPhone', Artist: 'Kitchen camera' } })
      .jpeg()
      .toBuffer();

    const { body } = await api(app)
      .post(endpoint)
      .set(headers)
      .attach('file', withExif, { filename: 'gps.jpg', contentType: 'image/jpeg' })
      .expect(201);

    const served = await api(app).get(new URL(body.url).pathname).expect(200);
    const metadata = await sharp(served.body).metadata();

    expect(metadata.format).toBe('webp');
    expect(metadata.exif).toBeUndefined();
  });

  it('shrinks a huge photo instead of storing it whole', async () => {
    const response = await api(app)
      .post(endpoint)
      .set(headers)
      .attach('file', await png(3000, 2000), { filename: 'huge.png', contentType: 'image/png' })
      .expect(201);

    expect(response.body.width).toBe(1600);
    expect(response.body.height).toBe(1067);
  });

  it('refuses a file that is not an image, whatever it claims to be', async () => {
    const script = Buffer.from('<?php system($_GET["c"]); ?>', 'utf8');

    // Declared as an image, and named like one.
    const response = await api(app)
      .post(endpoint)
      .set(headers)
      .attach('file', script, { filename: 'shell.jpg', contentType: 'image/jpeg' })
      .expect(400);

    expect(response.body.message).toMatch(/not a JPEG, PNG or WebP/i);
  });

  it('refuses a type we do not accept', async () => {
    const response = await api(app)
      .post(endpoint)
      .set(headers)
      .attach('file', Buffer.from('GIF89a'), { filename: 'anim.gif', contentType: 'image/gif' })
      .expect(400);

    expect(response.body.message).toMatch(/JPEG, PNG or WebP/i);
  });

  it('refuses a request with no file at all', async () => {
    await api(app).post(endpoint).set(headers).expect(400);
  });

  it('files each restaurant photos under its own id', async () => {
    const rival = await registerOwner(app, { restaurantName: 'Rival Photo House' });

    const mine = await api(app)
      .post(endpoint)
      .set(headers)
      .attach('file', await jpeg(200, 200), { filename: 'mine.jpg', contentType: 'image/jpeg' })
      .expect(201);

    const theirs = await api(app)
      .post(endpoint)
      .set(auth(rival.accessToken))
      .attach('file', await jpeg(200, 200), { filename: 'theirs.jpg', contentType: 'image/jpeg' })
      .expect(201);

    expect(mine.body.url).toContain(`/dishes/${owner.restaurantId}/`);
    expect(theirs.body.url).toContain(`/dishes/${rival.restaurantId}/`);
    expect(mine.body.url).not.toBe(theirs.body.url);
  });

  it('lets a manager upload, but not kitchen staff, and never an anonymous caller', async () => {
    const manager = auth(await memberWithRole(owner.restaurantId, UserRole.RESTAURANT_MANAGER));
    const kitchen = auth(await memberWithRole(owner.restaurantId, UserRole.KITCHEN_STAFF));
    const photo = await jpeg(200, 200);

    await api(app)
      .post(endpoint)
      .set(manager)
      .attach('file', photo, { filename: 'm.jpg', contentType: 'image/jpeg' })
      .expect(201);

    await api(app)
      .post(endpoint)
      .set(kitchen)
      .attach('file', photo, { filename: 'k.jpg', contentType: 'image/jpeg' })
      .expect(403);

    await api(app)
      .post(endpoint)
      .attach('file', photo, { filename: 'anon.jpg', contentType: 'image/jpeg' })
      .expect(401);
  });

  it('saves onto a dish and shows up on the public menu', async () => {
    const { body: photo } = await api(app)
      .post(endpoint)
      .set(headers)
      .attach('file', await jpeg(600, 400), { filename: 'dish.jpg', contentType: 'image/jpeg' })
      .expect(201);

    const dish = (
      await api(app)
        .post('/dishes')
        .set(headers)
        .send({ name: 'Photographed Pulao', price: 240, imageUrl: photo.url })
        .expect(201)
    ).body;

    expect(dish.imageUrl).toBe(photo.url);

    const slug = (await api(app).get('/restaurants/me').set(headers).expect(200)).body.slug;
    const menu = await api(app).get(`/public/restaurants/${slug}/menu`).expect(200);
    const listed = menu.body.uncategorisedDishes.find(
      (entry: { name: string }) => entry.name === 'Photographed Pulao',
    );

    expect(listed.imageUrl).toBe(photo.url);
  });
});
