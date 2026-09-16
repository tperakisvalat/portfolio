# Deployment checkpoint

## Public repository

Source code is public; local credentials, account access notes, private editorial context, draft evidence, database backups and personal documents are not. Do not use `git add -f` to include ignored files. `docs/news/editor.example.md` is a non-personal fallback for a new database. The local private charter remains in the ignored `docs/news/editor.md`; existing database settings are never overwritten by seeding. Restore the private database or configure the owner-only admin before running the editor on a fresh installation.

## Vercel website

- Framework: Vite; root: `./`; build: `npm run build`; output: `dist`.
- Public browser settings: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- Set `VITE_NEWS_LOCAL_DESK=false` for hosted deployments.
- The server-side news proxy needs `NEWS_BACKEND_URL`, the approved HTTPS URL of the separately deployed news backend. Never point it at localhost.
- OpenAI credentials, database passwords and executor tokens belong on the backend, not in the browser or repository.
- Use a deployment branch and temporary URL before changing the production branch or domain. The original Vercel project may still watch `main`.

A successful frontend build does not mean the news service is deployed. Until the backend is ready and connected, news API requests cannot serve the local editions.

## Railway: first deploy the API, with the editor disabled

The local Docker Compose installation stays unchanged. `Dockerfile.railway-api` and `server/railway.ts` provide a separate, API-only Railway runtime: published editions, research library, prediction-market snapshots and the authenticated admin API. It deliberately does not start collection, scheduling or the editor. Automatic live market refresh therefore remains off too; an owner can refresh manually.

This is a deployment checkpoint, not the full hosted pipeline. A fresh database contains source configuration, but no editions. The existing private database still needs migrating. Railway's private service network is not equivalent to the local executor's network isolation; do not deploy the Compose worker unchanged or add OpenAI credentials yet.

### 1. Create the resources

1. In the intended personal Railway workspace, select **New Project → Empty Project** and name it `tpv-news`. Leave unrelated projects untouched. Confirm the account's billing plan before provisioning; database and application compute are usage-billed separately from OpenAI.
2. Inside that project, select **New → Database → PostgreSQL**. Keep the service name **Postgres**, which the variable references below require. Keep the database private; do not enable a public TCP proxy. Choose the same region for the API and database, preferably the available US East region for this installation.
3. Select **New → Empty Service**, name it **news-api**. Configure it before connecting GitHub so the first build does not mistakenly launch the Vite frontend.

### 2. Configure news-api

In **Variables → Raw Editor**, use `config/news.railway.env.example`. Keep the three `${{Postgres.…}}` references as written; Railway resolves them. Do not paste a local database URL.

Fill the four blank values:

| Variable | Where to get it |
| --- | --- |
| `NEWS_OWNER_ID` | Existing `.local/news-deploy.env`; the Supabase **Authentication → Users → user UUID**, not the Railway account ID. |
| `VITE_SUPABASE_URL` | Existing `.env.local`. |
| `VITE_SUPABASE_ANON_KEY` | Existing `.env.local`; only the public anon/publishable key, never a service-role key. |
| `NEWS_WEB_ORIGIN` | Exact Vercel preview origin used for testing, such as `https://your-preview.vercel.app`. No trailing slash or `/admin`. |

Do not add `OPENAI_API_KEY`, `NEWS_LOCAL_ADMIN_TOKEN`, `NEWS_EXECUTOR_URL` or `NEWS_EXECUTOR_TOKEN`. API-only startup rejects them. Railway supplies its project/environment IDs automatically.

In **Settings**, configure:

| Setting | Value |
| --- | --- |
| Root directory | Repository root (`/`) |
| Dockerfile | `Dockerfile.railway-api`, selected by the `RAILWAY_DOCKERFILE_PATH` variable |
| Start command | `npm run news:railway:serve` (also the image's default) |
| Pre-deploy command | `npm run news:railway:migrate` |
| Healthcheck path | `/api/news/v1/health` |
| Replicas | 1 |
| Serverless/sleep | Off during verification |
| Cron schedule | None |

The explicit pre-deploy command prepares only a dedicated news database and preserves existing settings. The web server itself does not run migrations. Both commands reject a database containing unrelated application tables. Do not use this service against the existing Supabase application database.

Only after these settings are saved and the Railway files have been committed and pushed, attach the GitHub repository `tperakisvalat/portfolio`, branch `codex/news-v1-deployment`, then deploy. Confirm build logs use the custom Dockerfile and the deployment reaches **Success**. Do not substitute the existing `main` branch until it contains these files.

### 3. Connect and verify, before changing the public domain

1. Under **news-api → Settings → Networking**, generate an HTTPS domain targeting port `8080`. Check `https://YOUR-API-DOMAIN/api/news/v1/health` returns `{"ok":true}`. Opening the API's root `/` is not the website and may return 404.
2. Set Vercel's server-only `NEWS_BACKEND_URL` to that HTTPS origin for **Preview**, then redeploy the preview. Never use a `VITE_` prefix for this variable. Ensure `NEWS_WEB_ORIGIN` matches the frontend URL actually being opened; a different preview URL will intentionally fail admin writes.
3. Check `/api/news/v1/brief/latest` through the Vercel preview. A fresh database correctly returns a null edition; it has not imported local stories. Verify unauthenticated `/api/news/v1/admin/overview` returns 401 and owner login succeeds.
4. Back up the current local news database, inspect the exact new destination and restore its private news data through a controlled migration. Do not blindly replay a dump over populated tables or expose the database publicly as a shortcut. Verify editions, drafts, source settings, private charter and publication ordering against the original. Keep the local original and backup until verification is complete.
5. Configure database backups and test recovery. Verify an owner-approved draft publication updates the public website and text brief without exposing evidence, drafts or private configuration.
6. Implement and verify the hosted worker/executor isolation and cost limits separately. Only then add provider credentials and commission an explicitly approved test edition. A healthy API alone is not evidence that editorial generation works remotely.

Move `tpv.world` only after verifying the replacement website and full backend together. Domain cutover and enabling schedules are separate actions, not consequences of pushing the branch.

References: [Railway Dockerfile selection](https://docs.railway.com/builds/dockerfiles), [pre-deploy commands](https://docs.railway.com/deployments/pre-deploy-command), [PostgreSQL](https://docs.railway.com/databases/postgresql), [private networking](https://docs.railway.com/networking/private-networking).

## Local checks without paid editorial runs

```
npm ci
npm run news:check
npm run news:test
npm run news:test:production
npm run news:test:postgres
npm run build
```

The production-configuration check requires Docker Compose. The Postgres test starts and removes a disposable test database; it does not use the news desk database. These commands do not commission paid editor work. Do not substitute `news:verify`, which is a real provider run.
