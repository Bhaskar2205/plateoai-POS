# Plateo — Multi-Restaurant QR Ordering Platform

Week 1 deliverable: the backend foundation and the restaurant management system.

A restaurant owner can register, sign in, manage their restaurant profile, build a menu
(categories → dishes → ingredients), record nutrition, map ingredients to dishes with
quantities, and see a dashboard — all strictly isolated from every other restaurant.

Customer QR ordering, payments and the kitchen dashboard are **not** in this phase. The
architecture leaves room for them (see [Week 2](#recommended-next-steps-week-2)).

---

## Validation status

| Check | Result |
| ----- | ------ |
| `migration:run` against **real MySQL 8.4.3** | ✅ applied cleanly; 7 tables + 8 foreign keys created |
| `migration:revert` → `migration:run` cycle | ✅ full teardown to 0 tables, clean rebuild, idempotent re-run |
| `migration:generate` drift check vs live schema | ✅ *"No changes in database schema were found"* |
| DECIMAL types for money and nutrition | ✅ verified in `information_schema`; zero FLOAT/DOUBLE columns |
| Unit tests | ✅ 37 passing |
| e2e suite on SQLite | ✅ 216 passing |
| e2e suite on **real MySQL 8.0.46** (schema built by the migrations) | ✅ 216 passing |
| Admin UI in real Chrome (desktop + 390px mobile) | ✅ 31/31 |
| Public menu in real Chrome + live API against `plateo` | ✅ 18/18 |
| Backend build · live-server smoke | ✅ · ✅ 14/14 |
| Frontend typecheck · build | ✅ · ✅ 8 admin routes |

Migrations and the MySQL e2e mode have been run on both **8.0.46** and **8.4.3 LTS**.

---

## Contents

- [Stack](#stack)
- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Running the project](#running-the-project)
- [Testing](#testing)
- [API documentation](#api-documentation)
- [Example API requests](#example-api-requests)
- [Architecture notes](#architecture-notes)
- [Database schema](#database-schema)
- [Known limitations](#known-limitations)
- [Recommended next steps (Week 2)](#recommended-next-steps-week-2)

---

## Stack

| Layer          | Technology                                                                   |
| -------------- | ---------------------------------------------------------------------------- |
| Backend        | NestJS 11 · TypeScript · TypeORM 0.3 · MySQL 8 · JWT · Argon2id               |
| Validation     | class-validator + class-transformer (server) · Zod + React Hook Form (client) |
| API docs       | Swagger / OpenAPI 3 at `/api/docs`                                            |
| Frontend       | Next.js 15 (App Router) · React 19 · Tailwind CSS 4 · TanStack Query · Lucide |
| Tests          | Jest + Supertest                                                             |
| Package manager| npm                                                                          |

> `shadcn/ui` was not already installed in this project, so the admin UI uses a small set of
> purpose-built Tailwind components in `frontend/components/ui/` following the same
> composition conventions. Adding shadcn/ui later requires no changes to page logic.

---

## Repository layout

```
plateoai-qr/
├── backend/                      NestJS API
│   ├── src/
│   │   ├── common/               Guards, decorators, filters, enums, utils
│   │   ├── config/               Typed environment configuration
│   │   ├── database/             DataSource, migrations, seed
│   │   ├── health/               Liveness probe
│   │   ├── modules/
│   │   │   ├── auth/             Register, login, me, logout, switch-restaurant
│   │   │   ├── users/            User entity + lookup
│   │   │   ├── restaurants/      Profile, members, dashboard stats
│   │   │   ├── categories/       Menu sections
│   │   │   ├── dishes/           Dishes + dish↔ingredient mapping
│   │   │   └── ingredients/      Per-restaurant pantry
│   │   ├── bootstrap.ts          Shared pipes/filters/Swagger wiring
│   │   └── main.ts
│   └── test/                     e2e suites + live smoke test
└── frontend/                     Next.js restaurant admin
    ├── app/restaurant/           login, register, (admin) dashboard/profile/menu
    ├── components/               Reusable UI + feature components
    └── lib/                      API client, auth context, query hooks, Zod schemas
```

---

## Prerequisites

1. **Node.js** — 20.x or newer (developed and verified on **v24.20.0**, npm 11.19.0).
   ```powershell
   node --version
   npm --version
   ```
2. **MySQL 8.0** or newer, running locally.
   ```powershell
   mysql --version
   ```
3. **Git**.

---

## Setup

### 1. Create the database

```powershell
mysql -u root -p -e "CREATE DATABASE plateo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

Optionally create a dedicated user instead of using `root`:

```powershell
mysql -u root -p -e "CREATE USER 'plateo'@'localhost' IDENTIFIED BY 'your-password'; GRANT ALL PRIVILEGES ON plateo.* TO 'plateo'@'localhost'; FLUSH PRIVILEGES;"
```

### 2. Configure the backend

```powershell
cd backend
Copy-Item .env.example .env
npm install
```

Edit `backend\.env`:

| Variable               | Purpose                                            | Example                  |
| ---------------------- | -------------------------------------------------- | ------------------------ |
| `NODE_ENV`             | `development` \| `test` \| `production`             | `development`            |
| `PORT`                 | API port                                            | `4000`                   |
| `CORS_ORIGINS`         | Comma-separated browser origins allowed to call it  | `http://localhost:3000`  |
| `PUBLIC_WEB_URL`       | QR app origin encoded into table QR codes (https in production) | `https://app.plateoai.in` |
| `SWAGGER_ENABLED`      | Serve Swagger UI                                    | `true`                   |
| `TRUST_PROXY`          | Proxy hops in front of the API (empty = none; never `true` in production) | `1` |
| `INTERNAL_PROXY_SECRET`| Shared with the frontend; rate-limits SSR public menus per diner IP (≥ 32 chars) | — |
| `DB_HOST` / `DB_PORT`  | MySQL location                                      | `localhost` / `3306`     |
| `DB_USERNAME`          | MySQL user                                          | `root`                   |
| `DB_PASSWORD`          | MySQL password                                      | —                        |
| `DB_DATABASE`          | Database name                                       | `plateo`                 |
| `DB_SYNCHRONIZE`       | Must stay `false` — use migrations                  | `false`                  |
| `DB_SSL` / `DB_SSL_CA` | TLS to managed MySQL; CA as PEM (`\n` escapes allowed). Required in production for a remote host | `true` / PEM |
| `DB_SSL_REJECT_UNAUTHORIZED` | Verify the server certificate; `false` is refused in production | `true` |
| `JWT_SECRET`           | Token signing key (≥ 32 chars in production)        | —                        |
| `JWT_EXPIRES_IN`       | Access token lifetime                               | `1d`                     |
| `LOGIN_THROTTLE_TTL`   | Login rate-limit window, seconds                    | `60`                     |
| `LOGIN_THROTTLE_LIMIT` | Attempts allowed per window, per IP                 | `5`                      |

Generate a strong secret:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

The app **refuses to boot** without `JWT_SECRET`, and refuses to boot in production with a
short secret or `DB_SYNCHRONIZE=true`.

### 3. Run the migrations

```powershell
cd backend
npm run migration:run
```

Verify, roll back, or inspect:

```powershell
npm run migration:show      # which migrations have been applied
npm run migration:revert    # undo the most recent one
```

Optionally seed a demo restaurant with a small sample menu:

```powershell
npm run seed
# Demo login: owner@plateo.test / StrongPassword123!
```

### 4. Configure the frontend

```powershell
cd ..\frontend
Copy-Item .env.example .env.local
npm install
```

`frontend\.env.local` needs only:

```
NEXT_PUBLIC_API_URL=http://localhost:4000
```

---

## Running the project

Two terminals.

**Backend** (http://localhost:4000):

```powershell
cd backend
npm run start:dev
```

**Frontend** (http://localhost:3000):

```powershell
cd frontend
npm run dev
```

Then open <http://localhost:3000/restaurant/register>.

Production builds (Node.js 22 LTS — pinned in both `package.json` files and `.nvmrc`):

```powershell
cd backend ; npm run build ; npm run start:prod
cd frontend ; npm run build ; npm run start
```

In production, run migrations from the compiled build — no `ts-node` or dev dependencies needed:

```powershell
cd backend
npm run migration:show:prod
npm run migration:run:prod
npm run migration:revert:prod   # undo the most recent migration
```

---

## Testing

```powershell
cd backend
npm test          # unit tests (37)
npm run test:e2e  # full API suite against in-memory SQLite (216)
npm run test:all  # both
npm run test:cov  # unit tests with coverage
```

The same e2e suite can run against a **real MySQL 8** server instead, building its schema
from the actual migration rather than `synchronize`:

```powershell
cd backend
$env:TEST_DB_DRIVER="mysql"; $env:DB_DATABASE="plateo_test"; npm run test:e2e
Remove-Item Env:TEST_DB_DRIVER
```

```bash
# bash / Git Bash
TEST_DB_DRIVER=mysql DB_DATABASE=plateo_test npm run test:e2e
```

Create that database first. `DB_HOST`, `DB_PORT`, `DB_USERNAME` and `DB_PASSWORD` are read
the same way the app reads them. **The suite drops and rebuilds the schema for every spec
file, so point it at a throwaway database, never at `plateo`.**

Run it both ways when touching entities or queries: SQLite is fast and portable, MySQL is
what production actually uses. `test/mysql-behaviour.e2e-spec.ts` asserts the answer that is
correct for whichever driver is in use, so the differences between them stay documented
rather than assumed.

```powershell
cd frontend
npm run typecheck
npm run build
```

The e2e suite boots the real Nest application — the same guards, validation pipe,
serializer and exception filter as production — against an in-memory SQLite database, so it
runs on any machine with no MySQL server and no cleanup between files. Entity column types
are deliberately kept driver-portable so this substitution stays faithful.

Two extra checks worth knowing about:

- `test/migration-schema.e2e-spec.ts` builds the MySQL entity metadata offline and compares
  it column-by-column against the hand-written migration, so entity/migration drift fails
  the suite rather than production. It needs no database.
- `npm run smoke` boots a real HTTP server (helmet, CORS, Swagger, the lot) and drives it
  over the wire — useful for checking the server end to end without MySQL installed.

The authoritative drift check needs a live database, and should be run whenever entities
change. It must print *"No changes in database schema were found"*:

```powershell
cd backend
npm run migration:generate -- src/database/migrations/DriftCheck
```

If it writes a file instead, the entities and the migrations have diverged: read the
generated file, fold the real change into a proper migration, and delete it.

---

## API documentation

With the backend running, Swagger UI is at:

**<http://localhost:4000/api/docs>** (raw spec: `/api/docs-json`)

Click **Authorize**, paste the `accessToken` from `POST /auth/login`, and every protected
endpoint becomes callable from the page.

### Endpoints

| Method   | Path                                     | Auth | Notes                                          |
| -------- | ---------------------------------------- | ---- | ---------------------------------------------- |
| `GET`    | `/health`                                | —    | Liveness probe                                 |
| `POST`   | `/auth/register`                         | —    | Owner + restaurant + membership, transactional  |
| `POST`   | `/auth/login`                            | —    | Rate limited (5/min/IP)                        |
| `GET`    | `/auth/me`                               | ✔    | User + active restaurant + all memberships     |
| `POST`   | `/auth/switch-restaurant`                | ✔    | Re-issues a token for another restaurant       |
| `POST`   | `/auth/logout`                           | ✔    | See the note on logout below                   |
| `GET`    | `/restaurants/me`                        | ✔    | Active restaurant profile                      |
| `PATCH`  | `/restaurants/me`                        | ✔    | Owner only                                     |
| `GET`    | `/restaurants/me/users`                  | ✔    | Owner only                                     |
| `GET`    | `/restaurants/me/stats`                  | ✔    | Dashboard counters                             |
| `POST`   | `/categories`                            | ✔    | Menu write roles                               |
| `GET`    | `/categories`                            | ✔    | `?isActive=true`                               |
| `GET`    | `/categories/:id`                        | ✔    |                                                |
| `PATCH`  | `/categories/:id`                        | ✔    | Menu write roles                               |
| `DELETE` | `/categories/:id`                        | ✔    | Dishes are kept, become uncategorised          |
| `POST`   | `/dishes`                                | ✔    | Optional `ingredients` saved in the same transaction |
| `GET`    | `/dishes`                                | ✔    | `?categoryId=&isAvailable=&search=`            |
| `GET`    | `/dishes/:id`                            | ✔    |                                                |
| `PATCH`  | `/dishes/:id`                            | ✔    | Availability, nutrition, prep time; `ingredients` replaces the recipe atomically |
| `DELETE` | `/dishes/:id`                            | ✔    |                                                |
| `POST`   | `/dishes/:id/ingredients`                | ✔    | Adds/updates lines, transactional              |
| `GET`    | `/dishes/:id/ingredients`                | ✔    |                                                |
| `PATCH`  | `/dishes/:id/ingredients`                | ✔    | Replaces the whole recipe, transactional       |
| `DELETE` | `/dishes/:id/ingredients/:ingredientId`  | ✔    |                                                |
| `POST`   | `/ingredients`                           | ✔    | Menu write roles                               |
| `GET`    | `/ingredients`                           | ✔    | `?search=`                                     |
| `GET`    | `/ingredients/:id`                       | ✔    |                                                |
| `PATCH`  | `/ingredients/:id`                       | ✔    | Menu write roles                               |
| `DELETE` | `/ingredients/:id`                       | ✔    | Also unmaps it from every recipe               |
| `GET`    | `/public/restaurants/:slug/menu`         | —    | Public, read-only: active categories + available dishes only; `Cache-Control: no-store` |

### Error format

Every failure uses one envelope:

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Validation failed",
  "details": ["price must not be less than 0"],
  "path": "/dishes",
  "timestamp": "2026-01-01T12:00:00.000Z"
}
```

Status codes: `200` OK · `201` Created · `204` No Content (deletes) · `400` validation ·
`401` missing/invalid token · `403` wrong role or not a member · `404` not found *or owned by
another restaurant* · `409` duplicate · `429` rate limited.

---

## Example API requests

PowerShell (`curl.exe`, not the `curl` alias):

```powershell
# 1. Register an owner and their restaurant
curl.exe -X POST http://localhost:4000/auth/register `
  -H "Content-Type: application/json" `
  -d '{\"name\":\"Restaurant Owner\",\"email\":\"owner@example.com\",\"password\":\"StrongPassword123!\",\"restaurantName\":\"The Green Bowl\",\"address\":\"Jaipur, Rajasthan\"}'

# 2. Log in and keep the token
$token = (curl.exe -s -X POST http://localhost:4000/auth/login `
  -H "Content-Type: application/json" `
  -d '{\"email\":\"owner@example.com\",\"password\":\"StrongPassword123!\"}' | ConvertFrom-Json).accessToken

# 3. Create a category
curl.exe -X POST http://localhost:4000/categories `
  -H "Content-Type: application/json" -H "Authorization: Bearer $token" `
  -d '{\"name\":\"Signature Bowls\",\"sortOrder\":1}'

# 4. Create a dish
curl.exe -X POST http://localhost:4000/dishes `
  -H "Content-Type: application/json" -H "Authorization: Bearer $token" `
  -d '{\"categoryId\":1,\"name\":\"Paneer Tikka Bowl\",\"description\":\"Grilled paneer with fresh vegetables and mint dressing\",\"price\":299,\"proteinGrams\":22,\"calories\":380,\"carbsGrams\":24,\"fatGrams\":19,\"isAvailable\":true}'

# 5. Create ingredients
curl.exe -X POST http://localhost:4000/ingredients `
  -H "Content-Type: application/json" -H "Authorization: Bearer $token" `
  -d '{\"name\":\"Paneer\",\"allergenInfo\":\"Contains milk\"}'

# 6. Map ingredients to the dish
curl.exe -X POST http://localhost:4000/dishes/1/ingredients `
  -H "Content-Type: application/json" -H "Authorization: Bearer $token" `
  -d '{\"ingredients\":[{\"ingredientId\":1,\"quantity\":100,\"unit\":\"g\"},{\"ingredientId\":2,\"quantity\":40,\"unit\":\"g\"}]}'

# 7. Dashboard counters
curl.exe http://localhost:4000/restaurants/me/stats -H "Authorization: Bearer $token"
```

---

## Architecture notes

### Multi-tenancy

Restaurant A can never read, edit or delete Restaurant B's data. Four things enforce this:

1. **The token carries the tenant.** The JWT holds `rid`, the active restaurant id.
2. **Membership is re-checked on every request.** `JwtStrategy` reloads the user and
   confirms a matching `restaurant_users` row still exists — so revoking access takes effect
   immediately, and even a token minted with the correct signing key cannot reach a
   restaurant the user is not a member of.
3. **Controllers read the tenant from the token only**, via `@ActiveRestaurantId()`. That
   decorator throws rather than returning `undefined`, so a route accidentally left
   unauthenticated fails loudly instead of quietly querying across tenants.
4. **Services fold `restaurantId` into the WHERE clause.** The tenant filter is part of the
   query, not a separate check a new endpoint could forget.

`restaurantId` is never accepted from a request body: the validation pipe runs with
`forbidNonWhitelisted`, so smuggling one in is a hard `400`. Records owned by another
restaurant return `404`, never `403`, so the API does not confirm that someone else's id
exists.

A user in several restaurants picks one at login (`restaurantId`, validated against their
memberships) and can move between them with `POST /auth/switch-restaurant`.

### Restaurant suspension

`restaurants.status` is platform state, not a profile field:

- **Only SUPER_ADMIN can change it.** An owner who could suspend their own restaurant would
  lock their entire team out permanently, because a suspended tenant refuses both login and
  existing tokens and no owner-facing endpoint can undo it. Owners get `403` if they try.
- **Suspension takes effect on the next request**, not when tokens expire. `JwtStrategy`
  re-reads the restaurant alongside the membership, so a suspended tenant stops working
  immediately rather than after up to `JWT_EXPIRES_IN`.
- **SUPER_ADMIN is exempt from both checks**, so support can still reach a suspended
  restaurant to lift the suspension.

Regression tests live in `test/authorization.e2e-spec.ts`.

### Roles

`SUPER_ADMIN` · `RESTAURANT_OWNER` · `RESTAURANT_MANAGER` · `KITCHEN_STAFF`.

Owners and managers can write menu data; owners alone can edit the restaurant profile and
list members; kitchen staff have read access. Enforced by the global `RolesGuard`.

### Security

- Argon2id password hashing (OWASP baseline parameters); hashes are `@Exclude()`d from every
  response and asserted absent in both the tests and the OpenAPI schema.
- Login and registration rate limited to `LOGIN_THROTTLE_LIMIT` per `LOGIN_THROTTLE_TTL` per IP (default
  5/min); every other route to 120/min per IP. Both live in `src/common/throttling.ts` as a
  single throttler with per-route overrides — a second *named* throttler would be applied to
  every route by `@nestjs/throttler`, which is exactly the bug browser testing found.
- Failed logins take the same time whether the email exists or not.
- Helmet security headers, CORS restricted to `CORS_ORIGINS`.
- `.env` is git-ignored; `.env.example` holds placeholders only.

### Logout

Plateo issues **stateless JWT access tokens** with no server-side session table, so there is
nothing for `POST /auth/logout` to destroy: a token stays cryptographically valid until it
expires (`JWT_EXPIRES_IN`, 1 day by default). The endpoint acknowledges the logout, and the
client is responsible for discarding the token — the admin UI removes it from `localStorage`
and clears the TanStack Query cache, so nothing cached survives the sign-out.

The partial mitigation already in place: because membership is re-checked on every request,
removing a user from a restaurant revokes their access immediately even though their token
is still technically valid. True revocation needs either a denylist of token ids checked per
request, or short-lived access tokens paired with revocable refresh tokens — both are on the
Week 2 list.

### Nutrition data

Nutrition on a dish is **entered by the restaurant and stored exactly as typed**. Plateo does
not generate, calculate, infer or verify these values, and they are **not medical or
nutritional advice**.

Units are fixed and explicit: protein, carbohydrates and fat in **grams (g)**; energy in
**kilocalories (kcal)**. All four are optional and stored as `DECIMAL(8,2)`.

A future version can calculate nutrition from `dish_ingredients` quantities joined against a
verified nutrition database. When that lands, these columns should gain a `source` marker
distinguishing restaurant-declared values from calculated ones — the recipe quantities needed
for that calculation are already being captured.

### Money

`dishes.price` is `DECIMAL(10,2)` and `dish_ingredients.quantity` is `DECIMAL(10,3)`. No
float or double column exists anywhere in the schema, and a test asserts it stays that way.
Values are converted to JS numbers at the API edge for JSON; any future arithmetic on money
(order totals, tax) should be done in the database or on integer paise.

---

## Database schema

Seven tables, InnoDB, `utf8mb4_unicode_ci`.

| Table              | Purpose                          | Key constraints                                                        |
| ------------------ | -------------------------------- | ---------------------------------------------------------------------- |
| `users`            | Platform accounts                | `UQ_users_email`                                                        |
| `restaurants`      | Tenants                          | `UQ_restaurants_slug`                                                   |
| `restaurant_users` | Membership join table            | `UQ_restaurant_users_user_restaurant (user_id, restaurant_id)`; FKs cascade |
| `categories`       | Menu sections                    | `UQ_categories_restaurant_name`; `IDX_categories_restaurant_sort`       |
| `ingredients`      | Per-restaurant pantry            | `UQ_ingredients_restaurant_name`                                        |
| `dishes`           | Menu items + nutrition           | 3 restaurant-leading indexes; category FK is `ON DELETE SET NULL`       |
| `dish_ingredients` | Recipe lines                     | `UQ_dish_ingredients_dish_ingredient (dish_id, ingredient_id)`          |

Every tenant-owned table carries `restaurant_id`, indexes it first, and cascades on
restaurant delete. Deleting a category keeps its dishes (they become uncategorised);
deleting a dish or an ingredient removes the affected recipe lines.

Role and status columns are `VARCHAR` with application-level validation rather than MySQL
`ENUM`, so adding a role is a data change rather than a DDL migration — and the entities stay
portable to the SQLite datasource the test suite uses.

---

## Known limitations

1. **Logout cannot revoke a token**, as described above.
2. **`users.role` is global, not per-restaurant.** A user who belongs to two restaurants
   carries the same role in both — there is no `restaurant_users.role` column. This is
   faithful to the Week 1 schema and harmless while almost every account owns exactly one
   restaurant, but it must be fixed before team invitations ship, or inviting someone as
   KITCHEN_STAFF would silently grant them whatever role they hold elsewhere. Moving the
   role onto the membership row is item 8 of the Week 2 plan.
3. **The admin stores its token in `localStorage`**, which is readable by any script on the
   origin. Acceptable for an internal admin tool with short-lived tokens; an httpOnly cookie
   with CSRF protection is the Week 2 improvement.
4. **Rate limiting is in-process.** Running more than one API instance gives each its own
   counters; move to the Redis throttler storage before scaling out.
5. **No refresh tokens, password reset, email verification or team invitations.** There is
   currently no endpoint to add a second user to a restaurant — the membership table and the
   role model support it, but the API surface is Week 2 work.
6. **Reactivating a suspended restaurant has no endpoint.** `status` is SUPER_ADMIN-only and
   a suspended tenant refuses both login and existing tokens, so in practice suspension is
   currently applied straight to the database. A platform-admin API is Week 2 work.
7. **Image URLs only, no upload pipeline.** Dishes and logos take an external `https://` URL.
8. **List endpoints are unpaginated.** Fine at Week 1 menu sizes; add cursor pagination
   before a restaurant has thousands of dishes.
9. **Frontend has no automated tests** — it is covered by typecheck and a production build
   only. Playwright or Testing Library is the natural next step.
10. **Nutrition is per-dish and self-reported**, not derived from ingredients.
11. **Build note for this machine:** Next.js could not load its native SWC binary
    (`@next/swc-win32-x64-msvc` was blocked by a Windows Application Control policy) and fell
    back to the WASM compiler. Builds succeed but are slower; allow-listing the binary
    restores full speed.

---

## Recommended next steps (Week 2)

The full technical plan — entities, migrations, APIs, frontend routes, security requirements
and tests for each feature — is in **[docs/WEEK2-PLAN.md](docs/WEEK2-PLAN.md)**.

Summary of what it covers:

1. **Restaurant tables** — `restaurant_tables`, the anchor for QR codes and orders.
2. **Secure QR tokens** — 256-bit random, rotatable, treated as a printed bearer credential.
3. **Public menu endpoint** — the only unauthenticated read surface, via a filtered DTO.
4. **Customer menu route** — a separate `app/(customer)/` group, server-rendered.
5. **Orders and order_items** — with an enforced status machine.
6. **Price and dish-name snapshotting** — orders record what was actually bought.
7. **Refresh tokens** — rotation with reuse detection; makes logout real.
8. **Customer/restaurant auth separation** — distinct credentials, guards and headers.
9. **Ingredient nutrition calculation** — opt-in, with completeness flags and no false certainty.

Build order: 1 → 2 → 3 → 4 gives a demoable read-only scannable menu; 8 → 5 → 6 adds
ordering; 7 and 9 are independent.
