import { readdir } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import type { Database } from './db.js'
import { migrate } from './db.js'
import { seed } from './seed.js'
import { getSettings } from './store.js'

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

// This is the API-only migration stage. A variable alone cannot enable an
// unverified Railway executor, local login bypass, or paid editorial run.
export function railwayConfig(env: NodeJS.ProcessEnv = process.env) {
  requireValue(env.NODE_ENV === 'production', 'Railway requires NODE_ENV=production')
  requireValue(env.NEWS_MANAGED_DB === 'railway-dedicated', 'Confirm NEWS_MANAGED_DB=railway-dedicated for a separate news database')
  requireValue(z.uuid().safeParse(env.RAILWAY_PROJECT_ID).success && z.uuid().safeParse(env.RAILWAY_ENVIRONMENT_ID).success, 'Railway project and environment identity are required')
  requireValue(env.NEWS_WORKER_ENABLED === 'false', 'Railway API-only mode requires NEWS_WORKER_ENABLED=false; executor isolation is not approved')
  requireValue(env.NEWS_LOCAL_DESK === 'false' && !env.NEWS_LOCAL_ADMIN_TOKEN, 'Local admin access must be disabled on Railway')
  requireValue(!env.OPENAI_API_KEY && !env.NEWS_EXECUTOR_URL && !env.NEWS_EXECUTOR_TOKEN, 'Do not add provider or executor credentials to the API-only migration stage')
  requireValue(z.uuid().safeParse(env.NEWS_OWNER_ID).success, 'Configure the exact Supabase owner user UUID')
  const auth = parseUrl(env.VITE_SUPABASE_URL, 'Supabase public URL is invalid')
  requireValue(auth.protocol === 'https:' && /^[a-z0-9]+\.supabase\.co$/.test(auth.hostname) && auth.pathname === '/' && !auth.username && !auth.password && !auth.search && !auth.hash && !auth.port, 'Use the existing HTTPS Supabase project URL')
  const key = env.VITE_SUPABASE_ANON_KEY || ''
  let publicKey = key.startsWith('sb_publishable_')
  if (!publicKey) {
    try { publicKey = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon' } catch { /* Fail closed below. */ }
  }
  requireValue(publicKey, 'Use the Supabase public anon/publishable key, never a service-role secret')
  const origin = parseUrl(env.NEWS_WEB_ORIGIN, 'NEWS_WEB_ORIGIN must be the exact HTTPS frontend origin')
  requireValue(origin.protocol === 'https:' && env.NEWS_WEB_ORIGIN === origin.origin, 'NEWS_WEB_ORIGIN must be an HTTPS origin without path or trailing slash')
  const database = parseUrl(env.DATABASE_URL, 'DATABASE_URL is missing or invalid')
  const host = env.NEWS_DB_HOST || '', name = env.NEWS_DB_NAME || ''
  requireValue(/^[a-z0-9][a-z0-9-]*\.railway\.internal$/.test(host), 'NEWS_DB_HOST must reference the dedicated private Railway database')
  requireValue(/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/.test(name), 'NEWS_DB_NAME must match the dedicated database name')
  requireValue(['postgres:', 'postgresql:'].includes(database.protocol) && database.hostname === host && database.pathname === `/${name}` && !!database.username && !!database.password && !database.search && !database.hash && (!database.port || database.port === '5432'), 'DATABASE_URL must match the approved private database host, name and port')
  const port = Number(env.PORT || '8080')
  requireValue(Number.isInteger(port) && port >= 1024 && port <= 65535, 'PORT must be an integer between 1024 and 65535')
  return { databaseUrl: env.DATABASE_URL!, databaseName: name, port, host: '::' }
}

function parseUrl(value: string | undefined, message: string) {
  try { return new URL(value || '') } catch { throw new Error(message) }
}

export async function waitForRailwayDatabase(db: Database, attempts = 10, delayMs = 1000) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { await db.query('SELECT 1'); return } catch {
      if (attempt + 1 === attempts) throw new Error('Private news database did not become ready; check its deployment and references')
      await delay(delayMs)
    }
  }
  throw new Error('Database readiness requires at least one attempt')
}

export async function assertDedicatedDatabase(db: Database, name: string) {
  const [identity] = await db.query<{ name: string }>('SELECT current_database() AS name')
  requireValue(identity?.name === name, 'Connected database does not match NEWS_DB_NAME')
  const foreign = await db.query(`SELECT 1 FROM information_schema.tables
    WHERE table_type='BASE TABLE' AND table_schema NOT IN ('news_private','information_schema')
      AND table_schema !~ '^pg_' LIMIT 1`)
  requireValue(!foreign.length, 'Refusing a database containing non-news tables; provision a dedicated news database')
}

export async function prepareRailwayDatabase(db: Database, name: string) {
  await assertDedicatedDatabase(db, name)
  // Explicit pre-deploy operation only, never an HTTP request/startup migration.
  await migrate(db)
  await seed(db)
}

export async function assertRailwaySchema(db: Database) {
  const expected = (await readdir('supabase/migrations')).filter(name => name.endsWith('.sql'))
  const applied = await db.query<{ name: string }>('SELECT name FROM news_private.migrations')
  requireValue(expected.every(name => applied.some(row => row.name === name)), 'News migrations are incomplete; run the pre-deploy migration command')
  await getSettings(db)
}
