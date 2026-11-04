import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPetHandler, createPetManager, electronExecutable, prepareRuntime, PET_PATH } from '../pet-host.js'

test('pet runtime reuses the DSH Electron files and replaces only the app folder', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-kr-pet-'))
  try {
    const dsh = join(root, 'DeepSeek Harness'), app = join(root, 'pet'), base = join(root, 'runtime')
    await mkdir(join(dsh, 'locales'), { recursive: true }); await mkdir(join(dsh, 'resources'), { recursive: true }); await mkdir(app)
    await writeFile(join(dsh, 'DeepSeek Harness.exe'), 'exe'); await writeFile(join(dsh, 'ffmpeg.dll'), 'dll')
    await writeFile(join(dsh, 'locales', 'ko.pak'), 'ko'); await writeFile(join(dsh, 'resources', 'app.asar'), 'dsh app')
    await writeFile(join(dsh, 'Uninstall DeepSeek Harness.exe'), 'un')
    await writeFile(join(app, 'main.cjs'), 'v1')
    const bin = await prepareRuntime(join(dsh, 'DeepSeek Harness.exe'), base, app)
    assert.equal(bin, join(base, 'electron', 'dsc-pet.exe'))
    assert.equal(await readFile(bin, 'utf8'), 'exe')
    assert.equal(await readFile(join(base, 'electron', 'locales', 'ko.pak'), 'utf8'), 'ko')
    assert.equal(await readFile(join(base, 'electron', 'resources', 'app', 'main.cjs'), 'utf8'), 'v1')
    // DSH 앱(app.asar)·제거 프로그램·원래 이름의 실행 파일은 가져오지 않음
    await assert.rejects(stat(join(base, 'electron', 'resources', 'app.asar')))
    await assert.rejects(stat(join(base, 'electron', 'Uninstall DeepSeek Harness.exe')))
    await assert.rejects(stat(join(base, 'electron', 'DeepSeek Harness.exe')))
    // 같은 실행 파일이면 런타임은 그대로 두고 펫 앱만 새로 넣음
    await writeFile(join(app, 'main.cjs'), 'v2')
    await prepareRuntime(join(dsh, 'DeepSeek Harness.exe'), base, app)
    assert.equal(await readFile(join(base, 'electron', 'resources', 'app', 'main.cjs'), 'utf8'), 'v2')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('pet executable comes from the DSH desktop host environment', () => {
  assert.equal(electronExecutable({ DSH_DESKTOP_NODE_EXECUTABLE: 'C:/dsh.exe' }, {}, 'node'), 'C:/dsh.exe')
  assert.equal(electronExecutable({}, { electron: '44' }, 'C:/e.exe'), 'C:/e.exe')
  assert.equal(electronExecutable({}, {}, 'node'), null)
})

test('pet manager is unsupported without Windows desktop Electron and never spawns', async () => {
  let spawned = false
  const pet = createPetManager({ assets: 'x', exe: null, platform: 'win32', spawnImpl: () => { spawned = true } })
  await pet.warm(); await pet.open({}); pet.send([['say', ['hi']]]); pet.hide()
  assert.deepEqual(pet.status(), { supported: false, state: 'none', seq: undefined, events: [] })
  assert.equal(spawned, false)
  assert.equal(createPetManager({ assets: 'x', exe: 'C:/dsh.exe', platform: 'darwin' }).status().supported, false)
})

test('pet routes reject unauthenticated requests and expose status and commands', async () => {
  const calls = []
  const pet = { status: (drain = true) => ({ supported: true, state: 'hidden', events: drain ? [{ type: 'shown' }] : [] }),
    warm: async () => calls.push('warm'), open: async (b) => calls.push(['open', b]), send: (l) => calls.push(['send', l]), hide: () => calls.push('hide') }
  let allow = false
  const server = createServer(createPetHandler(pet, () => (allow ? undefined : 401)))
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const url = 'http://127.0.0.1:' + server.address().port + PET_PATH
  try {
    assert.equal((await fetch(url + '/poll')).status, 401)
    assert.equal((await fetch(url + '/open', { method: 'POST', body: '{}' })).status, 401)
    assert.deepEqual(calls, [])
    allow = true
    assert.deepEqual(await (await fetch(url + '/poll')).json(), { supported: true, state: 'hidden', events: [{ type: 'shown' }] })
    assert.equal((await fetch(url + '/poll', { method: 'DELETE' })).status, 405)
    assert.equal((await fetch(url + '/nope', { method: 'POST', body: '{}' })).status, 404)
    const opened = await fetch(url + '/open', { method: 'POST', body: JSON.stringify({ from: { x: 1, y: 2, k: 1 }, to: { x: 3, y: 4, k: 1 } }) })
    assert.deepEqual((await opened.json()).events, [])   // POST는 쌓인 알림을 비우지 않음
    await fetch(url + '/send', { method: 'POST', body: JSON.stringify({ list: [['say', ['안녕']]] }) })
    await fetch(url + '/warm', { method: 'POST' }); await fetch(url + '/hide', { method: 'POST' })
    assert.deepEqual(calls, [['open', { from: { x: 1, y: 2, k: 1 }, to: { x: 3, y: 4, k: 1 } }], ['send', [['say', ['안녕']]]], 'warm', 'hide'])
  } finally { server.closeAllConnections(); await new Promise((r) => server.close(r)) }
})

test('pet route without a connection guard refuses everything', async () => {
  const server = createServer(createPetHandler({ status: () => ({}) }))
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  try { assert.equal((await fetch('http://127.0.0.1:' + server.address().port + PET_PATH + '/poll')).status, 503) }
  finally { server.closeAllConnections(); await new Promise((r) => server.close(r)) }
})

test('pet process exit is reported and the manager can start again', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-kr-pet-'))
  try {
    const dsh = join(root, 'dsh'), app = join(root, 'pet')
    await mkdir(dsh); await mkdir(app)
    await writeFile(join(dsh, 'DeepSeek Harness.exe'), 'exe'); await writeFile(join(app, 'main.cjs'), '')
    const children = []
    const spawnImpl = (bin, args) => { const c = new EventEmitter(); c.kill = () => c.emit('exit'); c.args = args; children.push(c); return c }
    const pet = createPetManager({ assets: 'A', exe: join(dsh, 'DeepSeek Harness.exe'), platform: 'win32', base: join(root, 'rt'), app, spawnImpl })
    await pet.warm()
    assert.equal(children.length, 1)
    assert.ok(children[0].args.some((a) => a === '--dsc-assets=A'))
    assert.equal(pet.status().state, 'starting')
    await pet.open({ seq: 3, from: { k: 1, x: 0, y: 0 }, to: { k: 1, x: 0, y: 0 } })
    children[0].emit('exit')
    // 종료 알림에는 마지막 회차 번호가 붙음 (창 안 쪽이 이전 회차 알림을 가려낼 수 있게)
    assert.deepEqual(pet.status(), { supported: true, state: 'none', seq: 3, events: [{ type: 'closed', seq: 3 }] })
    await pet.warm()
    assert.equal(children.length, 2)
    children[0].emit('exit')   // 이미 바뀐 이전 프로세스의 늦은 종료는 지금 프로세스 상태를 지우지 않음
    assert.equal(pet.status().state, 'starting')
    pet.dispose()
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('pet manager does not spawn when disposed while preparing the runtime', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-kr-pet-'))
  try {
    const dsh = join(root, 'dsh'), app = join(root, 'pet')
    await mkdir(dsh); await mkdir(app)
    await writeFile(join(dsh, 'DeepSeek Harness.exe'), 'exe'); await writeFile(join(app, 'main.cjs'), '')
    let spawned = 0
    const pet = createPetManager({ assets: 'A', exe: join(dsh, 'DeepSeek Harness.exe'), platform: 'win32', base: join(root, 'rt'), app, spawnImpl: () => { spawned++; return new EventEmitter() } })
    const warming = pet.warm()
    pet.dispose()
    await assert.rejects(warming)
    assert.equal(spawned, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})
