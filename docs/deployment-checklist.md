# Deployment checklist

Run through this before every production deploy. It exists because the
expensive failures in this project have all been environmental, not logical: a
stale QR origin, a volume that was not mounted, a start command that turned a
normal rollover into a crash alert.

---

## Before deploying

- [ ] `cd backend && npm test` — unit suite green
- [ ] `cd backend && npm run test:e2e` — e2e green on SQLite
- [ ] `cd backend && TEST_DB_DRIVER=mysql DB_DATABASE=plateo_test npm run test:e2e` — green on real MySQL
- [ ] `cd backend && npm run build` — compiles
- [ ] `cd frontend && npx tsc --noEmit` — typechecks
- [ ] `cd frontend && npm run build` — builds (stop the dev server first; sharing `.next` corrupts the build)
- [ ] Migrations reviewed by eye: additive, reversible, no `DROP` of anything live
- [ ] Migrations run on `plateo_dev`, then on a **fresh empty database** to prove they work from zero
- [ ] **Database backup taken and its restore verified** — see Backups below
- [ ] Environment variables confirmed against `docs/environment.md`
- [ ] `PUBLIC_WEB_URL` confirmed — changing it invalidates every printed QR code
- [ ] `PUBLIC_API_URL` confirmed — dish photo URLs are stored using it
- [ ] `UPLOADS_DIR` is an absolute path on a mounted volume
- [ ] `NEXT_PUBLIC_API_URL` set for the frontend build (unlike local, production needs it explicit)
- [ ] `CORS_ORIGINS` lists the exact app origin
- [ ] `TRUST_PROXY` matches the number of proxies in front of the API
- [ ] Payment configuration — n/a until a provider exists; do not claim otherwise

## Deploying

- [ ] Push to `master`; Railway builds the API, Vercel builds the app
- [ ] Watch the Railway deployment to `SUCCESS`
- [ ] Pre-deploy migration step reports either executed migrations or "No migrations are pending"
- [ ] Old container retires with `SIGTERM received: finishing in-flight requests` and **no** `npm error`

## After deploying

- [ ] `GET https://api.plateoai.in/health` → 200
- [ ] Sign in to the admin app
- [ ] Open a bill, punch a dish, check the tax breakdown shows each component
- [ ] Settle it — no print dialog should appear
- [ ] Open Reports → Day-end and confirm the figures reconcile
- [ ] Scan a table QR on a phone, place an order, confirm it arrives as pending
- [ ] Sign in to the kitchen app with the code and confirm the ticket appears
- [ ] Confirm the kitchen board shows no prices

---

## Backups — current state

**There is no automated database backup configured, and no restore has ever been
tested.** This is the single largest operational gap and it should be closed
before a paying restaurant depends on the system.

What is needed:

1. **Database.** Railway MySQL does not back up on the free tier. Either enable
   provider backups or schedule `mysqldump` to off-platform storage. A backup
   nobody has restored is not a backup — do a restore drill.
2. **Dish photos.** They live on a Railway volume at `/data`. Volumes are not
   snapshotted automatically. If the volume is lost, every photo is lost;
   dishes keep working, their images 404.
3. **Rollback.** Every migration has a verified `down`
   (`npm run migration:revert` reverts one). Code rolls back by redeploying the
   previous Railway deployment. **A code rollback does not undo a migration** —
   revert the migration first if the new schema is incompatible.
4. **Volume failure.** No replica. Treat `/data` as recoverable only from a
   backup that does not yet exist.

---

## Never

- Change the production schema by hand. Migrations only, reviewed, dev → test → production.
- Point the e2e suite at a database whose name does not end `_test` — it drops the schema.
- Run `next build` while `next dev` is using the same `.next`.
- Deploy on the strength of a green local run alone without the post-deploy checks above.
