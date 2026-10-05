# Backup and restore

A backup nobody has restored is not a backup. This document records a restore
that was **actually performed**, and is honest about what is still missing.

**Last verified:** 2026-10-02, against `plateo_dev` restored into
`plateo_restore_check`.

---

## Verified: the procedure works

| Step | Result |
|---|---|
| Dump with `mysqldump --single-transaction` | 148 KB, under a second |
| Restore into a separate, empty database | ~1 second |
| Row counts across 15 tables | **identical**, every table |
| A complete restaurant | restaurant, users, menu, ingredients, tables, QR tokens, kitchen code, bills, tax configuration, audit history — all present |
| Settled takings | matched **to the paisa** |
| Dish photos | copied and restored intact |
| **The application running against the restored database** | logged in, served menu, tables, bills, day-end, audit log, taxes — all 200 |
| Day-end on restored data | tax lines summed to the tax total; payments summed to collected |

The last two rows are the ones that matter. A dump that restores but that the
application cannot run against is not a recovery.

### Taking a backup

```
"C:/Program Files/MySQL/MySQL Server 8.0/bin/mysqldump.exe" \
  --host=HOST --port=PORT --user=USER --password=SECRET \
  --single-transaction --routines --triggers --set-gtid-purged=OFF \
  --result-file=plateo-backup.sql DATABASE
```

`--single-transaction` takes a consistent snapshot without locking the tables,
so a backup can be taken while the restaurant is trading. `--set-gtid-purged=OFF`
keeps the dump restorable into a database that is not a replica.

### Restoring

```
CREATE DATABASE plateo_restore_check CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
mysql ... plateo_restore_check < plateo-backup.sql
```

Then run the API against it before trusting it:

```
PORT=4100 DB_DATABASE=plateo_restore_check node dist/main.js
```

Log in, open a bill, run the day-end report. If those work, the restore is real.

> On Windows use `node dist/main.js`, not `npm run start:prod` — the production
> script uses `exec`, which cmd does not have.

### Restoring dish photos

Photos live on the Railway volume at `/data/uploads`, served from
`PUBLIC_API_URL/uploads`. They are plain files: a copy of the directory is the
backup, and copying it back is the restore. Dishes keep working without them —
their images simply 404 — so photos are a lower tier of loss than the database.

---

## Not verified: production

**This is the gap, and it is the one that matters.**

| | Status |
|---|---|
| Automated backup of the Railway MySQL | **Not configured** |
| Any backup of production ever taken | **No** |
| Restore of production data ever tested | **No** |
| Backup of the Railway `/data` volume | **Not configured** |
| Off-site storage | **None** |
| Retention policy | **None** |
| Backup frequency | **None** |

What has been proven is the *procedure*, against development data of the same
shape, through the same code. What has not been proven is that production is
recoverable, because nothing is copying it anywhere.

### What closing this needs

1. **A backup that runs on a schedule.** Either Railway's own MySQL backups, if
   the plan includes them, or a scheduled `mysqldump` writing somewhere that is
   not Railway. A backup stored only on the platform it protects is not off-site.
2. **A retention policy.** Daily for a fortnight, weekly for a quarter, is a
   reasonable starting point for a restaurant; decide it deliberately.
3. **A restore drill against a production dump**, following the procedure above,
   including running the application against the restored copy.
4. **The volume.** Decide whether photo loss is acceptable. If not, the uploads
   directory needs copying off the volume on a schedule too.

Until 1–3 are done, **a database failure loses every restaurant's data
permanently**.

---

## Rollback, which is a different thing

A backup protects against data loss. A migration rollback protects against a bad
schema change, and Plateo has that: every migration has a verified `down`, and
`npm run migration:revert` reverts one. This was exercised on an empty database
during the readiness gate and again for the audit/idempotency migration.

**A code rollback does not undo a migration.** Redeploying the previous build
leaves the new schema in place. If the new schema is incompatible, revert the
migration first.
