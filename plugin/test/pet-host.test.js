import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { lstat, mkdtemp, mkdir, readdir, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { createEndpoint, createPetHandler, createPetManager, electronExecutable, lowerPriority, macBundle, prepareRuntime, restorePriority, PET_PATH } from '../pet-host.js'

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
    const spawnImpl = (bin, args, opts) => { const c = new EventEmitter(); c.kill = () => c.emit('exit'); c.args = args; c.opts = opts; children.push(c); return c }
    const pet = createPetManager({ assets: 'A', exe: join(dsh, 'DeepSeek Harness.exe'), platform: 'win32', base: join(root, 'rt'), app, spawnImpl })
    await pet.warm()
    assert.equal(children.length, 1)
    assert.ok(children[0].args.some((a) => a === '--dsc-assets=A'))
    assert.equal(children[0].opts.windowsHide, false)
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

// ---------- macOS ----------
const posixOnly = { skip: process.platform === 'win32' && 'unix 소켓은 POSIX 에서만 시험' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const exists = (path) => stat(path).then(() => true, () => false)

/** 가짜 DSH.app: 실행 파일 스텁, 서명된 Frameworks, 큰 리소스(app.asar·runtime) */
async function fakeDshApp(root) {
  const app = join(root, 'DeepSeek Harness.app'), contents = join(app, 'Contents')
  await mkdir(join(contents, 'MacOS'), { recursive: true }); await mkdir(join(contents, 'Resources', 'runtime'), { recursive: true })
  await mkdir(join(contents, 'Frameworks', 'Electron Framework.framework', 'Versions', 'A'), { recursive: true })
  await writeFile(join(contents, 'MacOS', 'DeepSeek Harness'), 'stub')
  await writeFile(join(contents, 'Frameworks', 'Electron Framework.framework', 'Versions', 'A', 'Electron Framework'), 'framework')
  await symlink('Versions/A/Electron Framework', join(contents, 'Frameworks', 'Electron Framework.framework', 'Electron Framework'))
  await writeFile(join(contents, 'Info.plist'), 'plist'); await writeFile(join(contents, 'PkgInfo'), 'APPL????')
  await writeFile(join(contents, 'Resources', 'icon.icns'), 'icon'); await writeFile(join(contents, 'Resources', 'app.asar'), 'dsh app')
  await writeFile(join(contents, 'Resources', 'runtime', 'big.bin'), 'runtime')
  return join(contents, 'MacOS', 'DeepSeek Harness')
}

/** 실제 /bin/cp 는 쓰되(클론 옵션만 뺌) plutil·xattr·codesign 은 호출만 기록하는 실행기 */
function recorder({ failClone = false, failRemove = false } = {}) {
  const calls = [], runner = async (cmd, args) => {
    calls.push([cmd, ...args])
    if (cmd === '/bin/cp') {
      if (failClone && args[0] === '-cR') throw new Error('clone unsupported')
      await promisify(execFile)('/bin/cp', ['-R', ...args.slice(1)])
    }
    if (failRemove && args[0] === '-remove') throw new Error('No value at that key path')
  }
  return { calls, runner }
}

test('macBundle recognizes only executables inside an .app bundle', () => {
  assert.equal(macBundle('/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness'), '/Applications/DeepSeek Harness.app')
  assert.equal(macBundle('C:/Users/me/AppData/Local/Programs/DeepSeek Harness/DeepSeek Harness.exe'), null)
  assert.equal(macBundle('/usr/local/bin/node'), null)
  assert.equal(macBundle(null), null)
})

test('pet manager supports darwin only for an .app bundle executable', () => {
  const bundleExe = '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness'
  assert.equal(createPetManager({ assets: 'x', exe: bundleExe, platform: 'darwin' }).status().supported, true)
  assert.equal(createPetManager({ assets: 'x', exe: '/usr/local/bin/node', platform: 'darwin' }).status().supported, false)
  assert.equal(createPetManager({ assets: 'x', exe: null, platform: 'darwin' }).status().supported, false)
  assert.equal(createPetManager({ assets: 'x', exe: bundleExe, platform: 'linux' }).status().supported, false)
  assert.equal(createPetManager({ assets: 'x', exe: 'C:/dsh.exe', platform: 'win32' }).status().supported, true)
})

test('mac pet runtime clones a small ad-hoc signed bundle and keeps the pet app outside the signature', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-kr-pet-'))
  try {
    const exe = await fakeDshApp(root), app = join(root, 'pet'), base = join(root, 'runtime'), out = join(base, 'electron', 'DeepSeekChanPet.app')
    await mkdir(app); await writeFile(join(app, 'main.cjs'), 'v1')
    const { calls, runner } = recorder({ failRemove: true })
    const bin = await prepareRuntime(exe, base, app, runner)
    assert.equal(bin, join(out, 'Contents', 'MacOS', 'DeepSeek Harness'))
    assert.equal(await readFile(bin, 'utf8'), 'stub')
    assert.equal(await readFile(join(out, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Versions', 'A', 'Electron Framework'), 'utf8'), 'framework')
    assert.equal((await lstat(join(out, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Electron Framework'))).isSymbolicLink(), true)
    assert.equal(await readFile(join(out, 'Contents', 'Resources', 'icon.icns'), 'utf8'), 'icon')
    // 큰 리소스(app.asar·runtime)와 원래 앱은 가져오지 않음, 스텁은 고정 package.json (펫 앱을 .app 밖에서 불러옴)
    assert.equal(await exists(join(out, 'Contents', 'Resources', 'app.asar')), false)
    assert.equal(await exists(join(out, 'Contents', 'Resources', 'runtime')), false)
    const stub = JSON.parse(await readFile(join(out, 'Contents', 'Resources', 'app', 'package.json'), 'utf8'))
    assert.equal(join(out, 'Contents', 'Resources', 'app', stub.main), join(base, 'electron', 'pet-app', 'main.cjs'))
    assert.equal(await readFile(join(base, 'electron', 'pet-app', 'main.cjs'), 'utf8'), 'v1')
    // Info.plist 수정(없는 키 제거 오류는 무시) 뒤 사본만 서명. 서명이 마지막
    const plist = join(out, 'Contents', 'Info.plist')
    assert.deepEqual(calls.filter(([cmd]) => cmd !== '/bin/cp'), [
      ['/usr/bin/plutil', '-replace', 'CFBundleIdentifier', '-string', 'com.deepseek.dsh.dsc-pet', plist],
      ['/usr/bin/plutil', '-replace', 'LSUIElement', '-bool', 'true', plist],
      ['/usr/bin/plutil', '-remove', 'ElectronAsarIntegrity', plist],
      ['/usr/bin/plutil', '-remove', 'CFBundleURLTypes', plist],
      ['/usr/bin/xattr', '-dr', 'com.apple.quarantine', out],
      ['/usr/bin/codesign', '--force', '-s', '-', out],
    ])
    assert.ok(calls.filter(([cmd]) => cmd === '/bin/cp').every(([, flag]) => flag === '-cR'))
    // 원본 앱은 건드리지 않음 (plist 내용 그대로)
    assert.equal(await readFile(join(dirname(dirname(exe)), 'Info.plist'), 'utf8'), 'plist')
    // 같은 실행 파일이면 .app 은 그대로(다시 서명 안 함), 펫 앱만 새로 넣음
    await writeFile(join(app, 'main.cjs'), 'v2')
    const again = recorder()
    await prepareRuntime(exe, base, app, again.runner)
    assert.deepEqual(again.calls, [])
    assert.equal(await readFile(join(base, 'electron', 'pet-app', 'main.cjs'), 'utf8'), 'v2')
    // DSH 가 업데이트되어 실행 파일이 바뀌면 처음부터 다시 만듦
    await utimes(exe, new Date(), new Date(Date.now() + 5000))
    const rebuilt = recorder()
    await prepareRuntime(exe, base, app, rebuilt.runner)
    assert.ok(rebuilt.calls.some(([cmd]) => cmd === '/usr/bin/codesign'))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('mac pet runtime falls back to a plain copy when APFS clone is unavailable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-kr-pet-'))
  try {
    const exe = await fakeDshApp(root), app = join(root, 'pet')
    await mkdir(app); await writeFile(join(app, 'main.cjs'), '')
    const { calls, runner } = recorder({ failClone: true })
    const bin = await prepareRuntime(exe, join(root, 'runtime'), app, runner)
    assert.equal(await readFile(bin, 'utf8'), 'stub')
    assert.ok(calls.some(([cmd, flag]) => cmd === '/bin/cp' && flag === '-R'))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('mac pet runtime stops at a failed signature and does not leave a stamp', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-kr-pet-'))
  try {
    const exe = await fakeDshApp(root), app = join(root, 'pet'), base = join(root, 'runtime')
    await mkdir(app)
    const runner = async (cmd, args) => { if (cmd === '/usr/bin/codesign') throw new Error('codesign failed'); if (cmd === '/bin/cp') await promisify(execFile)('/bin/cp', ['-R', ...args.slice(1)]) }
    await assert.rejects(prepareRuntime(exe, base, app, runner), /codesign failed/)
    assert.equal(await exists(join(base, 'electron', 'dsc-pet.stamp')), false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('pet endpoint is a named pipe on Windows and a short private unix socket path elsewhere', async () => {
  const pipe = await createEndpoint('win32')
  assert.match(pipe.path, /^\\\\\.\\pipe\\dsc-pet-\d+-[0-9a-f-]{36}$/)
  await pipe.cleanup()
  const unix = await createEndpoint('darwin')
  try {
    assert.ok(Buffer.byteLength(unix.path) < 104)
    assert.equal((await stat(dirname(unix.path))).mode & 0o777, 0o700)
  } finally { await unix.cleanup() }
  assert.equal(await exists(dirname(unix.path)), false)
  const long = await createEndpoint('darwin', '/tmp/' + 'x'.repeat(90).replace(/x/g, 'a'))
  assert.ok(long.path.startsWith('/tmp/dsc-pet-') && Buffer.byteLength(long.path) < 104)   // tmp 경로가 길면 /tmp 로 대신
  await long.cleanup()
})

test('mac pet process gets a unix socket, accepts one connection and cleans up on exit', posixOnly, async () => {
  const launches = []
  const spawnImpl = (bin, args, opts) => { const c = new EventEmitter(); c.kill = () => c.emit('exit'); launches.push({ bin, args, opts, c }); return c }
  const exe = '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness'
  const pet = createPetManager({ assets: 'A', exe, platform: 'darwin', base: 'B', app: 'P', spawnImpl, prepare: async (e, b, a) => { assert.deepEqual([e, b, a], [exe, 'B', 'P']); return '/pet/bin' } })
  const old = { ...process.env }; process.env.ELECTRON_RUN_AS_NODE = '1'; process.env.__CFBundleIdentifier = 'com.deepseek.dsh'
  try { await pet.warm() } finally { process.env = old }
  const [{ bin, args, opts, c }] = launches
  assert.equal(bin, '/pet/bin')   // 펫은 직접 띄우고 우선순위는 띄운 뒤 -p 로 낮춤 (시작부터 건 백그라운드는 풀리지 않음)
  const sockPath = args.find((a) => a.startsWith('--dsc-pipe=')).slice('--dsc-pipe='.length)
  assert.ok(args.includes('--dsc-assets=A'))
  assert.equal(opts.stdio, 'ignore'); assert.equal('windowsHide' in opts, false)
  for (const key of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', '__CFBundleIdentifier']) assert.equal(key in opts.env, false)
  // 펫이 연결해 ready 를 보내면 hidden, 호스트가 보내는 open 은 한 줄 JSON 으로 도착
  const socket = connect(sockPath); await once(socket, 'connect')
  const received = []; socket.setEncoding('utf8'); socket.on('data', (d) => received.push(d))
  socket.write(JSON.stringify({ type: 'ready' }) + '\n'); await sleep(100)
  assert.equal(pet.status().state, 'hidden')
  await pet.open({ seq: 2, from: { k: 1, x: 1, y: 2 }, to: { k: 1, x: 3, y: 4 } }); await sleep(100)
  assert.deepEqual(JSON.parse(received.join('').trim()), { type: 'open', from: { k: 1, x: 1, y: 2 }, to: { k: 1, x: 3, y: 4 }, follow: false, seq: 2 })
  // 따라오기: 커서가 몸을 잡은 자리(grab)도 그대로 전달해야 펫 창에서 잡은 위치가 유지됨
  received.length = 0
  await pet.open({ seq: 3, from: { k: 1, x: 1, y: 2 }, to: { k: 1, x: 1, y: 2 }, follow: true, grab: { x: 136, y: 146 } }); await sleep(100)
  assert.deepEqual(JSON.parse(received.join('').trim()).grab, { x: 136, y: 146 })
  // 붙은 뒤에는 소켓이 닫혀 다른 프로세스는 연결할 수 없음
  const late = connect(sockPath); await once(late, 'error')
  socket.destroy(); c.emit('exit'); await sleep(50)
  assert.equal(await exists(dirname(sockPath)), false)
  assert.deepEqual(pet.status().events.map((e) => e.type), ['closed'])
})

test('mac pet runtime is removed when disposed while preparing', posixOnly, async () => {
  let release
  const before = new Set(await socketDirs())
  const prepare = () => new Promise((resolve) => { release = resolve })
  const pet = createPetManager({ assets: 'A', exe: '/Applications/X.app/Contents/MacOS/X', platform: 'darwin', prepare, spawnImpl: () => { throw new Error('should not spawn') } })
  const warming = pet.warm()
  while (!release) await sleep(10)
  const [sockDir] = (await socketDirs()).filter((dir) => !before.has(dir))
  assert.equal(await exists(sockDir), true)
  pet.dispose(); release('/pet/bin')
  await assert.rejects(warming)
  await sleep(50)
  assert.equal(await exists(sockDir), false)
})

async function socketDirs() {
  return (await readdir(tmpdir())).filter((n) => n.startsWith('dsc-pet-')).map((n) => join(tmpdir(), n))
}

test('펫 페이지와 assets는 한 출처(dscpet://assets)라 Core 계산 Worker를 만들 수 있다', async () => {
  const html = await readFile(new URL('../../pet/index.html', import.meta.url), 'utf8')
  const main = await readFile(new URL('../../pet/main.cjs', import.meta.url), 'utf8')
  assert.ok(!html.includes('dscpet://'), '페이지가 다른 출처(dscpet://app)를 가리키면 Worker 생성이 SecurityError로 막힌다')
  assert.match(main, /loadURL\(`dscpet:\/\/assets\$\{OWN\}\/index\.html`\)/)
})

test('펫 창이 숨으면 페이지에 그리기 중지를 알리고, 페이지는 그리기를 멈춘 채 대기한다', async () => {
  const main = await readFile(new URL('../../pet/main.cjs', import.meta.url), 'utf8')
  const dsc = await readFile(new URL('../../assets/dsc.js', import.meta.url), 'utf8')
  assert.match(main, /toPage\(\{ type: 'power', on: false \}\)/)
  assert.match(dsc, /m\.type === "power"/)
  assert.match(dsc, /처음엔 숨은 채 대기/)
})

test('펫 창 따라오기: 커서는 펫 프로세스가 직접 읽어 페이지로 보내고, 창 안 캐릭터는 위치를 HTTP로 보내지 않는다', async () => {
  const main = await readFile(new URL('../../pet/main.cjs', import.meta.url), 'utf8')
  const dsc = await readFile(new URL('../../assets/dsc.js', import.meta.url), 'utf8')
  assert.match(main, /case 'track': track\(!!message\.on, message\.grab, message\.off\)/)
  assert.match(main, /win\.setPosition\([^\n]*\) \| 0[\s\S]*toPage\(\{ type: 'cursor'/)   // 창은 커서를 읽는 즉시 여기서 옮김 (페이지 왕복 없음)
  assert.match(dsc, /petTracking/)   // 따라오는 동안 페이지는 창을 옮기지 않음
  assert.match(main, /screen\.getCursorScreenPoint\(\)[\s\S]*toPage\(\{ type: 'cursor'/)
  assert.match(dsc, /grab: \{ x: drag\.pending\?\.ox \?\? 0/)
  assert.ok(!dsc.includes('["follow", item]'), '따라오는 동안 위치를 HTTP로 보내면 왕복 지연만큼 끊긴다')
})

test('lowerPriority: 띄운 프로세스를 -b -p 로 낮추고, 실패해도 던지지 않는다', async () => {
  const calls = []
  await lowerPriority(42, async (cmd, args) => { calls.push([cmd, ...args]) })
  assert.deepEqual(calls, [['/usr/sbin/taskpolicy', '-b', '-p', '42']])
  await lowerPriority(42, async () => { throw new Error('nope') })
})

test('restorePriority: 주 프로세스와 자식의 백그라운드를 풀고, 실패해도 던지지 않는다', async () => {
  const calls = []
  const runner = async (cmd, args) => { calls.push([cmd, ...args]); if (cmd === '/usr/bin/pgrep') return { stdout: '11\n12\n' }; if (args[2] === '12') throw new Error('gone'); return { stdout: '' } }
  await restorePriority(10, runner)
  assert.deepEqual(calls.filter((c) => c[0] === '/usr/sbin/taskpolicy').map((c) => c[3]).sort(), ['10', '11', '12'])
  await restorePriority(10, async () => { throw new Error('nope') })
})

test('웜업: 시작 인사·작업 중에는 미루고 한가할 때 숨긴 펫을 미리 띄운다', async () => {
  const dsc = await readFile(new URL('../../assets/dsc.js', import.meta.url), 'utf8')
  assert.match(dsc, /const warmUp = \(tries = 0\) => \{[\s\S]*intro\.phase !== "done" \|\| running \|\| document\.hidden[\s\S]*linkPost\("warm"\)/)
  assert.match(dsc, /setTimeout\(warmUp, 5000\)/)
})
