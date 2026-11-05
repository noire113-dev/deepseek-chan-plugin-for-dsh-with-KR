// 바깥 펫 창: DSH 데스크톱의 Electron 실행 파일을 다시 써서 투명한 펫 창 프로세스를 띄우고, 창 안 캐릭터와 메시지를 이어 준다.
// - 런타임(Windows): DSH 설치 폴더 파일을 하드링크(같은 드라이브면 디스크 0)로 묶고 resources/app 에 펫 앱(../pet/)만 넣는다.
//   (DSH Electron은 OnlyLoadAppFromAsar·asar 무결성 검사 fuse가 꺼져 있어 resources/app 폴더 앱을 불러온다)
// - 런타임(macOS): DSH.app 의 MacOS·Frameworks 를 APFS clone(cp -c, 디스크 0)으로 복제한 작은 .app 을 만들고, Info.plist 를 고쳐(번들 ID·LSUIElement)
//   복사본만 ad-hoc 재서명한다. resources/app 은 고정 스텁(package.json 의 main 이 펫 앱을 가리킴)이라 펫 앱을 바꿔도 서명이 깨지지 않는다.
// - 연결: 창 안 캐릭터 ↔ 호스트 = DSH 웹 서버의 /deepseek-harness-kr/pet/*,
//   호스트 ↔ 펫 프로세스 = Windows 이름 있는 파이프 · macOS unix 소켓 (JSON 한 줄씩)
import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFile, link, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

export const PET_PATH = '/deepseek-harness-kr/pet'
const PET_APP = fileURLToPath(new URL('../pet/', import.meta.url))
const PET_EXE = 'dsc-pet.exe'

/** 펫 창에 쓸 Electron 실행 파일. DSH 데스크톱은 호스트를 자기 실행 파일의 Node 모드로 띄우며 경로를 넘겨 준다. */
export function electronExecutable(env = process.env, versions = process.versions, execPath = process.execPath) {
  return env.DSH_DESKTOP_NODE_EXECUTABLE || (versions.electron ? execPath : null)
}

const linkOrCopy = async (from, to) => { try { await link(from, to) } catch { await copyFile(from, to) } }

async function mirror(from, to, skip) {
  await mkdir(to, { recursive: true })
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (skip(entry.name)) continue
    if (entry.isDirectory()) await mirror(join(from, entry.name), join(to, entry.name), () => false)
    else if (entry.isFile()) await linkOrCopy(join(from, entry.name), join(to, entry.name))
  }
}

/** Windows: DSH Electron 파일을 묶은 펫 런타임을 만들고(실행 파일이 바뀌었을 때만) 펫 앱을 새로 넣는다. @returns 펫 실행 파일 경로 */
async function prepareWindowsRuntime(exe, base, app) {
  const info = await stat(exe)
  const want = `${info.size}:${Math.round(info.mtimeMs)}`
  const dir = join(base, 'electron'), stamp = join(dir, 'dsc-pet.stamp')
  if (await readFile(stamp, 'utf8').catch(() => '') !== want) {
    await rm(dir, { recursive: true, force: true })
    await mirror(dirname(exe), dir, (name) => name === 'resources' || name === basename(exe) || /^uninstall/i.test(name))
    await linkOrCopy(exe, join(dir, PET_EXE))
    await writeFile(stamp, want)
  }
  const target = join(dir, 'resources', 'app')
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  for (const name of await readdir(app)) await copyFile(join(app, name), join(target, name))
  return join(dir, PET_EXE)
}

const run = promisify(execFile)
const MAC_RECIPE = '1'   // 번들 구성 방법이 바뀌면 올려서 만들어 둔 런타임을 다시 만들게 함
const MAC_APP = 'DeepSeekChanPet.app'
const MAC_APP_ID = 'com.deepseek.dsh.dsc-pet'
const MAC_COPY = ['MacOS', 'Frameworks', 'Info.plist', 'PkgInfo', join('Resources', 'icon.icns')]   // DSH.app/Contents 에서 복제할 것 (app.asar·runtime 등 큰 리소스는 제외)
const MAC_EXE = /^(.*\.app)\/Contents\/MacOS\/[^/]+$/

/** `…/X.app/Contents/MacOS/X` 형태면 그 .app 폴더 경로, 아니면 null (Windows 실행 파일 경로는 null) */
export const macBundle = (exe) => MAC_EXE.exec(String(exe ?? ''))?.[1] ?? null

const statKey = async (file) => { const info = await stat(file); return `${info.size}:${Math.round(info.mtimeMs)}` }

async function macStamp(bundle, exe) {
  const parts = await Promise.all([exe, join(bundle, 'Contents', 'Info.plist'), join(bundle, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Electron Framework')].map(statKey))
  return `${MAC_RECIPE}:${parts.join(':')}`
}

/** APFS clone(디스크 0)으로 복제하고, 클론이 안 되는 볼륨이면 일반 복사 */
async function cloneTo(from, to, runner) {
  await mkdir(dirname(to), { recursive: true })
  try { await runner('/bin/cp', ['-cR', from, to]) } catch { await runner('/bin/cp', ['-R', from, to]) }
}

async function patchMacPlist(plist, runner) {
  await runner('/usr/bin/plutil', ['-replace', 'CFBundleIdentifier', '-string', MAC_APP_ID, plist])   // DSH 와 다른 앱으로 보이게
  await runner('/usr/bin/plutil', ['-replace', 'LSUIElement', '-bool', 'true', plist])             // Dock·앱 전환기·메뉴 막대에 안 나타남
  for (const key of ['ElectronAsarIntegrity', 'CFBundleURLTypes']) await runner('/usr/bin/plutil', ['-remove', key, plist]).catch(() => {})   // 없는 app.asar 해시·dsh:// 스킴 가로채기 제거
}

/** DSH.app 일부를 복제해 펫 전용 .app 을 만든다. 수정한 사본만 ad-hoc 재서명하며 원본 앱은 읽기만 한다. */
async function buildMacBundle(bundle, out, runner) {
  const contents = join(out, 'Contents')
  for (const name of MAC_COPY) await cloneTo(join(bundle, 'Contents', name), join(contents, name), runner).catch((error) => { if (!name.startsWith('Resources')) throw error })
  const stub = join(contents, 'Resources', 'app')
  await mkdir(stub, { recursive: true })
  await writeFile(join(stub, 'package.json'), JSON.stringify({ name: 'dsc-pet', main: '../../../../pet-app/main.cjs' }))   // out/../pet-app (Contents/Resources/app 에서 네 칸 위)
  await patchMacPlist(join(contents, 'Info.plist'), runner)
  await runner('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', out]).catch(() => {})
  await runner('/usr/bin/codesign', ['--force', '-s', '-', out])   // 하드닝 런타임 플래그를 붙이면 DSH 서명 Frameworks 와 섞여 실행이 멈춤(실측)
}

/** macOS: 실행 파일이 바뀌었을 때만 펫 .app 을 만들고, 펫 앱은 .app 밖(pet-app)에 새로 넣는다. @returns 펫 실행 파일 경로 */
async function prepareMacRuntime(exe, base, app, runner) {
  const bundle = macBundle(exe), dir = join(base, 'electron'), stamp = join(dir, 'dsc-pet.stamp')
  const want = await macStamp(bundle, exe)
  if (await readFile(stamp, 'utf8').catch(() => '') !== want) {
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })
    await buildMacBundle(bundle, join(dir, MAC_APP), runner)
    await writeFile(stamp, want)
  }
  const target = join(dir, 'pet-app')
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  for (const name of await readdir(app)) await copyFile(join(app, name), join(target, name))
  return join(dir, MAC_APP, 'Contents', 'MacOS', basename(exe))
}

/** 펫 런타임을 준비한다. 실행 파일 모양으로 플랫폼을 가림 (…/X.app/Contents/MacOS/X = macOS). @returns 펫 실행 파일 경로 */
export function prepareRuntime(exe, base, app = PET_APP, runner = run) {
  return macBundle(exe) ? prepareMacRuntime(exe, base, app, runner) : prepareWindowsRuntime(exe, base, app)
}

/** 호스트 ↔ 펫 프로세스 연결 지점. Windows = 이름 있는 파이프, macOS = 짧은 경로의 unix 소켓(sun_path 104바이트 한계, 0700 폴더 안). cleanup 은 폴더를 지움 */
export async function createEndpoint(platform = process.platform, tmp = tmpdir()) {
  if (platform === 'win32') return { path: `\\\\.\\pipe\\dsc-pet-${process.pid}-${randomUUID()}`, cleanup: async () => {} }
  const root = Buffer.byteLength(tmp) > 70 ? '/tmp' : tmp   // 소켓 경로 = root/dsc-pet-XXXXXX/s (약 18바이트 추가)
  const dir = await mkdtemp(join(root, 'dsc-pet-'))
  return { path: join(dir, 's'), cleanup: () => rm(dir, { recursive: true, force: true }) }
}

const supportedOn = (platform, exe) => !!exe && (platform === 'win32' || (platform === 'darwin' && !!macBundle(exe)))

/** 펫 프로세스 실행 옵션과 환경 (ELECTRON_RUN_AS_NODE 가 남아 있으면 Node 로만 돌고 창이 안 뜸) */
function petSpawn(platform, base = process.env) {
  const env = { ...base }
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS
  if (platform === 'darwin') { delete env.__CFBundleIdentifier; return { env, stdio: 'ignore' } }
  return { env, stdio: 'ignore', windowsHide: false }
}

const READY_TIMEOUT = 15000   // 보통 2~3초. 이 안에 ready가 없으면 시작 도중 멈춘 것으로 봄 (macOS 서명·보안 정책 변화 등)
const TASKPOLICY = '/usr/sbin/taskpolicy'

/**
 * macOS: 시작하는 동안(모델 불러오기, CPU 약 2.5초) 백그라운드 우선순위로 낮춰 작업을 방해하지 않게 함.
 * 띄운 뒤 -p로 거는 이유: `taskpolicy -b <명령>`으로 시작부터 건 백그라운드는 나중에 -B -p로 풀리지 않음(종료 코드 0이지만 그대로, 실측).
 * 낮춘 뒤 펫이 띄우는 GPU·renderer 프로세스는 같은 우선순위를 물려받고, -B -p로 풀림(실측)
 */
export const lowerPriority = (pid, runner = run) => runner(TASKPOLICY, ['-b', '-p', String(pid)]).then(() => {}, () => {})

export async function restorePriority(pid, runner = run) {
  const kids = await runner('/usr/bin/pgrep', ['-P', String(pid)]).then((r) => String(r.stdout).split('\n').filter(Boolean), () => [])
  await Promise.all([String(pid), ...kids].map((p) => runner(TASKPOLICY, ['-B', '-p', p]).catch(() => {})))
}

const defaultBase = (platform = process.platform) => platform === 'darwin'
  ? join(homedir(), 'Library', 'Application Support', 'deepseek-harness-kr', 'pet-runtime')
  : join(process.env.LOCALAPPDATA || join(homedir(), '.cache'), 'deepseek-harness-kr', 'pet-runtime')

/**
 * 펫 프로세스 하나를 관리한다. 처음 끌 때 숨긴 채로 띄워 두고(warm), 창 밖으로 던지면 보여 준다(open).
 * 붙으면 창 안 캐릭터가 숨김을 요청하고 프로세스는 남아 다음에 바로 뜬다. 호스트가 내려가면 파이프가 끊겨 펫도 끝난다.
 */
export function createPetManager({ assets, exe = electronExecutable(), platform = process.platform, base = defaultBase(platform), app = PET_APP, spawnImpl = spawn, prepare = prepareRuntime, readyTimeout = READY_TIMEOUT } = {}) {
  const supported = supportedOn(platform, exe)
  // seq: 마지막으로 연 회차 (새로 불러온 화면이 이어받음), disposed: 플러그인이 내려감 (시작 도중이면 펫을 띄우지 않음)
  let child = null, server = null, socket = null, starting = null, state = 'none', seq, disposed = false, endpoint = null
  let readyTimer = null   // 띄운 펫이 ready를 보내지 않으면(시작 도중 멈춤) 끝내고 다음 시도에 맡김
  const events = [], outbox = []
  const write = (message) => {
    if (socket) socket.write(JSON.stringify(message) + '\n')
    else if (starting) outbox.push(message)
  }
  const onMessage = (message) => {
    if (!message || typeof message.type !== 'string') return
    // 시작이 끝났으니 보통 우선순위로. 보일 때도 한 번 더 (나중에 생긴 자식 프로세스까지)
    if ((message.type === 'ready' || message.type === 'shown') && platform === 'darwin' && child?.pid) restorePriority(child.pid).catch(() => {})
    if (message.type === 'ready') { clearTimeout(readyTimer); readyTimer = null }
    if (message.type === 'ready' || message.type === 'hidden') state = 'hidden'
    else if (message.type === 'shown') state = 'shown'
    if (message.type !== 'ready') events.push(message)
    if (events.length > 100) events.splice(0, events.length - 100)
  }
  const reset = () => {
    clearTimeout(readyTimer); readyTimer = null
    child = null; socket = null; starting = null; state = 'none'; outbox.length = 0
    server?.close(); server = null
    endpoint?.cleanup().catch(() => {}); endpoint = null
  }
  const start = () => starting ??= (async () => {
    const ep = endpoint = await createEndpoint(platform)
    const pipe = ep.path
    server = createServer((s) => {
      if (socket) { s.destroy(); return }
      socket = s
      server.close()   // 연결 지점 이름이 실행 인자에 드러나므로 펫이 붙은 뒤에는 다른 연결을 받지 않음
      s.setEncoding('utf8')
      let buffer = ''
      s.on('data', (chunk) => {
        buffer += chunk
        for (let i; (i = buffer.indexOf('\n')) >= 0;) {
          const line = buffer.slice(0, i); buffer = buffer.slice(i + 1)
          try { onMessage(JSON.parse(line)) } catch {}
        }
      })
      s.on('close', () => { if (socket === s) socket = null })
      s.on('error', () => {})
      for (const message of outbox.splice(0)) write(message)
    })
    // 리슨 전에 닫히면(시작 도중 dispose) 리슨 콜백이 오지 않으므로 close로도 끝냄
    const srv = server
    await new Promise((resolve, reject) => { srv.once('error', reject); srv.once('close', () => reject(new Error('disposed'))); srv.listen(pipe, resolve) })
    if (disposed) throw new Error('disposed')
    const bin = await prepare(exe, base, app)
    if (disposed) throw new Error('disposed')
    const c = child = spawnImpl(bin, [`--dsc-pipe=${pipe}`, `--dsc-assets=${assets}`], petSpawn(platform))
    if (platform === 'darwin' && c?.pid) lowerPriority(c.pid)
    state = 'starting'
    // 지금 회차 번호를 붙여, 창 안 쪽이 이전 회차에 쌓인 종료 알림으로 진행 중인 따라오기를 끊지 않게 함. 이미 다른 프로세스로 바뀌었으면 무시
    c.once('exit', () => { if (child !== c) return; reset(); events.push({ type: 'closed', seq }) })
    c.once('error', (error) => { if (child !== c) return; reset(); events.push({ type: 'error', message: error.message, seq }) })
    readyTimer = setTimeout(() => {
      if (child !== c || state !== 'starting') return
      reset(); try { c.kill() } catch {}
      events.push({ type: 'error', message: 'pet did not become ready', seq })
    }, readyTimeout)
  })().catch((error) => { const p = child; reset(); p?.kill(); events.push({ type: 'error', message: error.message }); throw error })
  return {
    status(drain = true) { return { supported, state, seq, events: drain ? events.splice(0) : [] } },
    async warm() { if (supported) await start() },
    async open(body) {
      if (!supported) return
      await start()
      seq = Number.isInteger(body?.seq) ? body.seq : undefined
      write({ type: 'open', from: body?.from, to: body?.to, follow: body?.follow === true, grab: body?.grab, seq })   // grab: 따라오기에서 커서가 몸을 잡은 자리
    },
    send(list) { if (Array.isArray(list) && state !== 'none') write({ type: 'cmd', list }) },
    hide() { if (state !== 'none') write({ type: 'hide' }) },
    dispose() { disposed = true; const p = child; reset(); try { p?.kill() } catch {} },
  }
}

const readJson = (req, limit = 256 * 1024) => new Promise((resolve, reject) => {
  let size = 0, text = ''
  req.setEncoding('utf8')
  req.on('data', (chunk) => { size += chunk.length; if (size > limit) { reject(new Error('too large')); req.destroy() } else text += chunk })
  req.on('end', () => { try { resolve(text ? JSON.parse(text) : {}) } catch (error) { reject(error) } })
  req.on('error', reject)
})

/**
 * 창 안 캐릭터가 부르는 경로: GET poll(상태 + 쌓인 알림을 비움), POST warm·open·send·hide.
 * 프로세스를 띄우는 경로라 DSH 연결 서비스의 인증 검사(requestRejection)를 통과한 요청만 받는다. 검사기가 없으면 모두 거절.
 */
export function createPetHandler(pet, rejection = () => 503) {
  return async (req, res) => {
    const json = (code, value) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)) }
    const denied = rejection(req)
    if (denied !== undefined) { res.writeHead(denied); res.end(); return }
    const path = (req.url || '').split('?')[0].slice(PET_PATH.length)
    try {
      if (req.method === 'GET' && path === '/poll') return json(200, pet.status())
      if (req.method !== 'POST') return json(405, { error: 'method' })
      const body = await readJson(req)
      if (path === '/warm') await pet.warm()
      else if (path === '/open') await pet.open(body)
      else if (path === '/send') pet.send(body.list)
      else if (path === '/hide') pet.hide()
      else return json(404, { error: 'unknown' })
      json(200, pet.status(false))
    } catch (error) {
      if (!res.headersSent) json(500, { error: error.message })
    }
  }
}
