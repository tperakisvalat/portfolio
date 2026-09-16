import { after, afterEach, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

// In-memory React interaction tests with synthetic data and mocked requests.
// No listening server, actual browser, live origin, credentials or editions.
let vite, NewsPublish, NewsAdmin, useNewsQuery, announcePublication, publicationKey, dom, root, host
const originalGlobals = new Map()
before(async () => {
  vite = await createServer({ configFile: false, envFile: false, plugins: [react()], optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' })
  NewsPublish = (await vite.ssrLoadModule('/src/components/NewsPublish.jsx')).default
  NewsAdmin = (await vite.ssrLoadModule('/src/components/NewsAdmin.jsx')).default
  const publicModule = await vite.ssrLoadModule('/src/lib/newsPublic.js')
  ;({ useNewsQuery, announcePublication, NEWS_PUBLICATION_KEY: publicationKey } = publicModule)
})
beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="test"></div>', { url: 'https://news-test.invalid/', pretendToBeVisual: true })
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true })) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  // This regression must never depend on browser-native confirmation support.
  dom.window.confirm = () => { throw new Error('Native confirmation is unavailable') }
  host = document.getElementById('test'); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  dom.window.close()
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globalThis[key]
  }
  originalGlobals.clear()
})
after(async () => { await vite?.close() })

const draft = { id: 'fixture-draft', version: 1, status: 'draft', content: { date: '2026-09-09', cutoff: '2026-09-09T12:00:00Z', stories: [], library: [], coverageGaps: [], rejected: [] } }
const edition = { id: 'fixture-edition-new', content: { date: '2026-09-09', stories: [] } }
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
const render = element => act(async () => root.render(element))
const flush = () => act(async () => { await new Promise(resolve => setImmediate(resolve)) })
const button = label => [...host.querySelectorAll('button')].find(el => el.textContent === label)
async function click(label) { const target = button(label); assert(target, `Missing button: ${label}`); await act(async () => target.click()) }
function Reader({ path = '/brief/latest', refreshInterval = 0 }) {
  const { data, error } = useNewsQuery(path, { refreshInterval })
  return createElement('output', { 'data-reader': true }, `${data?.edition?.id || 'loading'}${error ? ' / refresh failed' : ''}`)
}

test('publish requires inline confirmation, commits once and updates an already-mounted reader', async t => {
  let latest = { id: 'fixture-edition-old' }, finish
  const calls = [], busy = [], receipts = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/news/v1/brief/latest')
    assert.equal(options.cache, 'no-store'); assert.equal(options.credentials, 'omit')
    return json({ edition: latest })
  })
  const api = async (path, options) => {
    calls.push({ path, options })
    await new Promise(resolve => { finish = resolve })
    latest = edition; return edition
  }
  await render(createElement('div', null, createElement(Reader), createElement(NewsPublish, { draft, dirty: false, api, onBusyChange: value => busy.push(value), onPublished: value => receipts.push(value) })))
  assert.equal(host.querySelector('output').textContent, 'fixture-edition-old')
  await click('publish v1'); assert.equal(calls.length, 0)
  await click('cancel'); assert.equal(calls.length, 0); assert(!button('confirm publish'))
  await click('publish v1'); await click('confirm publish')
  assert.equal(calls.length, 1); assert(host.textContent.includes('Publishing…')); assert(button('publish v1').disabled)
  assert.equal(calls[0].path, '/drafts/fixture-draft/publish')
  assert.deepEqual(calls[0].options.body, { expectedVersion: 1 })
  await act(async () => finish()); await flush()
  assert.equal(host.querySelector('output').textContent, edition.id)
  assert(host.textContent.includes('Published. This edition is live.'))
  assert.equal(host.querySelector('a').getAttribute('href'), '/news#daily-brief')
  assert.equal(receipts.length, 1); assert.deepEqual(busy, [true, false])
  assert.equal(JSON.parse(window.localStorage.getItem(publicationKey)).editionId, edition.id)
})

test('a lost publication response is visible inline and retry reuses the idempotency key', async t => {
  const keys = [], busy = []
  t.mock.method(globalThis, 'fetch', async () => json({ edition }))
  const api = async (_path, options) => {
    keys.push(options.idempotencyKey)
    if (keys.length === 1) throw new Error('Connection lost after sending request')
    return edition
  }
  await render(createElement(NewsPublish, { draft, api, onBusyChange: value => busy.push(value) }))
  await click('publish v1'); await click('confirm publish')
  assert(host.querySelector('[role=alert]').textContent.includes('Connection lost'))
  assert(!host.querySelector('a'))
  await click('retry publication')
  assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]); assert(keys[0].length >= 8)
  assert.deepEqual(busy, [true, false, true, false])
  assert(host.textContent.includes('This edition is live'))
})

test('a failed public read cannot turn a successful publication into a retry prompt', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Offline') })
  let committed = 0
  await render(createElement(NewsPublish, { draft, api: async () => edition, onPublished: () => committed++ }))
  await click('publish v1'); await click('confirm publish')
  assert.equal(committed, 1)
  assert(host.textContent.includes('Published successfully. The public-page check failed'))
  assert(!button('retry publication')); assert(!button('publish v1')); assert(host.querySelector('a'))
})

test('a different latest edition is reported honestly rather than claimed live', async t => {
  t.mock.method(globalThis, 'fetch', async () => json({ edition: { id: 'another-edition' } }))
  await render(createElement(NewsPublish, { draft, api: async () => edition }))
  await click('publish v1'); await click('confirm publish')
  assert(host.textContent.includes('another edition is currently public'))
  assert(!host.textContent.includes('This edition is live'))
})

test('unsaved or already-published versions cannot initiate publication', async () => {
  let calls = 0
  const api = async () => { calls++; return edition }
  await render(createElement(NewsPublish, { draft, dirty: true, api }))
  assert(button('publish v1').disabled)
  await click('publish v1'); assert(!button('confirm publish'))
  await render(createElement(NewsPublish, { draft: { ...draft, status: 'published' }, api }))
  assert(!button('publish v1')); assert.equal(calls, 0)
})

test('admin updates the published row from the receipt without depending on overview reload', async t => {
  let overviewReads = 0, writes = 0
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === '/api/news/v1/admin/overview') {
      overviewReads++
      return json({ settings: { value: {} }, drafts: [draft], sources: [], items: [], runtime: { database: 'postgres' } })
    }
    if (url === '/api/news/v1/admin/drafts/fixture-draft/publish') {
      assert.equal(options.method, 'POST'); assert(options.headers['Idempotency-Key'])
      writes++; return json(edition)
    }
    assert.equal(url, '/api/news/v1/brief/latest'); return json({ edition })
  })
  await render(createElement(NewsAdmin, { localToken: 'fixture-owner-not-a-real-key' }))
  await click('publish v1'); await click('confirm publish')
  assert.equal(writes, 1); assert.equal(overviewReads, 1)
  assert(host.querySelector('.na-publish').textContent.includes('This edition is live'))
  assert(host.querySelector('aside').textContent.includes('published'))
  assert(button('save draft').disabled)
})

test('focus, tab visibility and cross-tab publication refresh a mounted reader without credentials', async t => {
  let latest = 'old', reads = 0
  t.mock.method(globalThis, 'fetch', async (_url, options) => { assert.equal(options.credentials, 'omit'); reads++; return json({ edition: { id: latest } }) })
  await render(createElement(Reader)); assert(host.textContent.includes('old'))
  latest = 'from-focus'; await act(async () => window.dispatchEvent(new Event('focus')))
  assert(host.textContent.includes(latest))
  latest = 'from-visibility'; await act(async () => document.dispatchEvent(new Event('visibilitychange')))
  assert(host.textContent.includes(latest))
  const before = reads
  await act(async () => window.dispatchEvent(new dom.window.StorageEvent('storage', { key: 'unrelated' })))
  assert.equal(reads, before)
  latest = 'from-other-tab'
  await act(async () => window.dispatchEvent(new dom.window.StorageEvent('storage', { key: publicationKey })))
  assert(host.textContent.includes(latest))
  await act(async () => root.unmount())
  const ended = reads; window.dispatchEvent(new Event('focus')); await flush(); assert.equal(reads, ended)
})

test('late reads cannot overwrite a newer edition and refresh failures preserve the readable edition', async t => {
  let resolveOld, calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    if (calls === 1) return new Promise(resolve => { resolveOld = resolve })
    if (calls === 2) return json({ edition })
    throw new Error('Disconnected')
  })
  await render(createElement(Reader))
  await act(async () => window.dispatchEvent(new Event('focus')))
  assert(host.textContent.includes(edition.id))
  await act(async () => resolveOld(json({ edition: { id: 'stale-response' } })))
  assert(!host.textContent.includes('stale-response'))
  await act(async () => window.dispatchEvent(new Event('focus')))
  assert(host.textContent.includes(edition.id)); assert(host.textContent.includes('refresh failed'))
})

test('brief polling runs only while visible and publication works without local storage', async t => {
  let tick, cleared = false, reads = 0
  t.mock.method(window, 'setInterval', (fn, interval) => { assert.equal(interval, 30000); tick = fn; return 9 })
  t.mock.method(window, 'clearInterval', id => { assert.equal(id, 9); cleared = true })
  t.mock.method(globalThis, 'fetch', async () => { reads++; return json({ edition: { id: String(reads) } }) })
  await render(createElement(Reader, { refreshInterval: 30000 }))
  await act(async () => tick()); assert.equal(reads, 2)
  Object.defineProperty(document, 'hidden', { configurable: true, value: true })
  await act(async () => tick()); assert.equal(reads, 2)
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  t.mock.method(dom.window.Storage.prototype, 'setItem', () => { throw new Error('Blocked storage') })
  await act(async () => announcePublication(edition.id)); assert.equal(reads, 3)
  await act(async () => root.unmount()); assert(cleared)
})
