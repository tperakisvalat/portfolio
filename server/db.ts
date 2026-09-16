import { PGlite } from '@electric-sql/pglite'
import postgres from 'postgres'
import { readdir, readFile, mkdir } from 'node:fs/promises'

export interface Database {
  // JSON parameters are already JSON.stringify'd by callers, for parity with PGlite.
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  exec(sql: string): Promise<void>
  transaction<T>(fn: (db: Database) => Promise<T>): Promise<T>
  close(): Promise<void>
}
export async function openDatabase(url = process.env.DATABASE_URL, localPath = '.local/news-db'): Promise<Database> {
  if (url) {
    const client = postgres(url, {
      max: 5, prepare: false, connection: { application_name: 'tpv-news' },
      types: {
        json: {
          to: 114, from: [114, 3802],
          // postgres.js would otherwise JSON.stringify these strings a second time.
          serialize: (value: string) => value,
          parse: (value: string) => JSON.parse(value),
        },
      },
    })
    const wrap = (sql: any): Database => ({
      query: async (query, params = []) => Array.from(await sql.unsafe(query, params)),
      exec: async query => { await sql.unsafe(query) },
      transaction: fn => sql.begin((tx: any) => fn(wrap(tx))),
      close: () => client.end(),
    })
    return wrap(client)
  }
  if (process.env.NODE_ENV === 'production') throw new Error('DATABASE_URL required in production; no embedded fallback')
  if (localPath !== 'memory://') await mkdir(localPath, { recursive: true })
  const pg = await PGlite.create(localPath)
  const wrap = (client: any): Database => ({
    query: async (query, params = []) => (await client.query(query, params)).rows,
    exec: async query => { await client.exec(query) },
    transaction: fn => client.transaction((tx: any) => fn(wrap(tx))),
    close: () => pg.close(),
  })
  return wrap(pg)
}
export async function migrate(db: Database) {
  // Explicit CLI operation only; never run DDL on an API request or automatically in production.
  await db.exec('CREATE SCHEMA IF NOT EXISTS news_private; CREATE TABLE IF NOT EXISTS news_private.migrations (name text primary key, applied_at timestamptz not null default now())')
  for (const name of (await readdir('supabase/migrations')).filter(n => n.endsWith('.sql')).sort()) {
    if ((await db.query('SELECT name FROM news_private.migrations WHERE name=$1', [name])).length) continue
    const sql = await readFile(`supabase/migrations/${name}`, 'utf8')
    await db.transaction(async tx => { await tx.exec(sql); await tx.query('INSERT INTO news_private.migrations(name) VALUES($1)', [name]) })
  }
}
