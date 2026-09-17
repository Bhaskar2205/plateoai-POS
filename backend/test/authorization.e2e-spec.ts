import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RestaurantStatus, UserRole } from 'src/common/enums';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
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
 * Role permissions and restaurant-suspension rules.
 *
 * The suspension specs are regressions for two bugs found while validating
 * Week 1:
 *
 *  1. Setting a restaurant INACTIVE did not stop tokens that had already been
 *     issued, so a suspended tenant kept full API access until every
 *     outstanding token expired (up to JWT_EXPIRES_IN, a day by default) even
 *     though login was already refused.
 *  2. An owner could suspend their own restaurant through PATCH
 *     /restaurants/me, which locked their entire team out permanently - login
 *     and existing tokens are both refused afterwards, and no endpoint exists
 *     for an owner to undo it.
 */
describe('Roles and restaurant status (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    dataSource = ctx.dataSource;
  });

  afterAll(async () => {
    await ctx.close();
  });

  /** Adds a second account to `restaurantId` with `role`, and signs it in. */
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

  const setStatus = (restaurantId: number, status: RestaurantStatus) =>
    dataSource.getRepository(Restaurant).update({ id: restaurantId }, { status });

  describe('KITCHEN_STAFF', () => {
    let owner: RegisteredOwner;
    let headers: Record<string, string>;

    beforeEach(async () => {
      owner = await registerOwner(app);
      headers = auth(await memberWithRole(owner.restaurantId, UserRole.KITCHEN_STAFF));
    });

    it.each([
      ['POST', '/categories', { name: 'Staff Category' }],
      ['POST', '/dishes', { name: 'Staff Dish', price: 100 }],
      ['POST', '/ingredients', { name: 'Staff Ingredient' }],
    ])('cannot %s %s', async (_method, path, body) => {
      await api(app).post(path).set(headers).send(body).expect(403);
    });

    it('cannot update or delete menu records', async () => {
      const ownerHeaders = auth(owner.accessToken);
      const category = await api(app)
        .post('/categories')
        .set(ownerHeaders)
        .send({ name: 'Owner Category' })
        .expect(201);

      await api(app)
        .patch(`/categories/${category.body.id}`)
        .set(headers)
        .send({ name: 'Renamed by staff' })
        .expect(403);
      await api(app).delete(`/categories/${category.body.id}`).set(headers).expect(403);
    });

    it('cannot edit the restaurant profile or list its users', async () => {
      await api(app).patch('/restaurants/me').set(headers).send({ name: 'Nope' }).expect(403);
      await api(app).get('/restaurants/me/users').set(headers).expect(403);
    });

    it('can still read the menu and the dashboard', async () => {
      await api(app).get('/categories').set(headers).expect(200);
      await api(app).get('/dishes').set(headers).expect(200);
      await api(app).get('/ingredients').set(headers).expect(200);
      await api(app).get('/restaurants/me').set(headers).expect(200);
      await api(app).get('/restaurants/me/stats').set(headers).expect(200);
    });
  });

  describe('RESTAURANT_MANAGER', () => {
    let owner: RegisteredOwner;
    let headers: Record<string, string>;

    beforeEach(async () => {
      owner = await registerOwner(app);
      headers = auth(await memberWithRole(owner.restaurantId, UserRole.RESTAURANT_MANAGER));
    });

    it('can manage the menu', async () => {
      const category = await api(app)
        .post('/categories')
        .set(headers)
        .send({ name: 'Manager Category' })
        .expect(201);

      await api(app)
        .post('/dishes')
        .set(headers)
        .send({ categoryId: category.body.id, name: 'Manager Dish', price: 199 })
        .expect(201);

      await api(app)
        .post('/ingredients')
        .set(headers)
        .send({ name: 'Manager Ingredient' })
        .expect(201);
    });

    it('cannot edit the restaurant profile or list its users', async () => {
      await api(app).patch('/restaurants/me').set(headers).send({ name: 'Nope' }).expect(403);
      await api(app).get('/restaurants/me/users').set(headers).expect(403);
    });

    it('writes are still scoped to their own restaurant', async () => {
      const stranger = await registerOwner(app);
      const strangerCategory = await api(app)
        .post('/categories')
        .set(auth(stranger.accessToken))
        .send({ name: 'Stranger Category' })
        .expect(201);

      await api(app)
        .patch(`/categories/${strangerCategory.body.id}`)
        .set(headers)
        .send({ name: 'Hijacked' })
        .expect(404);
    });
  });

  describe('restaurant suspension', () => {
    it('stops honouring existing tokens as soon as the restaurant is deactivated', async () => {
      const owner = await registerOwner(app);

      await api(app).get('/restaurants/me').set(auth(owner.accessToken)).expect(200);

      await setStatus(owner.restaurantId, RestaurantStatus.INACTIVE);

      // Regression: this used to keep returning 200 until the token expired.
      await api(app).get('/restaurants/me').set(auth(owner.accessToken)).expect(403);
      await api(app).get('/dishes').set(auth(owner.accessToken)).expect(403);
      await api(app)
        .post('/categories')
        .set(auth(owner.accessToken))
        .send({ name: 'Should not be created' })
        .expect(403);
    });

    it('refuses login for a suspended restaurant', async () => {
      const owner = await registerOwner(app);
      await setStatus(owner.restaurantId, RestaurantStatus.INACTIVE);

      await api(app)
        .post('/auth/login')
        .send({ email: owner.email, password: owner.password })
        .expect(403);
    });

    it('lets the team back in once the restaurant is reactivated', async () => {
      const owner = await registerOwner(app);

      await setStatus(owner.restaurantId, RestaurantStatus.INACTIVE);
      await api(app).get('/restaurants/me').set(auth(owner.accessToken)).expect(403);

      await setStatus(owner.restaurantId, RestaurantStatus.ACTIVE);
      await api(app).get('/restaurants/me').set(auth(owner.accessToken)).expect(200);
    });

    it('does not suspend other restaurants', async () => {
      const suspended = await registerOwner(app);
      const healthy = await registerOwner(app);

      await setStatus(suspended.restaurantId, RestaurantStatus.INACTIVE);

      await api(app).get('/restaurants/me').set(auth(healthy.accessToken)).expect(200);
    });
  });

  describe('restaurant status is not owner-editable', () => {
    it('refuses an owner trying to suspend their own restaurant', async () => {
      const owner = await registerOwner(app);

      // Regression: this used to return 200 and lock the owner out for good.
      const response = await api(app)
        .patch('/restaurants/me')
        .set(auth(owner.accessToken))
        .send({ status: RestaurantStatus.INACTIVE })
        .expect(403);

      expect(response.body.message).toContain('Plateo support');

      const restaurant = await dataSource
        .getRepository(Restaurant)
        .findOneOrFail({ where: { id: owner.restaurantId } });
      expect(restaurant.status).toBe(RestaurantStatus.ACTIVE);

      // ...and the owner is still able to work.
      await api(app).get('/restaurants/me').set(auth(owner.accessToken)).expect(200);
    });

    it('still allows the other profile fields alongside an unchanged status', async () => {
      const owner = await registerOwner(app);

      const response = await api(app)
        .patch('/restaurants/me')
        .set(auth(owner.accessToken))
        .send({ name: 'Renamed Kitchen', status: RestaurantStatus.ACTIVE })
        .expect(200);

      expect(response.body.name).toBe('Renamed Kitchen');
      expect(response.body.status).toBe(RestaurantStatus.ACTIVE);
    });

    it('allows SUPER_ADMIN to suspend and restore a restaurant', async () => {
      const owner = await registerOwner(app);
      const adminToken = await memberWithRole(owner.restaurantId, UserRole.SUPER_ADMIN);

      await api(app)
        .patch('/restaurants/me')
        .set(auth(adminToken))
        .send({ status: RestaurantStatus.INACTIVE })
        .expect(200);

      // The owner is locked out immediately...
      await api(app).get('/restaurants/me').set(auth(owner.accessToken)).expect(403);

      // ...but support keeps access, so the suspension can be lifted.
      await api(app)
        .patch('/restaurants/me')
        .set(auth(adminToken))
        .send({ status: RestaurantStatus.ACTIVE })
        .expect(200);

      await api(app).get('/restaurants/me').set(auth(owner.accessToken)).expect(200);
    });
  });
});
