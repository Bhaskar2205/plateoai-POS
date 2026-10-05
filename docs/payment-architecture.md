# Payment architecture

```
Razorpay credentials available ......... NO
Razorpay sandbox API tested ............ NO
Razorpay webhook signature verified .... NO
Live payments enabled .................. NO
Payment architecture implemented ....... YES
Provider-independent payment tests ..... YES
```

Nothing in this document claims a Razorpay integration works. The provider
exists, reports itself `NOT_CONFIGURED`, and refuses to act.

---

## Architecture

The design rests on one separation: **a payment reaching CAPTURED and a bill
being settled are two different events.** Collapsing them — settling because a
provider said something happened — is how a restaurant ends up with a closed bill
and no money.

```
Guest                     Plateo                      Provider
  |                         |                             |
  | place order ----------->|                             |
  |                         |-- order created             |
  |                         |-- server reads what the     |
  |                         |   bill is owed              |
  |                         |-- PaymentIntent (CREATED)   |
  |                         |---- createPayment --------->|
  |                         |<--- session ----------------|
  |<-- checkout ------------|                             |
  | pays ----------------------------------------------->|
  |                         |<=== webhook ================|
  |                         |                             |
  |                         |  1. verify signature (raw bytes)
  |                         |  2. claim provider event id
  |                         |  3. match the intent
  |                         |  4. CHECK THE AMOUNT
  |                         |  5. transition -> CAPTURED
  |                         |  6. settle the bill, once
  |                         |  7. audit, in the same transaction
```

Steps 1–3 happen before anything in the body is believed. Step 4 is the one that
cannot be skipped: a provider reporting ₹1,050 against a bill of ₹1,100 stops the
transition entirely rather than settling for the wrong amount.

A browser never says what a payment is worth. It names a bill; the server reads
`amountPayable` from the billing engine that already computed it.

## State machine

```
CREATED ──> PENDING ──> AUTHORIZED ──> CAPTURED ──> REFUNDED
   │           │             │            │         ▲
   │           │             │            └─> PARTIALLY_REFUNDED
   ├───────────┼─────────────┴──> FAILED      (terminal)
   └───────────┴────────────────> CANCELLED   (terminal)
```

- **Only CAPTURED may settle a bill.**
- `FAILED` and `CANCELLED` are terminal. A provider that fails a payment and
  later captures it is describing two payments; the second needs its own intent.
- Nothing returns to `CREATED`.
- Repeating a transition is **not** an error. A provider re-delivering
  `payment.captured` is normal, and failing it would make a healthy webhook look
  broken and invite a retry storm. The caller is told nothing changed, so no
  second audit record is written.

## Provider abstraction

`PaymentProvider` is expressed entirely in Plateo's terms. No provider type
appears outside the provider that produces it — the moment a Razorpay shape
reaches a service, swapping provider means rewriting the service.

| Provider | Status | Notes |
|---|---|---|
| `PLATEO_INTERNAL` | **READY** | Cash, manual UPI, a card machine that is not ours. Nothing to call, nothing to verify, but the same record and the same state machine |
| `RAZORPAY` | **NOT_CONFIGURED** | Implemented structurally; refuses every call without all three credentials |
| `CASHFREE_FUTURE` | **UNAVAILABLE** | Named in the enum, deliberately absent from the registry so asking for it fails rather than resolving to something that is not Cashfree |

**An unconfigured provider is never silently replaced by a working one.** Asking
for Razorpay without credentials is an error the caller sees, not an invitation
to fall back to the internal provider and record the bill as paid in cash. That
substitution would be invisible on every screen and wrong on every report.

`PLATEO_INTERNAL` is not a mock. It never appears as a fallback.

## Webhook verification

Order matters and is enforced:

1. **Verify the signature against the raw bytes.** Not the re-serialised body —
   `JSON.stringify` of a parsed body can reorder keys and change number
   formatting, and the signature covers the exact bytes sent. Nest is configured
   with `rawBody: true`, in production and in the test harness.
2. **Claim the provider event id.** `UNIQUE (provider, provider_event_id)`. The
   row is inserted *before* the event is acted on, so a repeat collides and is
   answered as a duplicate without the business transition running again.
3. Only then is the payment matched and moved.

A failed verification returns a flat 400 saying nothing about why — telling a
caller *why* a signature failed helps them produce a better forgery.

A duplicate delivery is answered with **success**. A provider that does not get a
2xx keeps retrying forever.

## Idempotency

Reuses the existing infrastructure. `POST /restaurants/me/payments/intents`
accepts `Idempotency-Key`: the same key returns the same intent, and the same key
with a different body is a 409.

Independently of the key, a bill that already has a live attempt
(`CREATED`/`PENDING`/`AUTHORIZED`) returns that attempt rather than opening a
second one — two live attempts would let a guest pay twice.

## Settlement

Payment settles a bill through **the same guarded path the till uses**:
`UPDATE ... WHERE status = OPEN` inside a transaction. The existing concurrency
protection is untouched, so a webhook cannot settle a bill a waiter just closed.

A capture landing on an already-closed bill is **not** an error — the money is
captured either way — but it writes a reconciliation exception, because a guest
paying online for a bill the till already took in cash is a real thing that needs
a person.

## Failure recovery

| Failure | What happens |
|---|---|
| Provider succeeds, our transaction fails | The transition rolls back entirely; the payment is not left looking captured. Reconciliation finds the provider payment later |
| Guest loses connection after paying | Nothing depends on the browser. The webhook settles the bill; the guest's screen is irrelevant |
| Amount disagrees | The transition is refused, the bill stays open, and the payment is not marked captured |
| Webhook arrives before we expect it | Processed if the transition is legal; otherwise recorded as an exception |
| Webhook for a payment we do not know | Recorded as `UNKNOWN_PROVIDER_PAYMENT`. Answered 200, because retrying will not help |

## Reconciliation

`PaymentReconciliationService` detects: payment captured with the bill still
open, bill settled with the online payment never completing, amount mismatch,
duplicate captured payments on one bill, unknown provider payment, webhook after
an unexpected state, and attempts stale beyond
`PAYMENT_INTENT_EXPIRY_MINUTES`.

**It repairs nothing.** Repairing a financial discrepancy destroys the evidence
of how it arose, and the second time it happens nobody can tell whether it is the
same fault or a new one. Each finding becomes a row a person resolves with a
note; the row stays.

It is run on demand, not on a timer: with more than one instance a timer means
every instance sweeps and writes duplicate exceptions.

## Security

- **Credentials** come from the environment only. Nothing is stored in a
  restaurant record, and the settings endpoint returns provider *status* and
  never a key, a secret, or any part of one — asserted by a test.
- **Amount** is read from the bill. The DTO forbids unknown properties, so an
  attempt to supply an amount is refused outright.
- **Authorization**: payments are `BILLING_ROLES` — owners and managers. Provider
  settings are owner-only. Waiters and kitchen staff get 403 on everything.
- **Tenancy**: another restaurant's payment is a 404, not a 403.
- **Audit**: every state change writes a record in the same transaction.

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `RAZORPAY_KEY_ID` | for Razorpay | — | All three, or the provider is `NOT_CONFIGURED` |
| `RAZORPAY_KEY_SECRET` | for Razorpay | — | Never reaches the browser |
| `RAZORPAY_WEBHOOK_SECRET` | for Razorpay | — | A key without this can take money it cannot confirm |
| `PAYMENT_INTENT_EXPIRY_MINUTES` | no | `30` | When an unpaid attempt becomes stale |

## Testing

| | |
|---|---|
| Unit | 42 in the payment module — state machine, amount verification, signature comparison, provider gating |
| E2E (SQLite) | 29 payment tests within 495 total |
| E2E (MySQL) | the same 495, with the concurrency assertions strict |

The signature tests sign with a secret **this project chose**. They prove the
HMAC comparison and the constant-time check, not that Razorpay produces what we
expect.

## PENDING_RAZORPAY_VERIFICATION

Not done, and not claimed. When credentials exist, verify in this order:

1. API authentication against the sandbox
2. Payment creation — and that `createPayment` is actually implemented, which it
   is not: it throws today rather than pretending
3. Payment lookup
4. **Webhook signature against a signature Razorpay produced** — the single most
   important item
5. `payment.captured` end to end
6. `payment.failed` end to end
7. Duplicate delivery
8. Amount mismatch against a real payment
9. Provider payment id uniqueness

## Known limitations

1. `RazorpayPaymentProvider.createPayment`, `fetchPayment` and `refundPayment`
   are **not implemented** — they throw. Writing the HTTP calls without being
   able to run them once would produce code that looks finished and has never
   worked.
2. **Refunds are deliberately absent.** A refund has to reduce the day-end
   takings, credit or reopen the bill, and reverse the tax charged on it. Plateo
   has no model for any of that, and returning money without it would quietly
   corrupt every report that follows. The endpoint exists and refuses.
3. The day-end report does not yet split takings by provider. Online payments
   settle as `OTHER`, so existing reconciliation equations still hold; the split
   is reporting work, not accounting work.
4. Reconciliation must be triggered; nothing schedules it.
5. The diner QR flow does not yet offer payment — the architecture is ready, the
   customer-facing step is not built, and it should not be until a provider works.
