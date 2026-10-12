# Production backup plan

```
PRODUCTION_BACKUP_READY = false

Unchanged, and this is the honest reading: the *procedure* is proven, the
*production backup* does not exist. They are different things and only the
second one protects anybody.

Re-verified 2026-10-09 against `plateo_dev` restored into
`plateo_restore_check`, on the current 11-migration schema:

| Check | Result |
|---|---|
| Dump (`mysqldump --single-transaction --routines --triggers`) | 103,894 bytes |
| Tables present after restore | 20 of 20 |
| Row counts, every table | all matched |
| Migration state | 11 of 11 carried over |
| **Application running against the restored database** | health, public menu and login all answered correctly, with real data |
| Source database after the drill | untouched (13 restaurants, as before) |
| Dump file | deleted; throwaway database dropped |

What is still missing is the only thing that matters: **a backup of `plateo`
itself**. Nobody has one. It cannot be taken from this machine - the Railway CLI
is not authenticated here and no production credentials exist locally - so it is
an action for whoever holds the Railway account.
```

That status is set by evidence, not by intent. It flips only when every item in
**Acceptance criteria** below has actually happened.

Each item is marked:

- **IMPLEMENTED** — done, and verified by running it
- **RECOMMENDED** — the proposal, not yet in place
- **NOT CONFIGURED** — absent today

---

## What exists today

| Item | Status |
|---|---|
| Database provider | **IMPLEMENTED** — MySQL 8 on Railway, service `plateoai-qr`, private network |
| Backup mechanism | **NOT CONFIGURED** |
| Backup frequency | **NOT CONFIGURED** |
| Retention | **NOT CONFIGURED** |
| Off-site destination | **NOT CONFIGURED** |
| Encryption at rest for backups | **NOT CONFIGURED** (no backups exist to encrypt) |
| Access control for backups | **NOT CONFIGURED** |
| Restore procedure | **IMPLEMENTED** — written down and executed against `plateo_dev`, see `backup-restore.md` |
| Production restore ever tested | **NOT CONFIGURED** — no production backup has ever been taken |
| `/data` image backup | **NOT CONFIGURED** |
| Migration rollback | **IMPLEMENTED** — every migration has a verified `down` |

**The gap in one sentence:** the procedure is proven, and nothing is copying
production anywhere, so a database failure today loses every restaurant's data
permanently.

---

## Database backup — RECOMMENDED

**Mechanism.** Either Railway's managed MySQL backups, if the plan includes them,
or a scheduled `mysqldump` run outside Railway. The command is in
`backup-restore.md`; `--single-transaction` means it can run while restaurants
are trading.

**Frequency.** Daily, timed for the quiet hour. A restaurant's business day
starts at 05:00, so a run at **04:00 IST** sits at the end of the night's trading
and before the next day opens — losing at most one day of service, never half of
two.

**Retention.** Daily for 14 days, weekly for 12 weeks. Long enough to notice
corruption that was not obvious on the day; short enough to be affordable.

**Off-site destination.** Somewhere that is **not Railway**. A backup stored on
the platform it protects does not survive losing the account, the project, or the
region. Object storage with versioning and a separate credential is the usual
answer.

**Encryption.** The dump holds every restaurant's bills, customers' order notes
and staff email addresses. Encrypt at rest, and keep the key somewhere other than
beside the backup.

**Access control.** The backup credential should be able to write and not delete,
so a compromised API key cannot erase the history it just wrote. Restores are a
deliberate human action.

**RPO — how much data loss is acceptable.** With a daily backup, up to **24
hours**: a failure at 23:00 loses that day's trading. If that is unacceptable to a
restaurant paying for this, the answer is binlog/point-in-time recovery from the
provider, not a more frequent dump.

**RTO — how long recovery takes.** Measured on the dev restore: dump and restore
of a database this size take **seconds**. Realistically the recovery time is
dominated by noticing, deciding, and repointing `DB_*` at the restored database —
call it **under an hour**, and unverified until a production drill proves it.

---

## File storage — RECOMMENDED

Dish photos and restaurant logos live on the Railway volume mounted at `/data`,
served from `PUBLIC_API_URL/uploads`. **A database backup does not protect them**:
they are files, not rows, and losing the volume loses every image while the
dishes themselves survive.

What needs backing up:

- `/data/uploads/<restaurantId>/…` — dish photos, re-encoded WebP
- restaurant logos, where stored as uploads rather than external URLs
- anything else written under `UPLOADS_DIR` in future

**Mechanism.** Sync the directory to the same off-site object storage, daily, in
the same window as the database. Files are immutable once written — a photo is
replaced by a new file, never edited — so an incremental sync is cheap.

**Restoring.** Copy the directory back onto the volume and restart. Verified
locally: copying the uploads directory out and back preserves every file intact.

**Tolerable loss.** Images degrade gracefully — dishes keep working and their
pictures 404. The database does not degrade gracefully. If only one can be
afforded, back up the database.

---

## Disaster recovery procedure — RECOMMENDED

1. **Stop writing.** Pause the service so a half-broken database does not take
   more orders.
2. **Identify the last good backup.** Not simply the newest — if the cause is
   corruption, the newest may contain it.
3. **Restore into a new database**, never over the damaged one. The damaged copy
   is evidence, and it may hold rows the backup does not.
4. **Run the application against the restored database** before pointing anyone
   at it: log in, open a bill, run the day-end report. A dump that restores but
   that the application cannot serve is not a recovery.
5. **Reconcile.** Compare the day-end totals against anything the restaurant has
   on paper for the lost window, and record the difference rather than papering
   over it.
6. **Restore `/data`** from the file backup.
7. **Repoint `DB_DATABASE`** and redeploy.
8. **Write down what was lost**, per restaurant. A restaurant that lost four
   hours of bills needs to be told, not quietly handed a shorter day.

---

## Acceptance criteria

`PRODUCTION_BACKUP_READY` stays **false** until every one of these is true:

- [ ] An automated backup exists and runs on a schedule
- [ ] Its destination is separate from the production database
- [ ] Retention is configured
- [ ] A production backup has actually completed
- [ ] A restore has actually been tested from that backup
- [ ] The restored application starts
- [ ] Restaurant data is intact
- [ ] Financial totals reconcile against the source
- [ ] Image files are recoverable

Six of these need decisions only you can make — the provider, the plan, the
storage account, the credential. The procedure and the verification steps are
ready and documented.

---

## What has been verified, and where

`docs/backup-restore.md` records a restore that was performed on 2026-10-02
against `plateo_dev`: identical row counts across 15 tables, settled takings
matching to the paisa, images restored, and **the application running against the
restored database** with the day-end report still reconciling.

That proves the mechanism and the procedure. It does not prove production is
recoverable, and this document does not claim it does.
