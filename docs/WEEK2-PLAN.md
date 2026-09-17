# Plateo Week 2 — Technical Implementation Plan

**Status:** plan only. Nothing in this document is implemented yet.

Week 1 delivered the restaurant-facing foundation: multi-tenant auth, restaurant profiles,
and the menu (categories → dishes → ingredients), validated against MySQL 8. Week 2 turns
that into an ordering system: a customer scans a QR code at a table, reads the menu, and
places an order.

## Ordering principles

Three decisions shape everything below. Settle them before writing code.

1. **Customers are not users.** A diner never gets a row in `users` and never holds a
   restaurant-scoped token. Customer sessions are a separate, weaker credential
   (§8) so that no customer request can ever satisfy a restaurant guard.
2. **Orders snapshot, they never join for display.** An order records the dish name and
   price *as they were at order time* (§6). Menus change; receipts must not.
3. **The tenant still comes from the server.** The existing rule — `restaurantId` derives
   from the token or from a signed QR token, never from a request body — extends unchanged
   to every new endpoint.

### Build order

`1 → 2 → 3 → 4` gives a scannable read-only menu (demoable on its own).
`8 → 5 → 6` adds ordering. `7` and `9` are independent and can run in parallel.

---

## 1. Restaurant tables

Physical tables in a restaurant. The anchor for every QR code and every order.

**Entity** — `src/modules/tables/entities/restaurant-table.ts`, table `restaurant_tables`
(not `tables`; `TABLE` is a reserved word in MySQL and an unquoted `tables` will bite in
raw SQL).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `INT UNSIGNED` PK | |
| `restaurant_id` | `INT UNSIGNED` | FK → `restaurants`, `ON DELETE CASCADE` |
| `label` | `VARCHAR(40)` | "12", "Patio 3" — what staff call it |
| `seats` | `INT` NULL | capacity, informational |
| `qr_token` | `CHAR(43)` | see §2; unique |
| `qr_issued_at` | `DATETIME(6)` | supports rotation + audit |
| `is_active` | `TINYINT(1)` | retired tables stop accepting orders |
| `created_at` / `updated_at` | `DATETIME(6)` | |

Indexes: `UQ_restaurant_tables_restaurant_label (restaurant_id, label)`,
`UQ_restaurant_tables_qr_token (qr_token)`, `IDX_restaurant_tables_restaurant (restaurant_id)`.

**Migration** — `AddRestaurantTables`. Follow the Week 1 conventions exactly: InnoDB,
`utf8mb4_unicode_ci`, explicit `foreignKeyConstraintName` on the `@JoinColumn` (Week 1
validation showed that omitting it makes every future `migration:generate` churn FK names).

**APIs** — all restaurant-scoped, `MENU_WRITE_ROLES`:

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/tables` | create |
| `GET` | `/tables` | list |
| `PATCH` | `/tables/:id` | rename, seats, activate/deactivate |
| `DELETE` | `/tables/:id` | blocked if orders reference it — deactivate instead |
| `POST` | `/tables/:id/rotate-qr` | issue a new token, invalidating the printed code |
| `GET` | `/tables/:id/qr.png` | rendered QR image for printing |

**Frontend** — `/restaurant/tables`: table list, add/edit dialog, per-table QR preview, and
a "print all" sheet. Generate the QR client-side (`qrcode` npm) from the URL the API
returns, so no image bytes need storing.

**Security** — tenant-scoped like every Week 1 resource; cross-restaurant access returns
404. `qr_token` is write-only from the client's perspective: it is never accepted as input,
only generated.

**Tests** — CRUD; cross-restaurant 404; duplicate label in same restaurant → 409; same label
in a different restaurant → 201; rotating a QR changes the token and invalidates the old
one; delete blocked when orders exist.

---

## 2. Secure QR tokens

A QR code encodes `https://app.plateo.example/t/<qr_token>`. Anyone holding that URL can
read the menu and start an order, so the token is a **bearer credential printed on a sticker**
and must be treated as one.

**Design**

- 32 random bytes from `crypto.randomBytes`, base64url — 43 chars, ~256 bits. Not a UUID,
  not sequential, not derived from the table id.
- Stored as a **hash** (SHA-256) if you want defence against a database leak reprinting
  every sticker; stored in plaintext if operational simplicity wins. *Recommendation: store
  plaintext for Week 2* — the token grants only menu-read plus order-create for one table,
  it must be reversible to reprint a sticker, and hashing blocks that. Revisit if QR ever
  authorises payment.
- **No expiry** (stickers are physical) but **rotatable** on demand, so a leaked or
  photographed code can be killed without reprinting the whole restaurant.

**Lookup** — `GET /public/menu/:qrToken` resolves token → table → restaurant in one indexed
query. Constant-time comparison is unnecessary given 256 bits of entropy and an indexed
equality lookup.

**Security requirements**

- Rate limit public QR endpoints per IP (say 60/min) — a separate throttler from `auth`.
- Reject tokens for `is_active = false` tables and `INACTIVE` restaurants with the same 404,
  so probing cannot distinguish "wrong token" from "disabled table".
- Never log the full token; log a prefix.
- The QR URL must be HTTPS in production, and the token must sit in the **path**, not a
  query string, to keep it out of Referer headers.

**Tests** — token uniqueness and entropy (no duplicates across 10k generations); rotation
invalidates the previous token; unknown/inactive/suspended all return an identical 404;
rate limit returns 429.

---

## 3. Public restaurant menu endpoint

The only unauthenticated read surface. It must expose exactly what a diner needs and nothing
else.

**API** — `@Public()`, no bearer token:

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/public/menu/:qrToken` | menu + restaurant + table context for a scanned code |
| `GET` | `/public/menu/by-slug/:slug` | same menu, no table — for a website link or takeaway |

**Response shape** — a dedicated `PublicMenuDto`, never the entities:

```jsonc
{
  "restaurant": { "name": "...", "slug": "...", "logoUrl": "...", "address": "..." },
  "table": { "id": 12, "label": "12" },        // absent for the by-slug variant
  "categories": [
    { "id": 1, "name": "Signature Bowls", "sortOrder": 1,
      "dishes": [
        { "id": 7, "name": "Paneer Tikka Bowl", "description": "...", "price": 299,
          "imageUrl": "...", "dietType": "VEG",
          "nutrition": { "proteinGrams": 22, "calories": 380, "carbsGrams": 24, "fatGrams": 19,
                         "source": "RESTAURANT_DECLARED" },
          "allergens": ["Contains milk"] } ] } ]
}
```

**Filtering — the whole point of a separate DTO.** Return only `isActive` categories and
`isAvailable` dishes, and never expose `restaurantId`, `createdAt`, internal ids of
ingredients, cost data, or the member list. Empty categories are omitted.

Allergens are the union of `allergenInfo` across the dish's ingredients — the first customer
benefit of Week 1's mapping table. Surface it as restaurant-declared text, never as a safety
guarantee.

**Security** — public routes bypass `JwtAuthGuard` via `@Public()`; that is exactly why they
need their own review. Checklist: no entity serialised directly; suspended restaurant → 404;
IP rate limit; response cacheable (`Cache-Control: public, max-age=60`) since it holds no
per-customer data.

**Tests** — inactive categories and unavailable dishes absent; no `restaurantId` anywhere in
the payload (assert on the serialised JSON string); suspended restaurant → 404; two
restaurants' tokens return disjoint menus; allergen aggregation correct.

---

## 4. Customer menu route

**Frontend** — a new `app/(customer)/` route group, deliberately separate from
`app/restaurant/` so no admin provider, auth context, or nav can leak in:

| Route | Purpose |
| --- | --- |
| `/t/[qrToken]` | scan lands here: menu + cart |
| `/t/[qrToken]/cart` | review and place order |
| `/t/[qrToken]/order/[orderId]` | live status after ordering |
| `/m/[slug]` | browse-only menu, no table, no ordering |

**Rendering** — server-render the menu (it is public, cacheable, and SEO/TTFB matter on a
phone on restaurant wifi). The cart is client state only.

**Cart** — `localStorage`, keyed by `qrToken`, holding `{dishId, quantity, note}` plus a
`menuVersion`. Never trust cart prices: the client sends dish ids and quantities, and the
**server** prices the order (§6). Show prices from the fetched menu for display only.

**UX requirements** — mobile-first (this is a phone-only surface); skeletons while the menu
loads; a clear "this restaurant isn't available" state for a 404 token; unavailable dishes
hidden rather than greyed out; allergen text shown with an explicit "as declared by the
restaurant, not verified by Plateo" disclaimer.

**Tests** — component tests for cart maths; an e2e happy path (scan → add → order); a 404
token renders the friendly state rather than crashing.

---

## 5. Orders and order_items

**Entities**

`orders`:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `INT UNSIGNED` PK | |
| `restaurant_id` | `INT UNSIGNED` | FK, `ON DELETE RESTRICT` — never lose financial history |
| `table_id` | `INT UNSIGNED` NULL | FK, `ON DELETE SET NULL` — table may be retired later |
| `order_number` | `VARCHAR(20)` | per-restaurant human reference, e.g. `A-0042` |
| `status` | `VARCHAR(24)` | see machine below |
| `customer_session_id` | `CHAR(43)` NULL | §8 |
| `customer_name` / `customer_phone` | `VARCHAR` NULL | optional |
| `subtotal_amount`, `tax_amount`, `total_amount` | `DECIMAL(10,2)` | server-computed |
| `currency` | `CHAR(3)` | `INR` |
| `note` | `TEXT` NULL | |
| `placed_at`, `confirmed_at`, `ready_at`, `completed_at`, `cancelled_at` | `DATETIME(6)` NULL | timeline |
| `created_at` / `updated_at` | `DATETIME(6)` | |

`order_items`:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `INT UNSIGNED` PK | |
| `order_id` | `INT UNSIGNED` | FK, `ON DELETE CASCADE` |
| `dish_id` | `INT UNSIGNED` NULL | FK, `ON DELETE SET NULL` — reference only |
| `dish_name` | `VARCHAR(150)` | **snapshot**, see §6 |
| `unit_price` | `DECIMAL(10,2)` | **snapshot** |
| `quantity` | `INT UNSIGNED` | ≥ 1 |
| `line_total` | `DECIMAL(10,2)` | `unit_price × quantity`, stored |
| `note` | `VARCHAR(255)` NULL | "no onions" |
| `created_at` | `DATETIME(6)` | |

Indexes: `UQ_orders_restaurant_number (restaurant_id, order_number)`,
`IDX_orders_restaurant_status (restaurant_id, status)`,
`IDX_orders_restaurant_placed (restaurant_id, placed_at)`, `IDX_order_items_order (order_id)`.

**Status machine** — `PENDING → CONFIRMED → PREPARING → READY → SERVED → COMPLETED`, with
`CANCELLED` reachable from any state before `SERVED`. Enforce transitions in a single
`assertTransition()` helper; never let a client PATCH an arbitrary status.

**Migration** — `AddOrders`. Note the deliberate FK asymmetry: menu tables cascade on
restaurant delete, orders **restrict**. Deleting a restaurant with orders should fail loudly
rather than silently destroy financial records.

**APIs**

Customer (QR-session scoped, §8):

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/public/menu/:qrToken/orders` | place an order |
| `GET` | `/public/orders/:orderId` | status; requires the matching session |

Restaurant (existing JWT, restaurant-scoped):

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/orders` | filter by status, table, date |
| `GET` | `/orders/:id` | detail with items |
| `PATCH` | `/orders/:id/status` | advance the state machine |

**Frontend** — `/restaurant/orders` (live list, status filters, detail drawer) and the
customer status page. A kitchen display is explicitly *out of scope* for Week 2.

**Security**

- Order creation derives `restaurant_id` and `table_id` **from the QR token only**.
- Every dish id in the payload is re-validated as belonging to that restaurant *and*
  `isAvailable` — the same rule as dish-ingredient mapping in Week 1.
- Quantity bounds (1–99) and a maximum item count per order, to cap abuse.
- `order_number` generated server-side.
- Customers may read only their own order (session match); restaurants only their own
  orders (tenant match).
- Rate limit order creation per QR token.

**Tests** — creation prices server-side and ignores any client-sent price; unavailable dish
→ 400; another restaurant's dish id → 400; totals arithmetic; each legal transition and
every illegal one → 409; a customer cannot read another customer's order; a restaurant
cannot read another restaurant's orders; concurrent orders get unique `order_number`s.

---

## 6. Order price and dish-name snapshotting

**The rule:** an order item stores what the customer actually bought. Renaming a dish or
changing its price must never alter an existing order.

**Implementation**

- `order_items.dish_name` and `order_items.unit_price` are copied from the dish **inside the
  order-creation transaction**, read with a `SELECT ... FOR UPDATE`-style read in the same
  transaction so the price cannot change mid-write.
- `dish_id` stays as a nullable soft reference for analytics only — never joined to display
  a historical order. Add a lint-level convention: any query building an order *response*
  must read from `order_items`, never from `dishes`.
- `line_total`, `subtotal_amount` and `total_amount` are computed and stored, not derived at
  read time.
- Money arithmetic is done in **integer paise** in the service layer, then written to
  `DECIMAL(10,2)` — never by summing the JS floats that `NumericTransformer` hands back.
  This is the one place Week 1's "no float arithmetic" note becomes load-bearing.
- Tax: store `tax_amount` per order even if it is `0.00` in Week 2, so adding GST later is
  not a migration of historical rows.

**Tests** — the canonical regression: place an order, change the dish price and name, re-read
the order, assert the original name and price; deleting the dish leaves the order readable
with `dish_id = NULL`; totals equal the sum of line totals; a 33.33 × 3 style case proves no
float drift.

---

## 7. Refresh tokens

Fixes Week 1 limitation 1: access tokens cannot currently be revoked.

**Entity** — `refresh_tokens`: `id`, `user_id` (FK cascade), `token_hash CHAR(64)`
(SHA-256 — unlike QR tokens these are never reprinted, so hash them), `expires_at`,
`revoked_at` NULL, `replaced_by_id` NULL, `user_agent`, `ip`, `created_at`.
Indexes: unique on `token_hash`, `IDX_refresh_tokens_user (user_id)`.

**Design**

- Access token drops from `1d` to **15 minutes**; refresh token lives 30 days.
- **Rotation on every use**: refreshing issues a new refresh token and marks the old one
  replaced.
- **Reuse detection**: presenting an already-replaced token means it leaked — revoke the
  whole chain for that user and force re-login. This is the property that makes rotation
  worth the complexity.
- Refresh token travels in an **httpOnly, Secure, SameSite=Lax cookie**, scoped to
  `/auth/refresh`. The access token stays in memory on the client.

**APIs** — `POST /auth/refresh` (public, cookie-authenticated), and `POST /auth/logout`
gains real meaning: revoke the presented refresh token and clear the cookie.

**Frontend** — replace `localStorage` token storage in `frontend/lib/api.ts` with an
in-memory token plus a single-flight refresh on 401, then retry once. Fixes Week 1
limitation 3 at the same time.

**Security** — hash at rest; rotate on use; detect reuse; bind to user agent loosely (log
mismatches, don't hard-fail — mobile networks change); CSRF protection on the refresh
endpoint since it is cookie-authenticated; cap tokens per user.

**Tests** — refresh returns a new pair; the old refresh token stops working; reuse of a
replaced token revokes the chain; expired token → 401; logout revokes; an access token
still dies on membership revocation (Week 1 behaviour must survive).

---

## 8. Customer and restaurant authentication separation

**The requirement:** a customer credential must never satisfy a restaurant guard, and the
two must be impossible to confuse.

**Design — separate everything:**

| | Restaurant | Customer |
| --- | --- | --- |
| Credential | JWT, `aud: "restaurant"` | opaque session id, `CHAR(43)` |
| Storage | `users` + `restaurant_users` | `customer_sessions` table |
| Guard | `JwtAuthGuard` + `RolesGuard` | `CustomerSessionGuard` |
| Decorator | `@ActiveRestaurantId()` | `@CustomerSession()` |
| Scope | a whole restaurant | one table, one visit |

**Entity** — `customer_sessions`: `id`, `session_token CHAR(43)` unique, `restaurant_id`,
`table_id`, `expires_at` (a few hours — a dining visit), `created_at`.

**Why opaque, not a JWT:** a customer session must be revocable the moment a table is closed
out, it carries no role, and keeping it structurally different from a restaurant JWT makes
accidental cross-acceptance impossible rather than merely unlikely.

**Hard separation rules**

1. `JwtStrategy` must assert `payload.aud === 'restaurant'`. Add the claim in
   `AuthService.buildAuthResponse` now, verify it from day one of Week 2.
2. `CustomerSessionGuard` reads only the `X-Plateo-Session` header, never `Authorization` —
   so a restaurant token cannot be replayed onto a customer route even by mistake.
3. Customer routes live under `/public/**` and are never decorated with `@Roles`.
4. A customer session grants exactly: read this table's menu, create an order at this table,
   read orders it created. Nothing else.

**Frontend** — enforced by structure: `app/(customer)/` does not import `AuthProvider`, and
`lib/customer-api.ts` is a separate client that only sends the session header.

**Tests** — the critical matrix: a customer session on any `/restaurants`, `/dishes`,
`/categories`, `/ingredients`, `/orders` route → 401; a restaurant JWT on a customer route →
401; a customer session from restaurant A cannot order at restaurant B's table; an expired
session → 401; a session for a closed table → 401. Write these as an explicit "credential
confusion" spec, mirroring `tenant-isolation.e2e-spec.ts`.

---

## 9. Ingredient nutrition calculation

Week 1 stores nutrition as restaurant-declared text on the dish and says so loudly. Week 2
adds a *calculated* alternative — while keeping the two clearly distinguishable.

**Entity changes**

- `ingredients` gains per-100g reference values: `protein_per_100g`, `calories_per_100g`,
  `carbs_per_100g`, `fat_per_100g`, all `DECIMAL(8,2)` NULL, plus
  `nutrition_source VARCHAR(24)` (`RESTAURANT_DECLARED` | `USDA` | `IFCT`) and
  `nutrition_verified_at DATETIME(6)` NULL.
- `dishes` gains `nutrition_source VARCHAR(24)` — `RESTAURANT_DECLARED` (default, matching
  every existing row) or `CALCULATED`.

**Migration** — `AddIngredientNutrition`. Backfill every existing dish to
`RESTAURANT_DECLARED` so no historical row is silently reclassified.

**Calculation** — `NutritionCalculatorService`: for each `dish_ingredients` line, convert
`quantity`/`unit` to grams via an explicit unit table (`g`, `kg`, `ml`≈`g` for water-like
only, and **refuse** `piece`/`tbsp`/`cup` unless the ingredient defines a gram weight), then
sum `quantity_g / 100 × per_100g`. Return a result object carrying `{values, completeness,
missingIngredients[]}`.

**Partial data is the normal case.** If any ingredient lacks reference values or a
convertible unit, return the calculation flagged `completeness: "PARTIAL"` with the gaps
named. Never silently treat missing as zero — that is how a dish claims 0 kcal.

**APIs**

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/dishes/:id/nutrition/calculated` | preview: calculated values + completeness + gaps |
| `POST` | `/dishes/:id/nutrition/apply-calculated` | owner accepts it; sets `nutrition_source=CALCULATED` |

Calculation is **never** applied automatically. A human confirms.

**Frontend** — in the dish dialog, a "Calculate from ingredients" panel showing the computed
values side by side with the declared ones, the completeness badge, the list of ingredients
missing data, and an explicit Apply button. Ingredients gain optional per-100g fields.

**Honesty requirements (non-negotiable)**

- The API and UI must always report which source a dish's nutrition came from.
- Calculated values are **estimates from restaurant-supplied quantities**; cooking losses,
  absorption and portion variance are not modelled. Say so in the UI and the Swagger
  description.
- Never describe any value — declared or calculated — as verified, medical, or nutritional
  advice. This carries forward the Week 1 rule unchanged.

**Tests** — arithmetic against hand-computed fixtures; unit conversion incl. rejected units;
missing reference data yields `PARTIAL` and never zero; applying sets the source and is
owner-only; cross-restaurant dish → 404; a dish with no ingredients returns empty rather
than zeroes.

---

## Cross-cutting work

| Item | Why |
| --- | --- |
| Run the MySQL e2e mode in CI | Week 1 validation showed FK-name drift that SQLite could not surface |
| `migration:generate` drift check in CI | must print "No changes in database schema were found" |
| Move roles to `restaurant_users.role` | required before team invitations — see Known limitation 2 |
| Redis-backed throttler | in-process counters break as soon as there are two API instances |
| Structured logging with request ids | needed to debug an order across customer and restaurant surfaces |
| Cursor pagination on `/orders` | orders grow without bound, unlike a menu |

## Risks

| Risk | Mitigation |
| --- | --- |
| Printed QR leaks (photo, social media) | rotation endpoint; tokens grant order-create only, never payment |
| Price changed mid-order | snapshot inside the creation transaction (§6) |
| Customer credential accepted by a restaurant route | `aud` claim + separate header + explicit confusion test matrix (§8) |
| Calculated nutrition presented as fact | completeness flag, explicit source, human confirmation, disclaimer copy (§9) |
| Order volume outgrowing unpaginated lists | pagination before launch, not after |
