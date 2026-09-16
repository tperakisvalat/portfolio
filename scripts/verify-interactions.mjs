// Source-level interaction checks. JSDOM does not perform visual/layout verification.
// Run with TPV_TEST_DEPS pointing to a directory containing a JSDOM installation.
import assert from 'node:assert/strict'
import { createRequire, Module } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const project = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const require = createRequire(`${project}/package.json`)
const testRequire = createRequire(`${process.env.TPV_TEST_DEPS || project}/package.json`)
const { JSDOM } = testRequire('jsdom')
const { build } = require('esbuild')
const { parse } = require('postcss')
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/news', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'SVGElement', 'Event', 'KeyboardEvent', 'MouseEvent', 'WheelEvent']) globalThis[key] = dom.window[key]
let reducedMotion = false
window.matchMedia = () => ({ matches: reducedMotion, addEventListener() {}, removeEventListener() {} })
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
globalThis.cancelAnimationFrame = clearTimeout
HTMLElement.prototype.scrollIntoView = function(options) { this.dataset.scrolledTo = 'true'; this.dataset.scrollBehavior = options?.behavior }
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const result = await build({
  stdin: { contents: `export {default as Home} from '${project}/src/components/WorldMap.jsx'; export {default as News} from '${project}/src/components/News.jsx'`, resolveDir: project, loader: 'jsx' },
  write: false, format: 'cjs', platform: 'node', bundle: true, jsx: 'automatic',
  plugins: [{ name: 'test-boundaries', setup(builder) {
    // Match Vite's default-import interop for this CommonJS dependency.
    builder.onResolve({ filter: /^dotted-map$/ }, () => ({ path: 'dotted-map-interop', namespace: 'interop' }))
    builder.onLoad({ filter: /.*/, namespace: 'interop' }, () => ({ contents: `const map = require('${require.resolve('dotted-map')}'); module.exports = map.default`, loader: 'js', resolveDir: project }))
    builder.onResolve({ filter: /^(react|react-dom|react-router-dom)(\/.*)?$/ }, args => ({ path: require.resolve(args.path), external: true }))
    builder.onResolve({ filter: /\.css$/ }, args => ({ path: args.path, namespace: 'empty-css' }))
    builder.onLoad({ filter: /.*/, namespace: 'empty-css' }, () => ({ contents: '', loader: 'js' }))
    builder.onResolve({ filter: /\/lib\/supabase$/ }, () => ({ path: 'pins-fixture', namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export async function fetchPins() { return [{id:'sf', name:'SF', title:'technooptimism', lat:37.77, lng:-122.4, intro:'A test introduction with [a link](https://example.com).', writing:[{title:'A project',url:'https://example.com/project'}], questions:['What becomes possible?'], read:[{title:'Book',author:'Writer'}], toRead:[{title:'Next book',author:'Author'}]}] }`, loader: 'js' }))
  } }],
})
const compiled = new Module(`${project}/interaction-test.cjs`)
compiled.paths = require.resolve.paths('react')
compiled._compile(result.outputFiles[0].text, `${project}/interaction-test.cjs`)
const { Home, News } = compiled.exports
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { MemoryRouter, useLocation, useNavigate } = require('react-router-dom')
const root = createRoot(document.getElementById('root'))
const click = async node => { assert.ok(node, 'Click target exists'); await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }
const wheel = async (node, deltaY) => act(() => node.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true })))
const activeStop = () => document.querySelector('.story-route [aria-current="step"]')?.textContent
const results = []

// Check the actual CSS timing contract, not just the route orchestration.
const transitionCss = readFileSync(`${project}/src/components/News.css`, 'utf8')
const css = parse(transitionCss)
const animationFor = selector => {
  const rule = css.nodes.find(node => node.type === 'rule' && node.selector === selector && node.nodes.some(declaration => declaration.prop === 'animation'))
  assert.ok(rule, `Transition animation exists: ${selector}`)
  return rule.nodes.find(declaration => declaration.prop === 'animation').value
}
const times = value => (value.match(/[\d.]+m?s\b/g) || []).map(time => parseFloat(time) * (time.endsWith('ms') ? 1 : 1000))
const outgoing = animationFor('html[data-news-motion]::view-transition-old(news-explorer)')
const incoming = animationFor('html[data-news-motion]::view-transition-new(news-explorer)')
const [exitDuration] = times(outgoing)
const [, entryDelay] = times(incoming)
assert.ok(entryDelay > exitDuration, 'New page must not appear until the old page is fully gone')
assert.match(outgoing, /both/, 'Old snapshot must stay invisible after exit')
assert.match(incoming, /both/, 'New snapshot must stay invisible during its delay')
for (const name of ['explorer-clear', 'explorer-unfold', 'explorer-return']) {
  const frames = css.nodes.find(node => node.type === 'atrule' && node.name === 'keyframes' && node.params === name)
  assert.ok(frames)
  const hiddenFrame = frames.nodes.find(node => node.selector === (name === 'explorer-clear' ? 'to' : 'from'))
  assert.equal(hiddenFrame.nodes.find(node => node.prop === 'opacity').value, '0')
  frames.walkDecls(declaration => assert.ok(!['transform', 'filter'].includes(declaration.prop), 'Page transitions must not scale or blur text'))
}
assert.ok(!transitionCss.includes('news-focus'), 'Headings remain part of the page instead of independent snapshot layers')
results.push('Transition CSS: old page disappears before new page enters; no floating titles, scaling or blur.')

await act(async () => root.render(React.createElement(Home)))
assert.match(activeStop(), /start/)
const stage = document.querySelector('.story-stage')
await wheel(stage, 2500)
assert.match(activeStop(), /madrid/)
await act(() => { for (let i = 0; i < 35; i++) stage.dispatchEvent(new WheelEvent('wheel', { deltaY: 2500, bubbles: true, cancelable: true })) })
assert.match(activeStop(), /madrid/, 'Fast wheel events must not truncate the scene')
await act(async () => { await new Promise(resolve => setTimeout(resolve, 1900)) })
await wheel(stage, 300)
assert.match(activeStop(), /origins/, 'A later gesture advances exactly one scene')
results.push('Home: large/repeated wheel gestures advance one scene; next gesture works after animation.')

await click(document.querySelector('.final-stop'))
assert.match(activeStop(), /map/)
const pin = document.querySelector('.explore-pin-group')
assert.ok(pin, 'Full map has an accessible idea pin')
assert.equal(document.querySelector('.explore-pin-group text'), null, 'The final map has no visible city labels')
assert.match(pin.getAttribute('aria-label'), /technooptimism/, 'Pins keep their accessible names')
await act(() => pin.focus())
await click(pin)
assert.ok(document.querySelector('[role="dialog"]'))
assert.equal(document.activeElement.className, 'pin-page-back')
const page = document.querySelector('.pin-page-scroller')
Object.defineProperty(page, 'scrollHeight', { value: 1800, configurable: true })
Object.defineProperty(page, 'clientHeight', { value: 800, configurable: true })
await act(() => { page.scrollTop = 500; page.dispatchEvent(new Event('scroll', { bubbles: true })) })
assert.match(document.querySelector('.pin-page-top').textContent, /50%/)
await click([...document.querySelectorAll('.pin-page-toolbar nav button')].find(button => button.textContent === 'read'))
assert.equal(document.querySelector('#pin-read').dataset.scrolledTo, 'true')
await act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
assert.equal(document.querySelector('[role="dialog"]'), null)
assert.equal(document.activeElement, pin, 'Closing restores focus to the originating map pin')
results.push('Home: final stop skips immediately; pin opens, section jumps and progress work, Escape returns focus.')

function RouteProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  return React.createElement(React.Fragment, null, React.createElement('output', { id: 'route' }, location.search), React.createElement('button', { id: 'history-back', onClick: () => navigate(-1) }, 'History back'))
}
await act(() => root.render(React.createElement(MemoryRouter, { initialEntries: ['/news'] }, React.createElement(News), React.createElement(RouteProbe))))
assert.equal(document.querySelectorAll('.n3-theme-door').length, 4)
assert.equal(document.querySelectorAll('.n3-stories article').length, 8)
assert.equal(document.querySelectorAll('.n2-daily-section').length, 4)
assert.ok(document.querySelector('#news-themes').compareDocumentPosition(document.querySelector('#daily-brief')) & 4)
const mainLinks = [...document.querySelectorAll('.header-right a')]
assert.deepEqual(mainLinks.map(link => link.textContent.replace('↗', '').trim()), ['news', 'personal', 'substack', 'linkedin'])
assert.match(mainLinks[1].href, /1w6CIFAsuYbnXb_Xj_Mvr4cKZcjGndOvN9j_9TREBDgo/)
const reader = document.querySelector('.news-reader')
await act(() => { reader.scrollTop = 650; reader.dispatchEvent(new Event('scroll')) })
await click(document.querySelector('.theme-business'))
assert.equal(document.querySelector('#route').textContent, '?theme=business')
assert.equal(reader.scrollTop, 0)
await click([...document.querySelectorAll('.n2-business-choice button')].find(button => button.textContent.includes('industries')))
assert.match(document.querySelector('#route').textContent, /view=industries/)
await act(() => { reader.scrollTop = 180; reader.dispatchEvent(new Event('scroll')) })
await click(document.querySelector('.n2-industry-map .energy'))
assert.match(document.querySelector('#route').textContent, /reading=energy/)
assert.ok(document.querySelector('.n2-reading-list a[href="https://www.iea.org/reports/world-energy-outlook-2025"]'))
await click(document.querySelector('.n3-navigation button'))
assert.ok(document.querySelector('.n2-industry-map'))
assert.equal(reader.scrollTop, 180)
await click(document.querySelector('.n3-navigation button'))
await click(document.querySelector('.n3-navigation button'))
assert.equal(reader.scrollTop, 650)
await click(document.querySelector('.theme-tech'))
await click(document.querySelector('#history-back'))
assert.ok(document.querySelector('.n2-theme-grid'), 'Browser history returns to themes')
await click(document.querySelector('.theme-politics'))
await act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
assert.ok(document.querySelector('.n2-theme-grid'))
await click(document.querySelector('.n3-brief-cue'))
assert.equal(document.querySelector('#daily-brief').dataset.scrolledTo, 'true')
results.push('News: themes above eight stories; links, history, Escape, brief jump and scroll restoration work.')

// Exercise native transition orchestration without pretending to render snapshots.
const nativeTransitions = []
document.startViewTransition = update => {
  let finish
  const transition = {
    skipped: false,
    finished: new Promise(resolve => { finish = resolve }),
    finish: () => finish(),
    skipTransition() { this.skipped = true; finish() },
  }
  transition.updateCallbackDone = Promise.resolve().then(update)
  transition.ready = transition.updateCallbackDone
  nativeTransitions.push(transition)
  return transition
}
const originalRect = HTMLElement.prototype.getBoundingClientRect
const pageTransitionsEnabled = /const PAGE_TRANSITIONS_ENABLED = true/.test(readFileSync(`${project}/src/lib/useNewsTransition.js`, 'utf8'))
if (pageTransitionsEnabled) {
HTMLElement.prototype.getBoundingClientRect = function() {
  if (this.classList.contains('news-reader')) return { left: 0, top: 0, width: 1200, height: 900 }
  if (this.dataset.newsNode === 'theme-business') return { left: 600, top: 430, right: 1150, bottom: 680, width: 550, height: 250 }
  return originalRect.call(this)
}
await click(document.querySelector('.theme-business'))
assert.equal(document.documentElement.dataset.newsMotion, 'in')
assert.equal(document.documentElement.style.getPropertyValue('--news-aperture'), 'inset(430px 50px 220px 600px)')
assert.equal(document.querySelector('.n2-business-choice h1').style.viewTransitionName, '', 'The heading is not lifted into a separate snapshot')
await click(document.querySelector('[data-news-node="view-industries"]'))
assert.equal(nativeTransitions[0].skipped, true, 'A second click skips the previous animation')
assert.match(document.querySelector('#route').textContent, /view=industries/)
await act(() => nativeTransitions.at(-1).finish())
assert.equal(document.documentElement.dataset.newsMotion, undefined)
await click(document.querySelector('.n3-navigation button'))
await act(() => nativeTransitions.at(-1).finish())
await click(document.querySelector('.n3-navigation button'))
assert.equal(document.documentElement.dataset.newsMotion, 'out')
assert.equal(document.documentElement.style.getPropertyValue('--news-aperture'), '', 'Back does not fold into a potentially offscreen tile')
assert.equal(document.querySelector('.theme-business h2').style.viewTransitionName, '')
assert.equal(document.activeElement, document.querySelector('.theme-business'), 'Returning restores keyboard focus to the originating tile')
await act(() => nativeTransitions.at(-1).finish())
assert.equal(document.querySelector('.theme-business h2').style.viewTransitionName, '')
assert.equal(document.documentElement.style.getPropertyValue('--news-aperture'), '')
// Two requests before the first snapshot must not commit an obsolete route.
await act(async () => {
  document.querySelector('.theme-macro').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  document.querySelector('.theme-tech').dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
assert.equal(document.querySelector('#route').textContent, '?theme=tech')
assert.equal(nativeTransitions.at(-2).skipped, true)
await act(() => nativeTransitions.at(-1).finish())
await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
assert.equal(document.documentElement.dataset.newsMotion, 'out', 'Escape follows the same return transition')
await act(() => nativeTransitions.at(-1).finish())
await click(document.querySelector('.theme-business'))
await click(document.querySelector('#history-back'))
assert.ok(document.querySelector('.n2-theme-grid'))
assert.equal(nativeTransitions.at(-1).skipped, true, 'Browser back cancels an in-flight snapshot')
assert.equal(document.documentElement.dataset.newsMotion, undefined)
await click(document.querySelector('.theme-macro'))
await act(() => nativeTransitions.at(-1).finish())
await click(document.querySelector('.n3-navigation button:last-of-type'))
assert.equal(document.querySelector('#daily-brief').dataset.scrollBehavior, 'instant', 'Cross-page brief jumps settle before the destination snapshot')
await act(() => nativeTransitions.at(-1).finish())
results.push('News motion: forward geometry, clean back path, focus, cancellation and rapid clicks pass.')
HTMLElement.prototype.getBoundingClientRect = originalRect
} else {
  const originalAnimate = HTMLElement.prototype.animate
  let animationCount = 0
  HTMLElement.prototype.animate = () => { animationCount++; return { cancel() {} } }
  await click(document.querySelector('.theme-business'))
  assert.ok(document.querySelector('.n2-business-choice'))
  await click(document.querySelector('[data-news-node="view-industries"]'))
  await click(document.querySelector('[data-news-node="reading-energy"]'))
  assert.ok(document.querySelector('.n2-reading'))
  await click(document.querySelector('.n3-navigation button'))
  await click(document.querySelector('.n3-navigation button'))
  await click(document.querySelector('.n3-navigation button'))
  assert.ok(document.querySelector('.n2-theme-grid'))
  await click(document.querySelector('.theme-politics'))
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  assert.ok(document.querySelector('.n2-theme-grid'))
  await click(document.querySelector('.theme-tech'))
  await click(document.querySelector('#history-back'))
  assert.ok(document.querySelector('.n2-theme-grid'))
  assert.equal(nativeTransitions.length, 0, 'Plain navigation never starts native snapshots')
  assert.equal(animationCount, 0, 'Plain navigation never starts fallback animations')
  assert.equal(document.documentElement.dataset.newsMotion, undefined)
  HTMLElement.prototype.animate = originalAnimate
  results.push('Plain navigation: forward, back, Escape and browser history work without any page animation.')
}

reducedMotion = true
await click(document.querySelector('.theme-politics'))
await act(() => root.render(null))
if (pageTransitionsEnabled) assert.equal(nativeTransitions.at(-1).skipped, true, 'Leaving News cleans up an active transition')
assert.equal(document.documentElement.dataset.newsMotion, undefined)
const transitionCount = nativeTransitions.length
await act(() => root.render(React.createElement(MemoryRouter, { initialEntries: ['/news'] }, React.createElement(News))))
await click(document.querySelector('.theme-business'))
assert.ok(document.querySelector('.n2-business-choice'))
assert.equal(nativeTransitions.length, transitionCount, 'Reduced motion bypasses native transitions')
assert.equal(document.documentElement.dataset.newsMotion, undefined)
results.push('News reduced motion: navigation stays immediate; no snapshot animation starts.')
delete document.startViewTransition
await act(async () => root.render(React.createElement(Home)))
await click(document.querySelectorAll('.story-route-stops button')[1])
assert.match(document.querySelector('.terminal-text').textContent, /born in/)
assert.equal(document.querySelector('.map-dot.animating'), null)
results.push('Reduced motion: scene text appears immediately without animated dots.')
await act(() => root.unmount())
console.log(results.map(result => `PASS ${result}`).join('\n'))
