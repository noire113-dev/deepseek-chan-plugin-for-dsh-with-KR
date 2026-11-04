// 바깥 펫 창: DSH 데스크톱의 Electron 실행 파일을 다시 써서 투명한 펫 창 프로세스를 띄우고, 창 안 캐릭터와 메시지를 이어 준다.
// - 런타임: DSH 설치 폴더 파일을 하드링크(같은 드라이브면 디스크 0)로 묶고 resources/app 에 펫 앱(../pet/)만 넣는다.
//   (DSH Electron은 OnlyLoadAppFromAsar·asar 무결성 검사 fuse가 꺼져 있어 resources/app 폴더 앱을 불러온다)
// - 연결: 창 안 캐릭터 ↔ 호스트 = DSH 웹 서버의 /deepseek-harness-kr/pet/*, 호스트 ↔ 펫 프로세스 = 이름 있는 파이프(JSON 한 줄씩)
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFile, link, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
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

/** DSH Electron 파일을 묶은 펫 런타임을 만들고(실행 파일이 바뀌었을 때만) 펫 앱을 새로 넣는다. @returns 펫 실행 파일 경로 */
export async function prepareRuntime(exe, base, app = PET_APP) {
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

const defaultBase = () => join(process.env.LOCALAPPDATA || join(homedir(), '.cache'), 'deepseek-harness-kr', 'pet-runtime')

/**
 * 펫 프로세스 하나를 관리한다. 처음 끌 때 숨긴 채로 띄워 두고(warm), 창 밖으로 던지면 보여 준다(open).
 * 붙으면 창 안 캐릭터가 숨김을 요청하고 프로세스는 남아 다음에 바로 뜬다. 호스트가 내려가면 파이프가 끊겨 펫도 끝난다.
 */
export function createPetManager({ assets, exe = electronExecutable(), platform = process.platform, base = defaultBase(), app = PET_APP, spawnImpl = spawn } = {}) {
  const supported = platform === 'win32' && !!exe
  // seq: 마지막으로 연 회차 (새로 불러온 화면이 이어받음), disposed: 플러그인이 내려감 (시작 도중이면 펫을 띄우지 않음)
  let child = null, server = null, socket = null, starting = null, state = 'none', seq, disposed = false
  const events = [], outbox = []
  const write = (message) => {
    if (socket) socket.write(JSON.stringify(message) + '\n')
    else if (starting) outbox.push(message)
  }
  const onMessage = (message) => {
    if (!message || typeof message.type !== 'string') return
    if (message.type === 'ready' || message.type === 'hidden') state = 'hidden'
    else if (message.type === 'shown') state = 'shown'
    if (message.type !== 'ready') events.push(message)
    if (events.length > 100) events.splice(0, events.length - 100)
  }
  const reset = () => {
    child = null; socket = null; starting = null; state = 'none'; outbox.length = 0
    server?.close(); server = null
  }
  const start = () => starting ??= (async () => {
    const pipe = `\\\\.\\pipe\\dsc-pet-${process.pid}-${randomUUID()}`
    server = createServer((s) => {
      if (socket) { s.destroy(); return }
      socket = s
      server.close()   // 파이프 이름이 실행 인자에 드러나므로 펫이 붙은 뒤에는 다른 연결을 받지 않음
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
    const bin = await prepareRuntime(exe, base, app)
    if (disposed) throw new Error('disposed')
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS
    const c = child = spawnImpl(bin, [`--dsc-pipe=${pipe}`, `--dsc-assets=${assets}`], { env, stdio: 'ignore', windowsHide: false })
    state = 'starting'
    // 지금 회차 번호를 붙여, 창 안 쪽이 이전 회차에 쌓인 종료 알림으로 진행 중인 따라오기를 끊지 않게 함. 이미 다른 프로세스로 바뀌었으면 무시
    c.once('exit', () => { if (child !== c) return; reset(); events.push({ type: 'closed', seq }) })
    c.once('error', (error) => { if (child !== c) return; reset(); events.push({ type: 'error', message: error.message, seq }) })
  })().catch((error) => { const p = child; reset(); p?.kill(); events.push({ type: 'error', message: error.message }); throw error })
  return {
    status(drain = true) { return { supported, state, seq, events: drain ? events.splice(0) : [] } },
    async warm() { if (supported) await start() },
    async open(body) {
      if (!supported) return
      await start()
      seq = Number.isInteger(body?.seq) ? body.seq : undefined
      write({ type: 'open', from: body?.from, to: body?.to, follow: body?.follow === true, seq })
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
