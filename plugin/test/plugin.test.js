import { createRequire } from 'node:module'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
const require = createRequire(import.meta.url)
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { JSDOM } from 'jsdom'
import { apply as hostApply, createAssetHandler, ASSET_PATH } from '../host.js'

const packageName = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')).name
const bundle = await readFile(new URL('../../lib/client.js', import.meta.url), 'utf8')

function clientHarness(initial = {}, status = 'ready') {
  const dom = new JSDOM('<!doctype html><html><head></head><body data-ds-dark-theme></body></html>', { url: 'http://127.0.0.1/', runScripts: 'outside-only', pretendToBeVisual: true })
  let client, resolveModel, appDestroyed = 0, appCreated = 0
  const pending = new Promise((resolve) => { resolveModel = resolve })
  dom.window.Live2DCubismCore = {}
  dom.window.PIXI = {
    Application: class { constructor() { appCreated++ } destroy() { appDestroyed++ } },
    live2d: { Live2DModel: { from: () => pending } },
  }
  dom.window.__ModuleLoader__ = { load({ id, factory }) { assert.equal(id, packageName, 'browser module ID must match its package name'); client = factory(require) } }
  dom.window.eval(bundle)
  const languages = new Map([['en', {}], ['zh', {}]])
  const dictionaries = new Map()
  let selected = 'en'
  const subscriptions = new Set(), pages = new Map()
  let snapshot = { status, value: initial, writable: true, revision: 0 }
  const form = {
    getSnapshot: () => snapshot,
    subscribe(fn) { subscriptions.add(fn); return () => subscriptions.delete(fn) },
    update(value, status = 'ready') { snapshot = { ...snapshot, status, value, revision: snapshot.revision + 1 }; for (const fn of [...subscriptions]) fn() },
    async set(field, value) { form.update({ ...snapshot.value, [field]: value }); return true },
  }
  const ctx = () => {
    const cleanups = []
    return {
      effect(fn) { const cleanup = fn(); cleanups.push(cleanup); return cleanup },
      configForms: { get(id) { assert.equal(id, 'deepseek-harness-kr'); return form } },
      slots: {
        inject(name, fn) { assert.equal(name, 'plugins.row.config'); return fn() },
        register(definition, component) {
          pages.set(definition.key, component)
          return () => { if (pages.get(definition.key) === component) pages.delete(definition.key) }
        },
      },
      locale: {
        subscribe() { return () => {} },
        getLocale: () => ({ active: selected, locales: [...languages.keys()].map((id) => ({ id })) }),
        addLanguage({ id }) { languages.set(id, {}); return () => languages.delete(id) },
        register(ns, id, dictionary) {
          const key = ns + '/' + id
          if (dictionaries.has(key)) throw new Error('duplicate ' + key)
          dictionaries.set(key, dictionary)
          return () => dictionaries.delete(key)
        },
        setLocale(id) { selected = id },
      },
      theme: { getTheme: () => ({ active: { colorScheme: 'dark' } }) },
      dispose() { for (const cleanup of cleanups.reverse()) cleanup() },
    }
  }
  return { dom, client, ctx, languages, dictionaries, resolveModel, form, pages, get appCreated() { return appCreated }, get appDestroyed() { return appDestroyed }, get selected() { return selected } }
}

test('client registers Korean independently, mounts once, and rolls back on disable during model load', async () => {
  const h = clientHarness()
  try {
    const first = h.ctx()
    h.client.apply(first)
    assert(h.languages.has('ko'))
    assert.equal(h.selected, 'en', 'installation must not overwrite the user language')
    assert.equal(h.dictionaries.size, 54)
    assert.equal(h.dictionaries.get('settings.theme/ko')['appearance.title'], '모양')
    assert.equal(h.dom.window.document.querySelectorAll('#dsc-stage').length, 1)
    assert.equal(h.dom.window.document.querySelectorAll('link').length, 2)
    first.dispose()
    assert.equal(h.dom.window.document.querySelectorAll('#dsc-stage, #dsc-bubble, link').length, 0)
    assert.equal(h.dictionaries.size, 0)
    assert(!h.languages.has('ko'))
    assert(h.dom.window.document.body.hasAttribute('data-ds-dark-theme'))
    assert.equal(h.appDestroyed, 1)
    let modelDestroyed = 0
    h.resolveModel({ destroy() { modelDestroyed++ } })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(modelDestroyed, 1, 'late model completion must be disposed')
    assert.equal(h.dom.window.__dsc, undefined)
  } finally { h.dom.window.close() }
})

test('reinjection takes over without duplicate dictionaries or stale disposer removing the new instance', () => {
  const h = clientHarness()
  try {
    const first = h.ctx(), second = h.ctx()
    h.client.apply(first)
    h.client.apply(second)
    first.dispose()
    assert.equal(h.dom.window.document.querySelectorAll('#dsc-stage').length, 1)
    assert.equal(h.dictionaries.size, 54)
    second.dispose()
    assert.equal(h.dom.window.document.querySelectorAll('#dsc-stage').length, 0)
    assert.equal(h.dictionaries.size, 0)
  } finally { h.dom.window.close() }
})

test('a conflicting dictionary fails cleanly without removing someone else\'s language or translation', () => {
  const h = clientHarness()
  try {
    h.languages.set('ko', {})
    h.dictionaries.set('common/ko', { external: true })
    assert.throws(() => h.client.apply(h.ctx()), /duplicate/)
    assert(h.languages.has('ko'))
    assert.equal(h.dictionaries.size, 1)
    assert.equal(h.dom.window.document.querySelectorAll('link, #dsc-stage').length, 0)
  } finally { h.dom.window.close() }
})

test('Host asset route serves only its files and unregisters with the plugin', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-kr-test-'))
  let server
  try {
    await mkdir(join(root, 'assets'))
    await writeFile(join(root, 'assets', 'model.json'), '{"ok":true}')
    await writeFile(join(root, 'outside.json'), '{"secret":true}')
    server = createServer(createAssetHandler(join(root, 'assets')))
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const url = 'http://127.0.0.1:' + server.address().port
    const asset = await fetch(url + ASSET_PATH + '/model.json')
    assert.equal(asset.status, 200)
    assert.deepEqual(await asset.json(), { ok: true })
    assert.equal((await fetch(url + ASSET_PATH + '/model.json', { method: 'HEAD' })).headers.get('content-length'), '11')
    assert.equal((await fetch(url + ASSET_PATH + '/%2e%2e%2foutside.json')).status, 404)
    assert.equal((await fetch(url + ASSET_PATH + '/..%5coutside.json')).status, 404)
    assert.equal((await fetch(url + ASSET_PATH + '/model.json', { method: 'POST' })).status, 405)
    assert.equal((await fetch(url + ASSET_PATH + '/%zz')).status, 400)
    let registration, released = false, dispose
    hostApply({ effect(fn) { dispose = fn() }, webServer: { register(route) { registration = route; return () => { released = true } } } })
    assert.equal(registration.path, ASSET_PATH)
    dispose(); assert(released)
  } finally {
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) }
    assert(resolve(root).startsWith(resolve(tmpdir()) + '\\') || resolve(root).startsWith(resolve(tmpdir()) + '/'))
    await rm(root, { recursive: true, force: true })
  }
})

test('all eight combinations mount only the selected features', () => {
  for (const character of [false, true]) for (const theme of [false, true]) for (const translation of [false, true]) {
    const h = clientHarness({ character, theme, translation })
    try {
      const ctx = h.ctx(); h.client.apply(ctx)
      const doc = h.dom.window.document
      assert.equal(!!doc.querySelector('#dsc-stage'), character)
      assert.equal(!!doc.querySelector('link[href$="character.css"]'), character)
      assert.equal(!!doc.querySelector('link[href$="theme.css"]'), theme)
      assert.equal(h.languages.has('ko'), translation)
      assert.equal(h.dictionaries.size, translation ? 54 : 0)
      assert.equal(doc.body.hasAttribute('data-ds-dark-theme'), true, 'theme and character keep the app dark mode')
      assert.equal(h.pages.size, 1, 'settings remain available even when every feature is off')
      ctx.dispose()
    } finally { h.dom.window.close() }
  }
})

test('live changes preserve unrelated features and dispose character resources independently', async () => {
  const h = clientHarness()
  try {
    const ctx = h.ctx(); h.client.apply(ctx)
    const doc = h.dom.window.document, canvas = doc.querySelector('#dsc-stage')
    await h.form.set('theme', false)
    assert.equal(doc.querySelector('#dsc-stage'), canvas)
    assert(doc.body.hasAttribute('data-ds-dark-theme'))
    assert.equal(h.appDestroyed, 0)
    await h.form.set('translation', false)
    assert.equal(h.dictionaries.size, 0)
    assert.equal(doc.querySelector('#dsc-stage'), canvas)
    await h.form.set('character', false)
    assert.equal(h.appDestroyed, 1)
    assert.equal(doc.querySelectorAll('link, #dsc-stage, #dsc-bubble').length, 0)
    await h.form.set('theme', true)
    assert(!doc.querySelector('#dsc-stage'))
    assert(doc.querySelector('link[href$="theme.css"]'))
    assert.equal(h.appCreated, 1)
    await h.form.set('character', true)
    assert(doc.querySelector('#dsc-stage'))
    assert.equal(h.appCreated, 2)
    ctx.dispose()
    assert.equal(h.pages.size, 0)
  } finally { h.dom.window.close() }
})

test('stored disabled values do not flash features while configuration is loading', () => {
  const h = clientHarness(undefined, 'loading')
  try {
    const ctx = h.ctx(); h.client.apply(ctx)
    assert.equal(h.dom.window.document.querySelectorAll('link, #dsc-stage').length, 0)
    h.form.update({ character: false, theme: false, translation: false })
    assert.equal(h.appCreated, 0)
    assert.equal(h.dictionaries.size, 0)
    ctx.dispose()
  } finally { h.dom.window.close() }
})

test('plugin settings page exposes three independently checked switches', () => {
  const h = clientHarness({ character: true, theme: false, translation: false })
  try {
    const ctx = h.ctx(); h.client.apply(ctx)
    const Page = h.pages.get(packageName + '#deepseek-harness-kr')
    assert(Page)
    const html = renderToStaticMarkup(React.createElement(Page, { view: 'page' }))
    assert.equal((html.match(/role="switch"/g) || []).length, 3)
    assert.equal((html.match(/checked=""/g) || []).length, 1)
    assert.match(html, /Character and speech bubbles/)
    assert.match(html, /Pastel theme/)
    assert.match(html, /Korean language pack/)
    ctx.dispose()
  } finally { h.dom.window.close() }
})

test('core worker is registered for termination when the plugin unloads', () => {
  assert.match(bundle, /new Worker\(BASE \+ "dsc-core-worker\.js"\); \} catch \{ return; \}\s*life\.add\(\(\) => \{ try \{ w\.terminate\(\) \} catch \{\} \}\)/)
})

test('update source parsing and version comparison', () => {
  const h = clientHarness()
  const { compareVersions } = h.client.internals
  const githubSource = (spec) => { const r = h.client.internals.githubSource(spec); return r && { ...r } }
  assert.deepEqual(githubSource('git+https://github.com/noire113-dev/deepseek-harness-kr.git'), { owner: 'noire113-dev', repo: 'deepseek-harness-kr', ref: null })
  assert.deepEqual(githubSource('github:someone/fork#dev'), { owner: 'someone', repo: 'fork', ref: 'dev' })
  assert.deepEqual(githubSource('git+ssh://git@github.com/a/b.git#v1'), { owner: 'a', repo: 'b', ref: 'v1' })
  assert.equal(githubSource('C:/plugins/deepseek-harness-kr'), null)
  assert.equal(githubSource('git+file:///C:/x/y'), null)
  assert.equal(githubSource(undefined), null)
  assert(compareVersions('0.1.3', '0.1.2') > 0)
  assert(compareVersions('0.2.0', '0.1.10') > 0)
  assert.equal(compareVersions('0.1.2', '0.1.2'), 0)
  assert(compareVersions('0.1.2', '0.1.3') < 0)
  assert(compareVersions('0.1.3', '0.1.3-rc.1') > 0)
  h.dom.window.close()
})

function fakeManager({ version = '0.1.2', source = 'git+https://github.com/noire113-dev/deepseek-harness-kr.git', install, remove } = {}) {
  const calls = []
  return {
    calls,
    async listBundles() { return { ok: true, value: [{ name: 'other', version: '9.9.9' }, { name: 'deepseek-harness-kr', version, source }] } },
    async installBundle(spec, options) { calls.push(['install', spec, options]); return install ? install(spec, options, calls) : { ok: true, value: { application: 'restart-required', restartReason: 'no-hmr', changed: true } } },
    async removeBundle(name) { calls.push(['remove', name]); return remove ? remove(name) : { ok: true, value: { application: 'applied', changed: true } } },
    async waitForInstall() { return { ok: true, value: null } },
  }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const memoryStorage = () => { let v = null; return { read: () => v, write: (x) => { v = x }, clear: () => { v = null }, get value() { return v } } }
const remoteVersion = (version) => async () => ({ ok: true, status: 200, json: async () => ({ version }) })

test('updater asks for confirmation, then updates through installBundle with the installed source', async () => {
  const h = clientHarness(); after(() => h.dom.window.close())
  const { createUpdater } = h.client.internals
  const urls = []
  const updater = createUpdater({ storage: memoryStorage(), fetch: async (url) => { urls.push(url); return { ok: true, status: 200, json: async () => ({ version: '0.1.3' }) } } })
  const manager = fakeManager()
  updater.attach(manager); await settle()
  assert.deepEqual(urls, ['https://raw.githubusercontent.com/noire113-dev/deepseek-harness-kr/HEAD/package.json'])
  assert.equal(updater.getSnapshot().phase, 'available')
  assert.equal(updater.getSnapshot().current, '0.1.2')
  assert.equal(updater.getSnapshot().latest, '0.1.3')
  updater.update()
  assert.equal(updater.getSnapshot().phase, 'confirm')
  assert.equal(manager.calls.length, 0, 'nothing runs before confirmation')
  updater.cancel()
  assert.equal(updater.getSnapshot().phase, 'available')
  updater.update(); await updater.confirm()
  assert.deepEqual(manager.calls.map((c) => c[0]), ['install'])
  assert.equal(manager.calls[0][1], 'git+https://github.com/noire113-dev/deepseek-harness-kr.git')
  assert.equal(manager.calls[0][2].enabled, true)
  assert.equal(updater.getSnapshot().phase, 'restart')
  updater.update(); await updater.confirm()
  assert.equal(manager.calls.length, 1, 'no second install after the update finished')
})

test('updater removes and reinstalls when Harness refuses to reinstall an installed bundle', async () => {
  const h = clientHarness(); after(() => h.dom.window.close())
  const { createUpdater } = h.client.internals
  const storage = memoryStorage(), seen = []
  const manager = fakeManager({
    install: async (spec, options, calls) => {
      seen.push(storage.value)
      return calls.filter((c) => c[0] === 'install').length === 1
        ? { ok: true, value: { application: 'failed', error: { code: 'already-installed' } } }
        : { ok: true, value: { application: 'applied', changed: true } }
    },
  })
  const updater = createUpdater({ storage, fetch: remoteVersion('0.1.3') })
  updater.attach(manager); await settle()
  updater.update(); await updater.confirm()
  assert.deepEqual(manager.calls.map((c) => c[0]), ['install', 'remove', 'install'])
  assert.equal(manager.calls[1][1], 'deepseek-harness-kr')
  assert.equal(manager.calls[0][2].requestId, manager.calls[2][2].requestId)
  assert.equal(seen[1]?.to, '0.1.3', 'pending update is saved before the bundle is removed')
  assert.equal(storage.value, null)
  assert.equal(updater.getSnapshot().phase, 'updated')
  const stopped = createUpdater({ storage: memoryStorage(), fetch: remoteVersion('0.1.3') })
  const blocked = fakeManager({ install: async () => ({ ok: true, value: { application: 'failed', error: { code: 'already-installed' } } }), remove: async () => ({ ok: true, value: { application: 'failed', error: { code: 'stop-profile' } } }) })
  stopped.attach(blocked); await settle(); stopped.update(); await stopped.confirm()
  assert.deepEqual(blocked.calls.map((c) => c[0]), ['install', 'remove'], 'a refused removal does not reinstall')
  assert.equal(stopped.getSnapshot().phase, 'update-failed')
  assert.match(stopped.getSnapshot().error, /stop-profile/)
})

test('a reloaded plugin picks up the result of the update the previous instance started', async () => {
  const h = clientHarness(); after(() => h.dom.window.close())
  const { createUpdater } = h.client.internals
  const storage = memoryStorage()
  storage.write({ requestId: 'r1', from: '0.1.0', to: '0.1.2', source: 'x', at: Date.now() })
  const updater = createUpdater({ storage, fetch: remoteVersion('0.1.2') })
  updater.attach(fakeManager({ version: '0.1.2' })); await settle()
  assert.equal(updater.getSnapshot().phase, 'updated')
  assert.equal(updater.getSnapshot().from, '0.1.0')
  assert.equal(storage.value, null)
  const stale = memoryStorage()
  stale.write({ requestId: 'r2', from: '0.1.0', to: '0.1.2', source: 'x', at: Date.now() - 60 * 60 * 1000 })
  const later = createUpdater({ storage: stale, fetch: remoteVersion('0.1.2') })
  later.attach(fakeManager({ version: '0.1.0' })); await settle()
  assert.equal(later.getSnapshot().phase, 'available', 'an old pending record is ignored')
  assert.equal(stale.value, null)
})

test('updater reports current, unsupported, pinned, failures and a missing manager without installing', async () => {
  const h = clientHarness(); after(() => h.dom.window.close())
  const { createUpdater } = h.client.internals
  const run = async (options, manager) => { const u = createUpdater({ storage: memoryStorage(), ...options }); u.attach(manager); await settle(); return u }
  assert.equal((await run({ fetch: remoteVersion('0.1.2') }, fakeManager())).getSnapshot().phase, 'current')
  assert.equal((await run({ fetch: remoteVersion('0.1.1') }, fakeManager())).getSnapshot().phase, 'current', 'older remote is not an update')
  assert.equal((await run({ fetch: remoteVersion('9.0.0') }, fakeManager({ source: 'C:/local/deepseek-harness-kr' }))).getSnapshot().phase, 'unsupported')
  assert.equal((await run({ fetch: remoteVersion('9.0.0') }, fakeManager({ source: 'git+https://github.com/a/b.git#6675ac2616c3' }))).getSnapshot().phase, 'pinned')
  const offline = await run({ fetch: async () => ({ ok: false, status: 404 }) }, fakeManager())
  assert.equal(offline.getSnapshot().phase, 'check-failed')
  assert.match(offline.getSnapshot().error, /404/)
  const failing = await run({ fetch: remoteVersion('0.1.3') }, fakeManager({ install: async () => ({ ok: true, value: { application: 'failed', error: { code: 'network', diagnostic: 'offline' } } }) }))
  failing.update(); await failing.confirm()
  assert.equal(failing.getSnapshot().phase, 'update-failed')
  assert.match(failing.getSnapshot().error, /network: offline/)
  const none = createUpdater({ storage: memoryStorage(), fetch: remoteVersion('9.0.0') })
  await none.check(); none.update(); await none.confirm()
  assert.equal(none.getSnapshot().phase, 'unavailable')
  const detached = await run({ fetch: remoteVersion('0.1.3') }, fakeManager())
  detached.detach(); detached.update(); await detached.confirm()
  assert.equal(detached.getSnapshot().phase, 'unavailable')
})

test('settings page shows the update section and still works without the plugin manager', () => {
  const h = clientHarness({ character: true, theme: true, translation: true })
  try {
    const ctx = h.ctx(); h.client.apply(ctx)
    const Page = h.pages.get(packageName + '#deepseek-harness-kr')
    const html = renderToStaticMarkup(React.createElement(Page, { view: 'page' }))
    assert.match(html, /aria-label="Updates"/)
    assert.match(html, /Plugin manager is unavailable/)
    assert.equal((html.match(/role="switch"/g) || []).length, 3)
    ctx.dispose()
  } finally { h.dom.window.close() }
})
