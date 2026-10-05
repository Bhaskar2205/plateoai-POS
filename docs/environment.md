# Environment variables

Every variable Plateo reads, what breaks without it, and what production uses.

**Secrets are never committed.** `backend/.env` and `frontend/.env.local` are
gitignored; `.env.example` in each app carries safe placeholders and is the file
to copy.

```
cd backend   && cp .env.example .env
cd frontend  && cp .env.example .env.local
```

---

## Backend (`backend/.env`)

### Runtime

| Variable | Required | Local | Production | Notes |
|---|---|---|---|---|
| `NODE_ENV` | yes | `development` | `production` | Several guards only apply in production |
| `PORT` | no | `4000` | set by the platform | |
| `CORS_ORIGINS` | yes | `http://localhost:3000` | `https://app.plateoai.in` | Comma separated, exact origins, no wildcard, no trailing slash |
| `SWAGGER_ENABLED` | no | `true` | `false` | Serves `/api/docs` |
| `TRUST_PROXY` | prod | empty | `1` | Number of proxies in front. Empty when clients connect directly — otherwise `X-Forwarded-For` can be spoofed to defeat rate limits. Never `true` |
| `INTERNAL_PROXY_SECRET` | prod | empty | 32+ random chars | Must match the frontend's. Lets server-rendered menus forward the diner's IP so each diner is rate limited individually |

### Database

| Variable | Required | Local | Production |
|---|---|---|---|
| `DB_HOST` | yes | `127.0.0.1` | platform host |
| `DB_PORT` | yes | `3306` | `3306` |
| `DB_USERNAME` | yes | `root` | platform user |
| `DB_PASSWORD` | yes | — | platform password |
| `DB_DATABASE` | yes | `plateo_dev` | `railway` |
| `DB_SYNCHRONIZE` | yes | `false` | `false` | Always false. Schema changes go through migrations |
| `DB_LOGGING` | no | `false` | `false` |
| `DB_SSL` | prod | `false` | `false` on a private network | Required unless the host is localhost or a `*.railway.internal` private host |
| `DB_SSL_CA` | conditional | empty | provider CA (PEM) | `\n` may be written literally |
| `DB_SSL_REJECT_UNAUTHORIZED` | no | `true` | `true` | `false` is refused in production |

Three local databases, kept apart deliberately:

- **`plateo`** — the original local production-shaped database. Not migrated beyond migration 3. Do not touch.
- **`plateo_dev`** — day-to-day development. Fully migrated.
- **`plateo_test`** — the MySQL e2e target. **Dropped and rebuilt on every run**; the harness refuses any database whose name does not end `_test`.

### Auth

| Variable | Required | Notes |
|---|---|---|
| `JWT_SECRET` | yes | 32+ characters. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Rotating it signs every session out |
| `JWT_EXPIRES_IN` | no | `1d` |
| `LOGIN_THROTTLE_TTL` | no | `60` (seconds) |
| `LOGIN_THROTTLE_LIMIT` | no | `5` attempts per window per IP |

### Idempotency

| Variable | Required | Default | Notes |
|---|---|---|---|
| `IDEMPOTENCY_RETENTION_DAYS` | no | `7` | How long a used `Idempotency-Key` is kept so a late retry replays the original response. Sweeping is **not** automatic — call `IdempotencyService.purgeOlderThan` from a scheduled job, or the table grows |

### Public URLs and uploads

| Variable | Required | Production | Notes |
|---|---|---|---|
| `PUBLIC_WEB_URL` | yes | `https://app.plateoai.in` | **Table QR codes encode menu URLs on this origin.** Changing it after codes are printed invalidates the printed cards. Must be the app, not the marketing site |
| `PUBLIC_API_URL` | yes | `https://api.plateoai.in` | Dish photo URLs are stored using it; changing it does not rewrite saved URLs |
| `UPLOADS_DIR` | yes | `/data/uploads` | Must be an absolute path on a mounted volume in production, or every photo is lost on the next deploy |
| `UPLOAD_MAX_BYTES` | no | `8388608` | Before re-encoding |

The API refuses to boot in production without `PUBLIC_API_URL` and an absolute `UPLOADS_DIR`.

---

## Frontend (`frontend/.env.local`)

`NEXT_PUBLIC_*` values are compiled into the browser bundle **at build time**. Set
them before `npm run build` and redeploy after changing one.

| Variable | Required | Local | Production |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | prod only | **leave unset** | `https://api.plateoai.in` |
| `NEXT_PUBLIC_API_PORT` | no | `4000` | — |
| `NEXT_PUBLIC_SITE_URL` | yes | `http://localhost:3000` | `https://app.plateoai.in` |
| `PLATEO_API_URL` | no | — | optional internal host for server-rendered pages |
| `INTERNAL_PROXY_SECRET` | prod | — | must equal the backend's. **Server-only — never prefix with `NEXT_PUBLIC_`** |

**Why `NEXT_PUBLIC_API_URL` is unset locally.** When it is absent the browser calls
the API on whatever host served the page: open the app at `localhost` and it calls
`localhost`, open it from a phone at the machine's LAN address and it calls that.
A hard-coded development IP goes stale every time the machine joins a different
network, and the only symptom is that signing in fails with a fetch error that
says nothing about why. Production sets it explicitly.

---

## Never log, never commit

Passwords, password hashes, `JWT_SECRET`, issued tokens, `INTERNAL_PROXY_SECRET`,
database credentials, `DB_SSL_CA`, and any future payment keys. No log statement
in the codebase emits any of these.
