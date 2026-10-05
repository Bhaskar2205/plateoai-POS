# Production readiness

Status of each area of Plateo, as actually executed — not as assumed.

**Gate run:** 2026-10-02
**Build under test:** working tree at the tax/day-end/TDS branch point, `plateo_dev` + `plateo_test`
**Suites:** 155 unit · 433 e2e on SQLite · 433 e2e on MySQL · 46 browser checks

Legend: `[P]` passed · `[F]` failed, fixed in this pass · `[N]` not tested · `[X]` not implemented

Nothing is marked passed unless the relevant flow was run and its result observed.

---

## Authentication

| | Item | Evidence |
|---|---|---|
| [P] | Register, login, logout, `/auth/me` | `auth.e2e-spec.ts` (20) |
| [P] | Argon2id hashing, no hash ever returned | `password.spec.ts`, `auth.e2e` |
| [P] | JWT issue and expiry | `auth.e2e` |
| [P] | Login rate limit, 5 per 60s per IP | `rate-limit.e2e-spec.ts` |
| [P] | Kitchen code sign-in, separate scope | `kitchen-app.e2e-spec.ts` (23) |
| [P] | Regenerating the kitchen code invalidates live screens | `kitchen-app.e2e`, browser check |

## Authorization

| | Item | Evidence |
|---|---|---|
| [P] | Owner / manager / waiter / kitchen / super admin enforced server-side | `authorization.e2e-spec.ts` (13) |
| [P] | Waiter cannot discount, settle or void | `production-readiness.e2e-spec.ts` |
| [P] | Tax configuration is owner-only (manager, waiter, kitchen all 403) | `production-readiness.e2e-spec.ts` |
| [P] | Kitchen devices confined to the board by an allow-list | `roles.guard.spec.ts`, `kitchen-app.e2e` |
| [N] | An exhaustive role × endpoint matrix | Covered per-module, not as one matrix — see Bug list B-4 |

## Multi-tenancy

| | Item | Evidence |
|---|---|---|
| [P] | Restaurant taken from the token, never from the request | `tenant-isolation.e2e-spec.ts` (9) |
| [P] | Another tenant's record answers 404, not 403 | `tenant-isolation.e2e`, readiness spec |
| [P] | Tax profiles, bills and day-end figures isolated | `taxes.e2e`, `production-readiness.e2e` |
| [P] | Every tenant-owned table carries a restaurant foreign key | `migration-schema.e2e-spec.ts` |

## Restaurant management · Menu · Ingredients

| | Item | Evidence |
|---|---|---|
| [P] | Profile read/update, members, stats | `restaurants.e2e-spec.ts` (19) |
| [P] | Categories, dishes, ingredients, recipes | `menu.e2e-spec.ts` (31), `menu-flow.e2e-spec.ts` (10) |
| [P] | Dish tax group accepted on create and update | `taxes.e2e`, `production-readiness.e2e` |
| [P] | Reclassifying a dish leaves settled bills untouched | `taxes.e2e` |

## Tables · QR

| | Item | Evidence |
|---|---|---|
| [P] | Create, rename, deactivate, delete | `tables.e2e-spec.ts` (27) |
| [P] | Regenerating a QR stops the old code ordering, new one works | `production-readiness.e2e` |
| [P] | A deactivated table refuses orders; reactivating restores them | `production-readiness.e2e` |
| [P] | QR tokens unique and case-sensitive at the database level | `migration-schema.e2e` |

## Public ordering

| | Item | Evidence |
|---|---|---|
| [P] | Valid slug, invalid slug, invalid token, deactivated table | `public-menu.e2e-spec.ts` (17) |
| [P] | Plain menu shows "scan the QR code on your table", no ordering controls | browser check |
| [P] | Per-dish instructions reach the kitchen unmixed | browser check, `kitchen-app.e2e` |
| [P] | Diner lines land PENDING, invisible to the kitchen until approved | `orders.e2e`, `kitchen-app.e2e` |
| [P] | Rate limited; a table caps at 40 unconfirmed lines | `diner-orders.service`, `rate-limit.e2e` |

## POS · KOT · Kitchen

| | Item | Evidence |
|---|---|---|
| [P] | Open, punch, approve, KOT, rounds, cancel line | `orders.e2e-spec.ts` (46) |
| [P] | Kitchen board, start/ready/served, status back to the till | `kitchen-app.e2e` (23), browser check |
| [P] | Kitchen sees no prices, bills, payments or reports | `kitchen-app.e2e`, browser check |

## Taxes · TDS

| | Item | Evidence |
|---|---|---|
| [P] | Scenario A — 1,000 food @ 2.5+2.5 → CGST 25, SGST 25, total 1,050 | `production-readiness.e2e` |
| [P] | Scenario B — +10% service charge → base 1,100, 27.50 each, total 1,155 | `production-readiness.e2e` |
| [P] | Scenario C — discount → service charge → GST, base visible | `production-readiness.e2e` |
| [P] | Scenario D — food / alcohol / packaged / exempt each taxed only by its own | `production-readiness.e2e` |
| [P] | CGST and SGST equal on bases that do not halve cleanly | `tax.util.spec.ts`, readiness spec |
| [P] | No drift across a 99-line bill | `tax.util.spec.ts`, readiness spec |
| [P] | Deterministic: recalculating lands on the same figures | `production-readiness.e2e` |
| [P] | Money is integer paise throughout; DECIMAL in the schema, no float type | `money.util.spec.ts`, `migration-schema.e2e` |
| [P] | TDS on 10,000 @ 2% → GST unchanged, total unchanged, collect 10,300 | `production-readiness.e2e` |
| [P] | TDS appears on the bill, in the day-end statement and in the payment line | `production-readiness.e2e` |
| [P] | A duplicate charge that would double-tax is refused | `taxes.e2e` |
| [P] | Changing a rate re-prices open bills, never settled ones | `taxes.e2e` |

## Billing · Settlement

| | Item | Evidence |
|---|---|---|
| [P] | Discounts at 10 / 25 / 50 accepted, 51 refused server-side, reason required | `production-readiness.e2e` |
| [P] | Cash / UPI / Card / Other recorded with amount, method and timestamp | `production-readiness.e2e` |
| [P] | Settling twice in sequence is refused | `orders.e2e`, readiness spec |
| [F] | **Settling twice concurrently returned success twice** | Fixed — see B-1 |
| [F] | **A void racing a settle could zero a paid bill** | Fixed — see B-2 |
| [P] | Settling no longer forces a print dialog; print stays available | browser check |
| [P] | Voided bills stay in the register with their reason, worth nothing | `production-readiness.e2e` |

## Reports · Day-end

| | Item | Evidence |
|---|---|---|
| [P] | Sales, items, sections, register, staff, tables, adjustments | `reports.e2e-spec.ts` (23) |
| [P] | Day-end reconciles with sales summary and the bill register | `production-readiness.e2e` |
| [P] | Payments sum to collected; tax lines sum to the tax total | `production-readiness.e2e` |
| [P] | Open and voided bills shown but never counted as takings | `production-readiness.e2e` |
| [P] | Open bills produce the "not ready for final reconciliation" warning | browser check |
| [P] | Business day starts 05:00 and survives month, year and leap boundaries | `business-date.util.spec.ts` |
| [P] | CSV export from every report table | browser check |

**The reconciliation equation**, asserted in `production-readiness.e2e-spec.ts`:

```
day-end.total     = Σ settled bill totals
day-end.collected = day-end.total − day-end.tdsWithheld
Σ day-end.payments = day-end.collected      (payments record what arrived)
Σ day-end.taxes    = day-end.taxTotal
sales.net          = day-end.total
```

## Payments

| | Item | Evidence |
|---|---|---|
| [P] | Payment domain, state machine, provider abstraction | Implemented and tested — `docs/payment-architecture.md` |
| [P] | Amount verification, idempotency, webhook deduplication | Implemented, 29 e2e tests, strict on MySQL |
| [P] | Reconciliation | Detects 7 classes of discrepancy; repairs none |
| [X] | **Razorpay sandbox verified** | **No.** No credentials exist; no API call or real signature has ever been checked |
| [X] | Live payments | **Not enabled** |
| [X] | Refunds | Deliberately absent until the billing model can reverse tax and takings |

## Printing

| | Item | Evidence |
|---|---|---|
| [P] | Bill prints the tax breakdown component by component | code + browser check of the markup |
| [P] | KOT printing, reprint | `orders.e2e` (payload), browser check |
| [N] | The browser print dialog itself | Not automatable; the page is produced and verified, the dialog is not |

## Image uploads

| | Item | Evidence |
|---|---|---|
| [P] | JPEG/PNG/WebP accepted, re-encoded to WebP, EXIF stripped | `uploads.e2e-spec.ts` (11) |
| [P] | Oversized images shrunk; a non-image is refused whatever it claims | `uploads.e2e` |
| [P] | Magic-byte validation, per-restaurant directories | `uploads.e2e` |
| [P] | Kitchen staff cannot upload; anonymous callers cannot | `uploads.e2e` |

## Security

| | Item | Evidence |
|---|---|---|
| [P] | Tenant isolation, 404-not-403, Argon2id, JWT, rate limits | see above |
| [P] | Trust-proxy handling so limits see the real client IP | `proxy-rate-limit.e2e-spec.ts` |
| [P] | Input validation, unknown fields rejected | global pipe, `menu.e2e` |
| [X] | Encrypted integration credentials | No integrations yet |
| [X] | Webhook signature verification | No webhooks yet |
| [X] | Idempotency keys | See B-3 |
| [X] | Audit log | Not implemented — next phase |

## Database

| | Item | Evidence |
|---|---|---|
| [P] | All 8 migrations run in sequence on a genuinely empty database | `plateo_migration_check`, created and dropped during this gate |
| [P] | The newest migration reverts and re-applies cleanly | same |
| [P] | Existing data survives: a flat rate became components charging the same | `plateo_dev` run |
| [P] | No migration depends on hand-made state | from-zero run |
| [P] | Migration DDL matches the entities, both directions | `migration-schema.e2e` |
| [P] | Money is DECIMAL, never float; timestamps UTC | `migration-schema.e2e`, `mysql-behaviour.e2e` |

## Deployment

| | Item | Evidence |
|---|---|---|
| [P] | `npm test`, `npm run test:e2e`, `npm run build` all pass, both apps | this gate |
| [P] | Production build runs and serves every surface | smoke test below |
| [P] | Clean SIGTERM so a rollover is not reported as a crash | verified on a real Railway deploy |
| [P] | Environment documented | `docs/environment.md` |

Production-build smoke test (`next start` + compiled API): login, dashboard, menu, tables, POS, bill with TDS, reports, day-end, QR menu, kitchen — **all passed**.

## Backups

| | Item | Evidence |
|---|---|---|
| [P] | Backup and restore **procedure** | Verified 2026-10-02: dumped, restored to a separate database, row counts identical across 15 tables, takings matched to the paisa, **and the application ran against the restored copy** — see `docs/backup-restore.md` |
| [X] | Automated backup of production | **Not configured.** Nothing copies the Railway MySQL anywhere |
| [X] | Any production backup ever taken | **No** |
| [X] | Restore drill against production data | **No** |
| [X] | Off-site storage, retention, schedule | **None** |
| [X] | Volume backup for dish photos | Not configured; the copy/restore mechanism is verified |
| [P] | Migration rollback | `down` verified, twice |

## Observability

| | Item | Evidence |
|---|---|---|
| [X] | Structured logging with requestId / restaurantId / duration | Not implemented |
| [P] | Secrets never logged | No credential appears in any log statement |
| [X] | Error tracking / alerting | Not configured |

---

## Audit log architecture

Every change worth answering for is recorded by the service that makes it. The
browser never asks for a record to be written: a client that can choose what gets
logged can choose what does not.

**Where records come from.** `AuditService` has two entry points, and the
difference is the design:

- `recordIn(manager, entry)` writes through the caller's transaction. Settling,
  voiding, discounting and recording TDS use this, so the record and the money
  move together. A bill that rolls back leaves no trace of having settled; one
  that commits cannot be missing from the log. Tested by applying a 51% discount,
  which the service refuses after loading the bill, and asserting no record
  survives.
- `record(entry)` writes on its own, for a change that is a single statement
  anyway: a dish price, a table deactivation, a QR regeneration.

**What is recorded.** Only the fields that changed, plus who, when, from which
address, and under which request id. Whole objects are never copied in — that
would duplicate money figures that could then disagree with the bill. A deny-list
strips anything resembling a credential (`password`, `token`, `jwt`,
`kitchenCode`, `apiKey`, card fields) as insurance against a future call site
passing an entity, and long strings are truncated.

Two credentials are deliberately absent even from the "after" value: a table's QR
token and the kitchen code. The log records **that** they changed, never their
value — a log holding them hands out table and kitchen access to anyone who can
read it. Both are asserted in `audit-idempotency.e2e-spec.ts`.

**Actions recorded.** `BILL_DISCOUNTED`, `BILL_DISCOUNT_REMOVED`, `BILL_SETTLED`,
`BILL_VOIDED`, `BILL_TDS_RECORDED`, `TAX_CONFIGURATION_CHANGED`,
`SERVICE_CHARGE_CHANGED`, `DISH_PRICE_CHANGED`, `DISH_TAX_GROUP_CHANGED`,
`DISH_AVAILABILITY_CHANGED`, `TABLE_CREATED`, `TABLE_DEACTIVATED`,
`TABLE_REACTIVATED`, `QR_REGENERATED`, `KITCHEN_CODE_REGENERATED`.

Deliberately **not** recorded, because the functionality does not exist: staff
creation, role changes and deactivation; inventory adjustments; refunds; bill
reopening. An action nobody can take would be a line in a log that is never
written, which reads as coverage and is not.

**Reading it.** `GET /restaurants/me/audit-logs`, filtered by date range, action,
entity type and member, paged, newest first. Owner and Plateo support only — not
managers, who are among the people the log exists to record. Waiters and kitchen
screens have no access.

**Append-only.** The application issues no UPDATE or DELETE against `audit_logs`
anywhere, and no route exists that would. This is enforced by convention, not by
grant: making it a database guarantee needs a second MySQL user with narrower
rights, which is a deployment decision rather than a schema one. **Known
limitation** — an operator with database credentials can still alter history.

## Idempotency architecture

The protection is a unique index on `(restaurant_id, scope, key)`, not a lookup.
Checking for an existing row and then inserting would move the race earlier: two
requests would both look, both find nothing, and both proceed. Instead both try to
insert, the database picks a winner, and the loser reads what the winner stored.

**Three outcomes for a repeat:**

| Situation | Answer |
|---|---|
| Same key, same body, finished | The original response, replayed |
| Same key, same body, still running | 409 — the first request has not answered yet |
| Same key, different body | 409 — that is a bug or an attack, not a retry |

A failed operation **releases** its key, so a genuine retry after a server error
or a rolled-back transaction can succeed. Without that, one transient failure
would poison the key forever and the caller could never complete the action.

The payload hash is computed over canonicalised JSON, so key order in the request
body cannot make a retry look like a different request. An absent field and an
explicit `undefined` hash the same; `null` does not.

**Scoping.** Keys are unique per restaurant and per scope, not globally. Two
restaurants whose tills generate the same key must not collide, and the same key
used to open a bill and to settle one describes two different operations. A
diner's key is claimed only after the restaurant has been resolved from the QR
link. `restaurant_id` is `NOT NULL DEFAULT 0` rather than nullable, because MySQL
treats NULLs as distinct in a unique index and would quietly allow duplicates.

**Endpoints protected**

| Endpoint | Scope |
|---|---|
| `POST /restaurants/me/orders` | `ORDER_CREATE` |
| `POST /public/restaurants/:slug/orders` | `DINER_ORDER` |
| `POST /restaurants/me/orders/:id/settle` | `ORDER_SETTLE` |
| `POST /restaurants/me/tables/:id/regenerate-qr` | `TABLE_REGENERATE_QR` |

Idempotency is **opt-in by header**. Without `Idempotency-Key` the endpoint
behaves exactly as before, so no existing caller breaks. The QR menu and the till
both send one: the diner app holds a key for the life of a cart attempt and
clears it once an order is placed, and the till fixes a key when the settle dialog
opens so a double-click settles once.

**Identified but not protected**, as the brief asks to document rather than
expand scope: adding items to an existing bill, approving diner lines, sending a
KOT, voiding a bill, applying or removing a discount, recording TDS, and
regenerating the kitchen code. None of these creates money out of nothing on a
repeat — a second void of a voided bill is refused, a second discount overwrites
the first — but each would be clearer with a key.

**Retention.** `IdempotencyService.purgeOlderThan(days)` sweeps keys older than a
configurable window, defaulting to 7 days. It is **not** scheduled from inside the
application: with more than one instance every instance would sweep, and a cleanup
that runs N times is a cleanup nobody owns. It is exposed for an operator or a
scheduled job. **Known limitation** — until something calls it, the table grows.

## Concurrency guarantees

| Guarantee | How | Verified on |
|---|---|---|
| A bill settles at most once | `UPDATE ... WHERE status = OPEN` inside the transaction | MySQL, 465 e2e |
| A void cannot zero a paid bill | The same claim on the void path | MySQL, 465 e2e |
| One key, one operation | Unique index on (restaurant, scope, key) | MySQL, 465 e2e |
| A double-tapped diner order creates one line | `DINER_ORDER` scope | MySQL + SQLite |
| A retried QR regeneration issues one token | `TABLE_REGENERATE_QR` scope | MySQL + SQLite |

SQLite serialises writers and cannot express two requests arriving at once, so the
concurrency tests assert strictly only when `TEST_DB_DRIVER=mysql`. On SQLite they
assert the weaker invariant that nothing half-happened. A pass on SQLite alone is
not evidence of concurrency correctness.

## Known limitations

1. `audit_logs` is append-only by convention; a database operator can still edit
   it. Closing that needs a restricted MySQL user.
2. Idempotency keys are swept only when something calls `purgeOlderThan`.
3. A repeat arriving while the first request is still in flight gets a 409 rather
   than waiting for the answer. Correct, but the caller has to retry.
4. Idempotency is opt-in; a caller that omits the header gets the old behaviour.
5. Audit records carry a request id, but there is no structured request log
   carrying the same id to correlate against yet.
