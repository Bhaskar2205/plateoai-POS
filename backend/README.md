# Plateo Backend

NestJS + TypeORM + MySQL 8 API for the Plateo restaurant platform.

Full setup, environment reference, endpoint list and architecture notes live in the
[root README](../README.md). Quick reference:

```powershell
npm install
Copy-Item .env.example .env   # then fill in DB_* and JWT_SECRET
npm run migration:run
npm run start:dev             # http://localhost:4000, docs at /api/docs
```

| Script                    | What it does                                             |
| ------------------------- | -------------------------------------------------------- |
| `npm run start:dev`       | Watch-mode dev server                                    |
| `npm run build`           | Compile to `dist/`                                       |
| `node dist/main.js`       | Run the compiled build                                   |
| `npm run typecheck`       | `tsc --noEmit`                                           |
| `npm run migration:run`   | Apply pending migrations                                 |
| `npm run migration:revert`| Undo the most recent migration                           |
| `npm run migration:show`  | List applied / pending migrations                        |

`start:prod` is the same command with `exec` in front, which is how the platform
starts the API: `exec` replaces npm's wrapper shell with node so node receives
SIGTERM on a deploy instead of a shell that dies without telling it. `exec` is
POSIX-only, so run the compiled build by hand with `node dist/main.js` on Windows.
| `npm run migration:generate -- src/database/migrations/Name` | Diff entities against the live DB. Must report "No changes in database schema were found" when nothing has changed |
| `npm run seed`            | Insert a demo restaurant and sample menu                 |
| `npm test`                | Unit tests                                               |
| `npm run test:e2e`        | Full API suite (in-memory SQLite)                        |
| `TEST_DB_DRIVER=mysql npm run test:e2e` | Same suite against real MySQL 8, schema built by the migration (use a throwaway database — it drops the schema per spec file) |
| `npm run test:all`        | Both suites                                              |
| `npm run smoke`           | Boot a real HTTP server and drive it over the wire       |
