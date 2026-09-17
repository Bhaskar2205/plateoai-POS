# Plateo Restaurant Admin

Next.js 15 (App Router) admin for restaurant owners.

Full setup lives in the [root README](../README.md). Quick reference:

```powershell
npm install
Copy-Item .env.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:4000
npm run dev                          # http://localhost:3000
```

The backend must be running first.

## Routes

| Route                            | Purpose                                            |
| -------------------------------- | -------------------------------------------------- |
| `/restaurant/register`           | Owner + restaurant onboarding                      |
| `/restaurant/login`              | Sign in                                            |
| `/restaurant/dashboard`          | Counters and quick actions                         |
| `/restaurant/profile`            | Restaurant details and team list                   |
| `/restaurant/menu`               | Menu management: categories, dishes, ingredients, availability |
| `/restaurant/menu/categories`    | Create / edit / delete categories                  |
| `/restaurant/menu/dishes`        | Dishes, nutrition, availability, recipe assignment |
| `/restaurant/menu/ingredients`   | Pantry management                                  |
| `/menu/[restaurantSlug]`         | **Public** diner-facing menu (no login), server-rendered with SEO metadata |

Everything under `(admin)` requires a session; the layout redirects to `/restaurant/login`
without one. That redirect is a convenience, not the security boundary — the API rejects
unauthenticated requests on its own.

| Script              | What it does                    |
| ------------------- | ------------------------------- |
| `npm run dev`       | Dev server                      |
| `npm run build`     | Production build                |
| `npm run start`     | Serve the production build      |
| `npm run typecheck` | `tsc --noEmit`                  |
