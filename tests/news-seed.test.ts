import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSeedCharter } from '../server/seed.js'
import { Settings } from '../shared/news.js'

test('seed charter keeps private local context and supports a public-only checkout', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'tpv-charter-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const privatePath = join(directory, 'private.md'), publicPath = join(directory, 'public.md')
  await writeFile(publicPath, 'Public editorial baseline')
  assert.equal(await readSeedCharter(privatePath, publicPath), 'Public editorial baseline')
  await writeFile(privatePath, 'Private fixture context')
  assert.equal(await readSeedCharter(privatePath, publicPath), 'Private fixture context')
  await mkdir(join(directory, 'not-a-file'))
  await assert.rejects(() => readSeedCharter(join(directory, 'not-a-file'), publicPath))
  await assert.rejects(() => readSeedCharter(join(directory, 'absent'), join(directory, 'also-absent')))
})

test('public charter is valid without the private profile', async () => {
  const charter = await readFile('docs/news/editor.example.md', 'utf8')
  assert.equal(Settings.shape.charter.parse(charter), charter)
  assert(charter.includes('original publication date'))
  assert(charter.includes('Never publish'))
})
