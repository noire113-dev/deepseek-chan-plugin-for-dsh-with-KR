// 바깥 펫 창 (DSH의 Electron 실행 파일로 도는 작은 앱)
// - 투명·테두리 없음·항상 위 창 하나에 assets/dsc.js 를 펫 모드로 띄운다. 캐릭터 위에서만 클릭을 받고 나머지는 뒤 화면으로 통과.
// - 플러그인 호스트와 JSON 한 줄씩 주고받는다 (Windows 이름 있는 파이프 · macOS unix 소켓, 둘 다 net.connect(경로)). 연결이 끊기면(DSH 종료) 함께 끝난다.
const { app, BrowserWindow, Menu, ipcMain, net, protocol, screen } = require('electron')
const path = require('node:path')
const { connect } = require('node:net')
const { pathToFileURL } = require('node:url')

const arg = (name) => { const hit = process.argv.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : '' }
const PIPE = arg('dsc-pipe'), ASSETS = arg('dsc-assets'), APP = __dirname
const OWN = '/__app'   // dscpet://assets 아래에서 이 앱 폴더를 가리키는 경로
const WIN_W = 440, WIN_H = 540   // 캐릭터(최대 375px)와 머리 위 말풍선이 들어가는 크기

const MAC = process.platform === 'darwin'
if (!PIPE || !ASSETS) app.exit(1)
app.setName('DeepSeekChan Pet')
if (MAC) {
  app.setActivationPolicy('accessory')                 // Dock·앱 전환기에 안 나타남 (번들 Info.plist 의 LSUIElement 와 겹쳐 둠)
  app.commandLine.appendSwitch('use-mock-keychain')    // 사본(ad-hoc 서명)이 DSH 의 키체인 항목을 건드려 암호 창이 뜨는 일 방지
  // 프로필(캐시·로컬 저장소)은 DSH 와 따로 둠
  if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', path.join(app.getPath('appData'), 'deepseek-harness-kr', 'pet-profile'))
}
protocol.registerSchemesAsPrivileged([{ scheme: 'dscpet', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])

let win = null, socket = null, buffer = ''
// 지금 회차 번호(창 안 캐릭터가 펫 창을 열 때마다 올림). 보이기·숨기·붙기 알림에 붙여, 이전 회차 알림과 섞이지 않게 함
let seq
const toHost = (message) => { if (socket && !socket.destroyed) socket.write(JSON.stringify(seq === undefined ? message : { ...message, seq }) + '\n') }
// 페이지가 'ready'를 보내기 전에 온 메시지는 모아 두었다가 넘김 (첫 실행 때 open이 사라지지 않게)
let pageReady = false
const pending = []
const toPage = (message) => { if (!win || win.isDestroyed()) return; if (pageReady) win.webContents.send('dsc', message); else pending.push(message) }
const inside = (root, file) => { const rel = path.relative(root, file); return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel) }
const hide = () => { if (win && !win.isDestroyed() && win.isVisible()) { win.hide(); setAccept(false); toHost({ type: 'hidden' }) } track(false); toPage({ type: 'power', on: false }); reloadIfStale() }
// 클릭 받기: 평소엔 뒤 화면으로 통과시키고, 커서가 캐릭터 몸 영역(box, 창 안 좌표) 안이거나 누르고 끄는 중(force)일 때만 받음.
// 커서 위치는 여기서 직접 읽음 (Windows에서 클릭 통과 중 마우스 이동 전달(forward)이 창을 옮긴 뒤 끊겨 다시 못 집는 일이 있어서)
let box = null, force = false, accepting = false
function setAccept(on) { if (on !== accepting && win && !win.isDestroyed()) { accepting = on; win.setIgnoreMouseEvents(!on, { forward: true }) } }
function checkCursor() {
  if (!win || win.isDestroyed() || !win.isVisible()) return setAccept(false)
  if (force) return setAccept(true)
  if (!box) return setAccept(false)
  const p = screen.getCursorScreenPoint(), b = win.getBounds()
  setAccept(p.x >= b.x + box.l && p.x <= b.x + box.r && p.y >= b.y + box.t && p.y <= b.y + box.b)
}
setInterval(checkCursor, 30)
// 따라오기: 창 안 캐릭터가 끌어낼 때 창 위치는 여기서 커서를 읽는 즉시 옮김 (페이지로 보내 다음 프레임에 계산해 되돌려 받으면
// 프레임마다 위치가 밀리거나 건너뛰어 끊겨 보임). 페이지에는 몸 흔들림 계산용으로 커서만 알려 줌. grab = 커서가 몸을 잡은 자리, off = 창 안 몸 왼쪽 위 좌표
let tracker = null
function track(on, grab, off) {
  if (!on) { clearInterval(tracker); tracker = null; return }
  if (tracker) return
  const g = { x: Number(grab?.x) || 0, y: Number(grab?.y) || 0 }, o = { x: Number(off?.x) || 0, y: Number(off?.y) || 0 }
  let last = ''
  const tick = () => {
    if (!win || win.isDestroyed()) return
    const p = screen.getCursorScreenPoint(), key = `${p.x},${p.y}`
    if (key === last) return
    last = key
    win.setPosition(Math.round(p.x - g.x - o.x) | 0, Math.round(p.y - g.y - o.y) | 0)   // | 0: -0 방지 (아래 move와 같은 이유)
    toPage({ type: 'cursor', x: p.x, y: p.y })
  }
  tick()   // 창을 보이기 전에 먼저 커서 자리로 (잠깐 엉뚱한 자리에 떠 보이지 않게)
  tracker = setInterval(tick, 4)
}
// 캐릭터 코드(assets/dsc.js)가 바뀌면(플러그인 업데이트·재설치) 숨어 있을 때 페이지를 새로 불러옴. 떠 있는 동안 바뀌면 다음에 숨을 때.
// (펫 프로세스는 DSH가 꺼질 때까지 남아 있어서, 안 그러면 창 안 캐릭터만 새 코드로 돌고 펫 창은 옛 코드로 돎)
let stale = false
function reloadIfStale() { if (stale && win && !win.isDestroyed() && !win.isVisible()) { stale = false; pageReady = false; win.webContents.reloadIgnoringCache() } }
require('node:fs').watchFile(path.join(ASSETS, 'dsc.js'), { interval: 2000 }, (now, before) => { if (now.mtimeMs !== before.mtimeMs) { stale = true; reloadIfStale() } })
// 숨기라는 말을 받은 뒤 늦게 온 '자리 잡음(placed)'으로 다시 보이지 않게, 마지막 지시가 open인지 기억함
let wanted = false

const fromHost = (message) => {
  if (message.type === 'hide') { wanted = false; return hide() }
  if (message.type === 'open') { wanted = true; seq = message.seq }
  toPage(message)   // open · cmd
}

app.whenReady().then(() => {
  // dscpet://assets/… = 플러그인 assets, dscpet://assets/__app/… = 이 앱 폴더 (페이지와 assets가 한 출처여야 Core 계산 Worker를 만들 수 있음)
  protocol.handle('dscpet', (request) => {
    const url = new URL(request.url), pathname = decodeURIComponent(url.pathname), own = pathname.startsWith(OWN + '/')
    const root = own ? APP : ASSETS
    const file = path.join(root, own ? pathname.slice(OWN.length) : pathname)
    if (!inside(root, file)) return new Response('', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
  win = new BrowserWindow({
    width: WIN_W, height: WIN_H, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true,
    title: 'DeepSeekChan',
    // macOS: 기본 창은 메뉴 막대 아래로 위치가 눌려 캐릭터와 창이 어긋남(enableLargerThanScreen 으로 해제), 포커스를 가져가지 않고 첫 클릭도 바로 받음
    ...(MAC ? { enableLargerThanScreen: true, focusable: false, acceptFirstMouse: true } : {}),
    webPreferences: { preload: path.join(APP, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  })
  if (MAC) {   // 전체 화면 앱·모든 Spaces 위. skipTransformProcessType: LSUIElement 앱이라 프로세스 유형 전환(Dock 깜빡임) 불필요
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  }
  win.setIgnoreMouseEvents(true, { forward: true })   // 처음엔 클릭 통과 (accepting = false)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.loadURL(`dscpet://assets${OWN}/index.html`)
  ipcMain.on('dsc', (event, message) => {
    if (event.sender !== win.webContents || !message || typeof message.type !== 'string') return
    switch (message.type) {
      // | 0: Math.round 결과가 -0이면 Electron이 정수로 받지 못해 오류 창을 띄움
      case 'move': if (Number.isFinite(message.x) && Number.isFinite(message.y)) win.setPosition(Math.round(message.x) | 0, Math.round(message.y) | 0); return
      case 'track': track(!!message.on, message.grab, message.off); return
      case 'press': force = !!message.on; checkCursor(); return   // 누르고 있는 동안은 커서가 몸 밖이어도 늘 받음
      case 'hitbox': box = message.box && ['l', 't', 'r', 'b'].every((k) => Number.isFinite(message.box[k])) ? message.box : null; checkCursor(); return
      // 이미 보이는 중이어도(따라오기 회차에서 바로 던지기 회차로 넘어간 경우) 지금 회차로 shown을 다시 알림
      case 'placed': if (wanted) { if (!win.isVisible()) win.showInactive(); toHost({ type: 'shown' }) } return
      case 'menu':
        Menu.buildFromTemplate([{ label: '창으로 돌아가기', click: () => toPage({ type: 'home' }) }]).popup({ window: win })
        return
      // 창 안 캐릭터가 나타나는 프레임에 숨기라고 알려 옴. 1초는 창 안 쪽이 응답하지 않을 때를 위한 대비
      case 'attach': wanted = false; toHost(message); setTimeout(() => { if (!wanted) hide() }, 1000); return
      case 'ready': pageReady = true; for (const m of pending.splice(0)) win.webContents.send('dsc', m); toHost(message); return
      default: toHost(message)
    }
  })

  socket = connect(PIPE)
  socket.setEncoding('utf8')
  socket.on('data', (chunk) => {
    buffer += chunk
    for (let i; (i = buffer.indexOf('\n')) >= 0;) {
      const line = buffer.slice(0, i); buffer = buffer.slice(i + 1)
      let message; try { message = JSON.parse(line) } catch { continue }
      if (message && typeof message.type === 'string') fromHost(message)
    }
  })
  socket.on('close', () => app.quit())
  socket.on('error', () => app.quit())
})
app.on('window-all-closed', () => app.quit())
