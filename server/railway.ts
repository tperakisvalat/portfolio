import { pathToFileURL } from 'node:url'
import { createApi } from './api.js'
import { openDatabase } from './db.js'
import { assertDedicatedDatabase, assertRailwaySchema, prepareRailwayDatabase, railwayConfig, waitForRailwayDatabase } from './railway-runtime.js'

export async function startRailway(command = 'serve') {
  if (!['serve', 'migrate'].includes(command)) throw new Error('Use serve or migrate')
  const config = railwayConfig()
  const db = await openDatabase(config.databaseUrl, undefined, { connectSeconds: 5, statementMillis: command === 'migrate' ? 60000 : 5000, closeSeconds: 5 })
  let app: ReturnType<typeof createApi> | undefined
  try {
    await waitForRailwayDatabase(db)
    if (command === 'migrate') {
      await prepareRailwayDatabase(db, config.databaseName)
      await db.close()
      console.log('Railway news schema prepared. Existing settings and editions preserved. No editor started.')
      return
    }
    await assertDedicatedDatabase(db, config.databaseName)
    await assertRailwaySchema(db)
    app = createApi(db)
    app.addHook('onClose', () => db.close())
    await app.listen({ host: config.host, port: config.port })
    let stopping = false
    const stop = () => {
      if (stopping) return
      stopping = true
      void app!.close().catch(() => { console.error('News API shutdown failed'); process.exitCode = 1 })
    }
    process.once('SIGTERM', stop)
    process.once('SIGINT', stop)
    console.log(`Railway news API listening on port ${config.port}. Editor disabled; publication requires owner approval.`)
  } catch {
    if (app) await app.close().catch(() => {})
    else await db.close().catch(() => {})
    // Database errors can contain connection credentials. Do not print their raw messages.
    throw new Error('Railway news startup failed. Check private database readiness, the dedicated target and the pre-deploy migration.')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startRailway(process.argv[2]).catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
