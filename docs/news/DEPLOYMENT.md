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

## News backend

The current packaged runtime is Docker Compose: a desk API/worker, private Postgres and a network-isolated executor. Railway is the intended host, but its runtime configuration and equivalent executor isolation still require adaptation and verification. Do not deploy the Compose-specific runtime unchanged to Railway or weaken isolation to get it running.

Before public launch: restore the news database; configure exact owner authentication; verify the public proxy, login and draft-to-public publication; confirm backups; test worker isolation and cost metering. Keep the worker and automatic scheduling disabled until those checks pass. Move `tpv.world` only after verifying the replacement site and backend together. Domain cutover is a separate action, not a consequence of pushing this branch.

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
