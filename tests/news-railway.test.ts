import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { openDatabase, type Database } from '../server/db.js'
import { createApi } from '../server/api.js'
import { getSettings } from '../server/store.js'
import { assertDedicatedDatabase, assertRailwaySchema, prepareRailwayDatabase, railwayConfig, waitForRailwayDatabase } from '../server/railway-runtime.js'

function config(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production', NEWS_MANAGED_DB: 'railway-dedicated',
    RAILWAY_PROJECT_ID: '10000000-0000-4000-8000-000000000001',
    RAILWAY_ENVIRONMENT_ID: '10000000-0000-4000-8000-000000000002',
    NEWS_OWNER_ID: '10000000-0000-4000-8000-000000000003',
    NEWS_WORKER_ENABLED: 'false', NEWS_LOCAL_DESK: 'false',
    VITE_SUPABASE_URL: 'https://fixture.supabase.co',
    VITE_SUPABASE_ANON_KEY: `fixture.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.fixture`,
    NEWS_WEB_ORIGIN: 'https://preview.example.org',
    NEWS_DB_HOST: 'postgres.railway.internal', NEWS_DB_NAME: 'railway',
    DATABASE_URL: 'postgresql://postgres:fixture-secret@postgres.railway.internal:5432/railway',
  }
}

test('Railway accepts only an explicit API-only production configuration', () => {
  const env = config(), result = railwayConfig(env)
  assert.equal(result.host, '::')
  assert.equal(result.port, 8080)
  assert.equal(result.databaseName, 'railway')
  assert.equal(railwayConfig({ ...env, PORT: '9090', VITE_SUPABASE_ANON_KEY: 'sb_publishable_fixture' }).port, 9090)
})

test('Railway rejects unsafe targets and privileged credentials without printing secrets', () => {
  const invalid: NodeJS.ProcessEnv[] = [
    { NODE_ENV: 'development' }, { NEWS_MANAGED_DB: 'local-compose' },
    { RAILWAY_PROJECT_ID: '' }, { RAILWAY_ENVIRONMENT_ID: 'not-an-id' }, { NEWS_OWNER_ID: '' },
    { NEWS_WORKER_ENABLED: 'true' }, { NEWS_WORKER_ENABLED: undefined },
    { NEWS_LOCAL_DESK: 'true' }, { NEWS_LOCAL_ADMIN_TOKEN: 'fixture-secret' },
    { OPENAI_API_KEY: 'fixture-secret' }, { NEWS_EXECUTOR_URL: 'http://executor:8791' }, { NEWS_EXECUTOR_TOKEN: 'fixture-secret' },
    { VITE_SUPABASE_URL: 'http://fixture.supabase.co' }, { VITE_SUPABASE_URL: 'https://fixture.supabase.co.attacker.org' },
    { VITE_SUPABASE_ANON_KEY: `fixture.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.fixture` },
    { VITE_SUPABASE_ANON_KEY: 'sb_secret_fixture-secret' },
    { NEWS_WEB_ORIGIN: 'https://preview.example.org/' }, { NEWS_WEB_ORIGIN: 'https://user:fixture-secret@preview.example.org' },
    { NEWS_WEB_ORIGIN: 'http://preview.example.org' }, { NEWS_WEB_ORIGIN: 'https://preview.example.org/admin' },
    { NEWS_DB_HOST: 'postgres.railway.internal.attacker.org' }, { NEWS_DB_NAME: 'other' },
    { DATABASE_URL: 'postgresql://postgres:fixture-secret@public.example.org:5432/railway' },
    { DATABASE_URL: 'postgresql://postgres:fixture-secret@postgres.railway.internal:5433/railway' },
    { DATABASE_URL: 'postgresql://postgres:fixture-secret@postgres.railway.internal:5432/railway?host=evil' },
    { DATABASE_URL: 'postgresql://postgres@postgres.railway.internal:5432/railway' },
    { DATABASE_URL: 'fixture-secret' }, { PORT: '0' }, { PORT: '65536' }, { PORT: '8080.5' },
  ]
  for (const override of invalid) {
    assert.throws(() => railwayConfig({ ...config(), ...override }), error => {
      assert(error instanceof Error)
      assert(!error.message.includes('fixture-secret'))
      return true
    }, `must reject ${Object.keys(override).join(',')}`)
  }
})

test('Railway database readiness retries are bounded and redact connection failures', async () => {
  let calls = 0
  const db = { query: async () => { if (++calls < 3) throw new Error('fixture-secret'); return [] } } as unknown as Database
  await waitForRailwayDatabase(db, 3, 0)
  assert.equal(calls, 3)
  calls = 0
  await assert.rejects(() => waitForRailwayDatabase(db, 2, 0), /did not become ready/)
  assert.equal(calls, 2)
  await assert.rejects(() => waitForRailwayDatabase(db, 0, 0), /at least one/)
})

test('Railway migrations are explicit, repeatable and preserve owner settings', async t => {
  const db = await openDatabase('', 'memory://')
  t.after(() => db.close())
  const [{ name }] = await db.query<{ name: string }>('SELECT current_database() AS name')
  await assert.rejects(() => assertRailwaySchema(db))
  await assert.rejects(() => prepareRailwayDatabase(db, 'incorrect_database'), /does not match/)
  assert.equal((await db.query("SELECT 1 FROM information_schema.tables WHERE table_schema='news_private'")).length, 0)
  await prepareRailwayDatabase(db, name)
  await assertRailwaySchema(db)
  const settings = await getSettings(db)
  const custom = { ...settings.value, priorities: 'Preserve this owner preference.' }
  await db.query("UPDATE news_private.settings SET value=$1 WHERE id='editor'", [JSON.stringify(custom)])
  const before = await db.query('SELECT id FROM news_private.sources ORDER BY id')
  await prepareRailwayDatabase(db, name)
  assert.deepEqual((await getSettings(db)).value, custom)
  assert.deepEqual(await db.query('SELECT id FROM news_private.sources ORDER BY id'), before)
  assert.equal((await db.query('SELECT id FROM news_private.runs')).length, 0)
})

test('Railway refuses databases containing unrelated application tables', async t => {
  const db = await openDatabase('', 'memory://')
  t.after(() => db.close())
  const [{ name }] = await db.query<{ name: string }>('SELECT current_database() AS name')
  // A schema beginning with pg but not pg_ is still application-owned.
  await db.exec('CREATE SCHEMA pgapplication; CREATE TABLE pgapplication.accounts(id integer)')
  await assert.rejects(() => assertDedicatedDatabase(db, name), /non-news tables/)
  await assert.rejects(() => prepareRailwayDatabase(db, name), /non-news tables/)
  assert.equal((await db.query("SELECT 1 FROM information_schema.tables WHERE table_schema='news_private'")).length, 0)
})

test('Railway API supports health and public reads but never commissions a disabled editor', async t => {
  const db = await openDatabase('', 'memory://')
  const [{ name }] = await db.query<{ name: string }>('SELECT current_database() AS name')
  await prepareRailwayDatabase(db, name)
  const old = process.env.NEWS_WORKER_ENABLED
  process.env.NEWS_WORKER_ENABLED = 'false'
  const api = createApi(db, async (_db, token) => {
    if (token === 'owner-fixture') return { id: 'owner', owner: true, scopes: ['*'] }
    throw Object.assign(new Error('Invalid token'), { statusCode: 401 })
  })
  t.after(async () => {
    await api.close(); await db.close()
    if (old === undefined) delete process.env.NEWS_WORKER_ENABLED
    else process.env.NEWS_WORKER_ENABLED = old
  })
  assert.equal((await api.inject('/api/news/v1/health')).statusCode, 200)
  assert.equal((await api.inject('/api/news/v1/brief/latest')).json().edition, null)
  assert.equal((await api.inject('/api/news/v1/admin/overview')).statusCode, 401)
  const result = await api.inject({ method: 'POST', url: '/api/news/v1/admin/runs', headers: { authorization: 'Bearer owner-fixture' }, payload: {} })
  assert.equal(result.statusCode, 503)
  assert.equal((await db.query('SELECT id FROM news_private.runs')).length, 0)
})

test('Railway image contains only the API runtime and public seed artifacts', async () => {
  const dockerfile = await readFile('Dockerfile.railway-api', 'utf8')
  assert(dockerfile.includes('USER node'))
  assert(dockerfile.includes('"server/railway.ts", "serve"'))
  assert(!dockerfile.includes('COPY . '))
  assert(!dockerfile.includes('docs/news/editor.md'))
  assert(!dockerfile.split('\n').filter(line => /^COPY /i.test(line)).join('\n').includes('.env'))
  const runtime = await readFile('server/railway.ts', 'utf8')
  assert(!runtime.includes('workerLoop'))
  assert(!runtime.includes('createExecutor'))
})
