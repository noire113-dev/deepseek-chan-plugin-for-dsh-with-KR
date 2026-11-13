import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { connect } from 'node:net'
import { createSpeakHandler, createStateHandler } from '../../plugins/dsh-tts/src/host.js'
import { registerSpeechRoutes } from '../../plugins/dsh-tts/src/index.js'
import { normalize } from '../../plugins/dsh-tts/src/config.js'
import { apply, ASSET_PATH, AVATAR_PATH, Config, readLive, STATUS_PATH } from '../host.js'
import { AVATAR_CACHE_PATH } from '../avatar-cache.js'
import { MUTTER_KO_PATH } from '../mutter-ko.js'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPetManager, PET_PATH } from '../pet-host.js'

const response = () => ({ writeHead(code) { this.status = code }, end() { this.ended = true } })

test('both TTS handlers reject before config, cache, credentials or upstream access', async () => {
  for (const rejection of [undefined, () => 401, () => 403, () => { throw Error('unavailable') }]) {
    let reads = 0, keys = 0, hits = 0, calls = 0
    const read = () => { reads++; return normalize({ enabled: true }) }
    const deps = { rejection, cache: { get() { hits++; return Buffer.from('cached') } }, resolveApiKey() { keys++ }, fetch() { calls++ } }
    for (const handler of [createSpeakHandler(read, deps), createStateHandler(read, deps)]) {
      const res = response()
      await handler({ method: 'POST' }, res)
      assert.ok([401, 403, 503].includes(res.status)); assert.equal(res.ended, true)
    }
    assert.deepEqual([reads, keys, hits, calls], [0, 0, 0, 0])
  }
})

test('registered TTS routes require Harness auth even when disabled', async () => {
  for (const connection of [undefined, { requestRejection: () => 401 }]) {
    const routes = [], disposers = []
    registerSpeechRoutes({ connection, effect(fn) { disposers.push(fn()) }, webServer: { register(route) { routes.push(route); return () => {} } } }, () => normalize({ enabled: false }))
    for (const { handler } of routes) {
      const res = response(); await handler({ method: 'GET' }, res)
      assert.equal(res.status, connection ? 401 : 503)
    }
    disposers.forEach((fn) => fn?.())
  }
})

test('invalid TTS initialization and partial registration preserve assets and pet routes', () => {
  for (const partial of [false, true]) {
    const routes = new Map(), disposers = []
    const ctx = { effect(fn) { disposers.push(fn()) }, webServer: { register(route) {
      if (partial && route.path === '/dsh-tts/speak') throw Error('registration failed')
      routes.set(route.path, route.handler); return () => routes.delete(route.path)
    } } }
    assert.doesNotThrow(() => apply(ctx, { tts: { enabled: true, openai: { timeoutMs: partial ? 30000 : 601000 } } }, { applyIcon: async () => ({}) }))
    assert.deepEqual([...routes.keys()], [ASSET_PATH, AVATAR_PATH, AVATAR_CACHE_PATH, MUTTER_KO_PATH, STATUS_PATH, PET_PATH])
    disposers.reverse().forEach((fn) => fn?.()); assert.equal(routes.size, 0)
  }
})

test('3D model folder route requires Harness auth, follows the live setting and stays inside the folder', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-kr-avatar-'))
  try {
    await mkdir(join(root, 'model'))
    await writeFile(join(root, 'model', 'avatar.json'), '{"model":"m.fbx"}')
    await writeFile(join(root, 'secret.txt'), 'x')
    let dir = '', denied = /** @type {number | undefined} */ (401)
    const routes = new Map()
    apply({ connection: { requestRejection: () => denied }, effect(fn) { fn() }, webServer: { register(route) { routes.set(route.path, route.handler); return () => {} } } },
      { avatarModelDir: { get: () => dir } }, { applyIcon: async () => ({}) })
    const handler = routes.get(AVATAR_PATH)
    /** 경로 하나 요청해 상태 코드·본문 받기 */
    const get = async (path) => {
      const chunks = []
      const res = new (await import('node:stream')).PassThrough()
      Object.assign(res, { headersSent: false, writeHead(code) { this.status = code; this.headersSent = true } })
      res.on('data', (c) => chunks.push(c))
      await handler({ method: 'GET', url: AVATAR_PATH + path, headers: {} }, res)
      return { status: res.status, body: Buffer.concat(chunks).toString() }
    }
    dir = join(root, 'model')
    assert.equal((await get('/avatar.json')).status, 401, '인증 전에는 폴더를 읽지 않음')
    denied = undefined
    assert.equal((await get('/avatar.json')).body, '{"model":"m.fbx"}')
    assert.equal((await get('/%2e%2e%2fsecret.txt')).status, 404, '폴더 밖은 거절')
    dir = ''
    assert.equal((await get('/avatar.json')).status, 404, '설정이 비면 없음')
    assert.equal(readLive(Config({})).avatarModelDir, '')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('TTS schema bounds match normalization', () => {
  for (const [section, field, min, max] of [['openai', 'timeoutMs', 1000, 600000], ['stream', 'pcmSampleRate', 8000, 48000]]) {
    const schema = Config.dict.tts.dict[section].dict[field]
    assert.equal(schema.meta.min, min); assert.equal(schema.meta.max, max)
    for (const value of [min, max]) assert.doesNotThrow(() => normalize({ [section]: { [field]: value } }))
    for (const value of [min - 1, max + 1, min + 0.5]) assert.throws(() => normalize({ [section]: { [field]: value } }))
  }
})

const delay = (ms) => new Promise((r) => setTimeout(r, ms))
test('IPC rejects impostors, times out, bounds lines, authenticates before delivery and destroys on reset', { timeout: 5000 }, async () => {
  let launch
  const platform = process.platform === 'win32' ? 'win32' : 'darwin'
  const pet = createPetManager({ assets: 'A', platform, exe: platform === 'win32' ? 'X.exe' : '/X.app/Contents/MacOS/X', authTimeout: 80,
    prepare: async () => 'stub', spawnImpl(bin, args, opts) { const child = new EventEmitter(); child.kill = () => child.emit('exit'); launch = { args, opts, child }; return child } })
  const sockets = []
  try {
    await pet.open({ seq: 7 })
    const path = launch.args.find((a) => a.startsWith('--dsc-pipe=')).slice(11)
    const dial = async () => { const s = connect(path); s.on('error', () => {}); sockets.push(s); await once(s, 'connect'); return s }
    for (const payload of [JSON.stringify({ type: 'auth', secret: 'wrong' }) + '\n', 'x'.repeat(1024 * 1024 + 1), 'x'.repeat(1024 * 1024 + 1) + '\n', null]) {
      const s = await dial(), closed = new Promise((r) => s.once('close', r))
      let received = ''; s.on('data', (d) => { received += d })
      if (payload) s.write(payload)
      await closed; assert.equal(received, ''); assert.equal(pet.status().state, 'starting')
    }
    const s = await dial(); let received = ''; s.on('data', (d) => { received += d })
    await delay(10); assert.equal(received, '')
    const auth = JSON.stringify({ type: 'auth', secret: launch.opts.env.DSC_PET_SECRET }) + '\n'
    s.write(auth.slice(0, 20)); await delay(10); assert.equal(received, '')
    s.write(auth.slice(20) + JSON.stringify({ type: 'ready' }) + '\n')
    for (let i = 0; i < 30 && !received.includes('"open"'); i++) await delay(10)
    assert.deepEqual(received.trim().split('\n').map((line) => JSON.parse(line).type), ['avatar', 'open']); assert.equal(pet.status().state, 'hidden')
    const closed = once(s, 'close'); launch.child.emit('exit'); await closed
    assert.equal(pet.status().state, 'none')
    await pet.warm()
    const nextPath = launch.args.find((a) => a.startsWith('--dsc-pipe=')).slice(11)
    const next = connect(nextPath); sockets.push(next); next.on('error', () => {}); next.resume(); await once(next, 'connect')   // 인증 뒤 오는 3D 모델 설정은 읽어 버림 (안 읽으면 close가 오지 않음)
    next.write(JSON.stringify({ type: 'auth', secret: launch.opts.env.DSC_PET_SECRET }) + '\n')
    await delay(10)
    const ended = new Promise((r) => next.once('close', r)); next.write('x'.repeat(1024 * 1024 + 1)); await ended
  } finally { pet.dispose(); sockets.forEach((s) => s.destroy()) }
})
