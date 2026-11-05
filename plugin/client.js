// The original animation stays in assets/dsc.js; each feature owns its lifecycle here.
const ROOT = '/deepseek-harness-kr/assets/'
const SLOT = '__deepseekHarnessKrDispose'
const ENTRY_ID = 'deepseek-harness-kr'
// 소품·옷 (데스크톱 펫 메뉴와 같은 항목, 세숫대야·앞으로 숙이기는 뺌)과 체형
const OUTFIT_FIELDS = [
  ['glasses', '뿔테 안경', 'Glasses'],
  ['monocle', '외눈 안경', 'Monocle'],
  ['skirt', '치마 길이 바꾸기', 'Change skirt length'],
  ['chestClothes', '가슴 옷 바꾸기', 'Change top'],
  ['shoesOff', '신발 벗기', 'Take off shoes'],
  ['tailHide', '꼬리 숨기기', 'Hide tail'],
]
const BODY_TYPES = [['default', '기본 체형', 'Default'], ['type1', '체형 1', 'Body type 1'], ['type2', '체형 2 (꼬마)', 'Body type 2 (chibi)']]
const React = require('react')
const sleepMinutes = (value) => {
  const n = Number(value ?? 1)
  return Number.isFinite(n) ? Math.min(60, Math.max(0.5, n)) : 1
}

function createLifetime() {
  let stopped = false
  const cleanups = []
  const timers = new Set(), intervals = new Set(), frames = new Set()
  const add = (cleanup) => { if (stopped) cleanup(); else cleanups.push(cleanup) }
  const timeout = (fn, ms, ...args) => {
    if (stopped) return 0
    const id = window.setTimeout(() => { timers.delete(id); if (!stopped) fn(...args) }, ms)
    timers.add(id); return id
  }
  const interval = (fn, ms, ...args) => {
    if (stopped) return 0
    const id = window.setInterval(() => { if (!stopped) fn(...args) }, ms)
    intervals.add(id); return id
  }
  const frame = (fn) => {
    if (stopped) return 0
    const id = window.requestAnimationFrame((time) => { frames.delete(id); if (!stopped) fn(time) })
    frames.add(id); return id
  }
  const listen = (target, type, fn, options) => {
    if (stopped) return
    target.addEventListener(type, fn, options)
    add(() => target.removeEventListener(type, fn, options))
  }
  const observe = (fn) => {
    const observer = new window.MutationObserver((...args) => { if (!stopped) fn(...args) })
    add(() => observer.disconnect())
    return observer
  }
  const own = (value, cleanup) => { add(() => cleanup(value)); return value }
  return {
    add, timeout, interval, frame, listen, observe, own,
    get stopped() { return stopped },
    dispose() {
      if (stopped) return
      stopped = true
      for (const id of timers) window.clearTimeout(id)
      for (const id of intervals) window.clearInterval(id)
      for (const id of frames) window.cancelAnimationFrame(id)
      for (const cleanup of cleanups.reverse()) {
        try { cleanup() } catch (error) { console.warn('DeepSeek짱 cleanup:', error) }
      }
    },
  }
}

function mountCharacter(life) {
  const setTimeout = life.timeout, setInterval = life.interval, requestAnimationFrame = life.frame
  const addEventListener = (...args) => life.listen(window, ...args)
  function MutationObserver(fn) { return life.observe(fn) }
  /* ORIGINAL_CHARACTER */
}

function stylesheet(life, file) {
  const link = document.createElement('link')
  link.rel = 'stylesheet'; link.href = ROOT + file
  document.head.appendChild(link)
  life.add(() => link.remove())
}

function mountLayout(life) {
  const owned = new Map()
  const mark = (node, name) => {
    if (node.classList.contains(name)) return
    node.classList.add(name)
    if (!owned.has(node)) owned.set(node, new Set())
    owned.get(node).add(name)
  }
  const tag = () => {
    document.querySelectorAll('[class*="_card"]').forEach((node) => {
      if (node.closest('[class*="_root"]') && node.querySelector('[class*="_input"]')) mark(node, 'dsc-composer')
    })
    document.querySelectorAll('button[aria-label="메시지 보내기"], button[aria-label="Send message"]').forEach((node) => mark(node, 'dsc-send'))
    document.querySelectorAll('button[class*="_newSession"]').forEach((node) => mark(node, 'dsc-newsession'))
  }
  tag()
  let queued = false
  life.observe(() => {
    if (queued) return
    queued = true
    life.frame(() => { queued = false; tag() })
  }).observe(document.body, { childList: true, subtree: true })
  life.add(() => { for (const [node, names] of owned) for (const name of names) node.classList.remove(name) })
}

function mountTheme(ctx, life) {
  stylesheet(life, 'theme.css')
  life.add(() => {
    if (ctx.theme.getTheme().active.colorScheme === 'dark') document.body.setAttribute('data-ds-dark-theme', '')
    else document.body.removeAttribute('data-ds-dark-theme')
  })
}

function mountTranslation(ctx, life) {
  if (!ctx.locale.getLocale().locales.some((locale) => locale.id.toLowerCase() === 'ko')) {
    life.add(ctx.locale.addLanguage({ id: 'ko', label: '한국어', fallback: 'en' }))
  }
  for (const [namespace, dictionary] of Object.entries(KOREAN_DICTIONARIES)) {
    life.add(ctx.locale.register(namespace, 'ko', dictionary))
  }
}

function startCharacter(life) {
  const previous = window.__dsc
  life.add(() => {
    if (window.__dsc !== previous) {
      if (previous === undefined) delete window.__dsc
      else window.__dsc = previous
    }
    document.documentElement.classList.remove('dsc-hover')
  })
  stylesheet(life, 'character.css')
  mountCharacter(life)
}

// ---------- 플러그인 업데이트 ----------
// 설치 주소(GitHub)의 package.json 버전과 설치된 버전을 비교하고, Harness 플러그인 관리자의
// installBundle(설치할 때와 같은 기능)을 같은 설치 주소로 다시 불러 최신 커밋을 받는다.

// GitHub 설치 주소 → { owner, repo, ref }. GitHub이 아니면 null.
function githubSource(spec) {
  if (typeof spec !== 'string') return null
  const text = spec.trim()
  const short = text.match(/^github:([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:#(.+))?$/i)
  const full = text.match(/^(?:git\+)?(?:https?:\/\/|ssh:\/\/git@|git@)github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?(?:#(.+))?$/i)
  const m = short || full
  return m ? { owner: m[1], repo: m[2], ref: m[3] || null } : null
}

// "1.2.3" 형식 비교. 앞이 크면 양수. 뒤에 붙은 -rc 등은 같은 번호의 정식 버전보다 낮게 본다.
function compareVersions(a, b) {
  const parse = (v) => {
    const [core, pre] = String(v ?? '').trim().replace(/^v/i, '').split('-', 2)
    return { nums: core.split('.').map((n) => parseInt(n, 10) || 0), pre: pre ?? null }
  }
  const x = parse(a), y = parse(b)
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length, 3); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d) return d
  }
  if (x.pre === y.pre) return 0
  if (x.pre === null) return 1
  if (y.pre === null) return -1
  return x.pre < y.pre ? -1 : 1
}

const PENDING_KEY = 'deepseek-harness-kr:update'
const browserStorage = {
  read() { try { return JSON.parse(window.localStorage.getItem(PENDING_KEY) || 'null') } catch { return null } },
  write(value) { try { window.localStorage.setItem(PENDING_KEY, JSON.stringify(value)) } catch {} },
  clear() { try { window.localStorage.removeItem(PENDING_KEY) } catch {} },
}

function createUpdater({ fetch: fetchImpl = (...args) => window.fetch(...args), storage = browserStorage, now = () => Date.now() } = {}) {
  const listeners = new Set()
  let manager = null, generation = 0
  let snapshot = { phase: 'unavailable' }
  const set = (patch) => { snapshot = { ...snapshot, ...patch }; for (const fn of [...listeners]) fn() }
  const message = (error) => (error && (error.message || error.code || String(error))) || ''
  const failure = (value) => [value?.error?.code, value?.error?.diagnostic].filter(Boolean).join(': ') || 'failed'
  // 이전 화면이 시작한 업데이트(자기 자신을 지웠다 다시 설치)가 끝나 새 버전이 뜬 경우 결과를 이어받는다.
  const resume = async (mine) => {
    const pending = storage.read()
    if (!pending || typeof pending.requestId !== 'string') return false
    if (now() - (pending.at || 0) > 15 * 60 * 1000) { storage.clear(); return false }
    if (snapshot.current && pending.to && compareVersions(snapshot.current, pending.to) >= 0) {
      storage.clear(); set({ phase: 'updated', from: pending.from, error: '' }); return true
    }
    const waited = await manager.waitForInstall?.(pending.requestId)
    if (mine !== generation) return true
    if (waited?.ok && waited.value) {
      storage.clear()
      const v = waited.value
      set(v.application === 'failed' ? { phase: 'update-failed', error: failure(v) } : { phase: 'updated', from: pending.from, error: '' })
      return true
    }
    storage.clear()
    return false
  }
  const check = async () => {
    const mine = ++generation
    if (!manager) { set({ phase: 'unavailable' }); return }
    set({ phase: 'checking', error: '' })
    try {
      const listed = await manager.listBundles()
      if (mine !== generation) return
      if (!listed?.ok) throw new Error(message(listed?.error) || 'listBundles failed')
      const row = listed.value.find((item) => item.name === PLUGIN_ID)
      const current = row?.version ?? null, source = row?.source ?? null
      const gh = githubSource(source)
      if (!gh) { set({ phase: 'unsupported', current, latest: null, source }); return }
      if (gh.ref && /^[0-9a-f]{7,40}$/i.test(gh.ref)) { set({ phase: 'pinned', current, latest: null, source }); return }
      const url = `https://raw.githubusercontent.com/${gh.owner}/${gh.repo}/${encodeURIComponent(gh.ref || 'HEAD')}/package.json`
      const response = await fetchImpl(url, { cache: 'no-store' })
      if (mine !== generation) return
      if (!response.ok) throw new Error('HTTP ' + response.status)
      const latest = (await response.json())?.version
      if (mine !== generation) return
      if (typeof latest !== 'string') throw new Error('no version in package.json')
      set({ current, latest, source })
      if (await resume(mine)) return
      if (mine !== generation) return
      set({ phase: compareVersions(latest, current) > 0 ? 'available' : 'current' })
    } catch (error) {
      if (mine === generation) set({ phase: 'check-failed', error: message(error) })
    }
  }
  const settle = (value) => {
    if (value.application === 'applied' || value.application === 'overridden') set({ phase: 'updated', from: snapshot.current })
    else if (value.application === 'restart-required') set({ phase: 'restart' })
    else if (value.application === 'cancelled') set({ phase: 'available', error: 'cancelled' })
    else set({ phase: 'update-failed', error: failure(value) })
  }
  // 1단계: 확인 요청
  const update = () => { if (manager && snapshot.phase === 'available' && snapshot.source) set({ phase: 'confirm', error: '' }) }
  const cancel = () => { if (snapshot.phase === 'confirm') set({ phase: 'available' }) }
  // 2단계: 실제 업데이트. 먼저 같은 주소로 다시 설치하고, Harness가 '이미 설치됨'으로 막으면
  // 공식 플러그인 업데이트와 같은 방식(제거 → 다시 설치)으로 진행한다. 설정은 프로필에 따로 남는다.
  const confirm = async () => {
    if (!manager || snapshot.phase !== 'confirm' || !snapshot.source) return
    const mine = ++generation, pm = manager, source = snapshot.source
    const requestId = PLUGIN_ID + '-update-' + now()
    set({ phase: 'updating', error: '' })
    try {
      let result = await pm.installBundle(source, { enabled: true, requestId })
      if (!result?.ok) throw new Error(message(result?.error) || 'installBundle failed')
      if (result.value.application === 'failed' && result.value.error?.code === 'already-installed') {
        storage.write({ requestId, from: snapshot.current, to: snapshot.latest, source, at: now() })
        const removed = await pm.removeBundle(PLUGIN_ID)
        if (!removed?.ok) throw new Error(message(removed?.error) || 'removeBundle failed')
        if (removed.value.application === 'failed' || removed.value.error) { storage.clear(); throw new Error(failure(removed.value)) }
        // 이 시점에 이 화면은 내려갔을 수 있다. 설치 요청은 그대로 보낸다.
        result = await pm.installBundle(source, { enabled: true, requestId })
        if (!result?.ok) throw new Error(message(result?.error) || 'installBundle failed')
      }
      storage.clear()
      if (mine === generation) settle(result.value)
    } catch (error) {
      if (mine === generation) set({ phase: 'update-failed', error: message(error) })
    }
  }
  return {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    getSnapshot: () => snapshot,
    attach(next) { manager = next; check() },
    detach() { manager = null; generation++; set({ phase: 'unavailable' }) },
    check,
    update,
    cancel,
    confirm,
  }
}

function updateSection(updater, ko) {
  const s = updater.getSnapshot()
  const t = (k, e) => (ko ? k : e)
  const versions = [s.current && t('현재 ' + s.current, 'Installed ' + s.current), s.latest && t('최신 ' + s.latest, 'Latest ' + s.latest)].filter(Boolean).join(' · ')
  const text = {
    unavailable: t('Harness 플러그인 관리자에 연결되지 않아 업데이트를 확인할 수 없습니다.', 'Plugin manager is unavailable, so updates cannot be checked.'),
    checking: t('업데이트를 확인하는 중입니다…', 'Checking for updates…'),
    current: t('최신 버전입니다.', 'You are up to date.'),
    available: t('새 버전이 있습니다.', 'A new version is available.'),
    confirm: t('업데이트하는 동안 이 플러그인이 잠시 꺼졌다가 새 버전으로 다시 켜집니다. 설정은 그대로 남습니다. 혹시 실패하면 Plugins의 + Add plugin에서 같은 GitHub 주소로 다시 추가하세요.',
      'The plugin turns off briefly and comes back as the new version. Settings are kept. If it fails, add the same GitHub address again from Plugins → + Add plugin.'),
    updating: t('업데이트하는 중입니다… 창을 닫지 마세요.', 'Updating… keep this window open.'),
    updated: t('업데이트했습니다.' + (s.from ? ' (' + s.from + ' → ' + (s.current || s.latest) + ')' : ''), 'Updated.' + (s.from ? ' (' + s.from + ' → ' + (s.current || s.latest) + ')' : '')),
    restart: t('업데이트했습니다. Harness를 다시 시작하면 새 버전이 적용됩니다.', 'Updated. Restart Harness to use the new version.'),
    unsupported: t('GitHub 주소로 설치한 경우에만 여기서 업데이트할 수 있습니다.', 'Updates here work only for plugins installed from a GitHub address.'),
    pinned: t('특정 커밋에 고정해 설치해서 여기서는 업데이트하지 않습니다.', 'This install is pinned to a commit, so it is not updated here.'),
    'check-failed': t('업데이트를 확인하지 못했습니다.', 'Could not check for updates.'),
    'update-failed': t('업데이트하지 못했습니다.', 'Update failed.'),
  }[s.phase] ?? ''
  const busy = s.phase === 'checking' || s.phase === 'updating'
  const button = (label, onClick, disabled) => React.createElement('button', { type: 'button', onClick, disabled }, label)
  return React.createElement('section', { 'aria-label': t('업데이트', 'Updates'), style: { display: 'grid', gap: 8, paddingTop: 12, borderTop: '1px solid #8881' } },
    React.createElement('strong', null, t('업데이트', 'Updates')),
    versions ? React.createElement('span', { style: { opacity: 0.7 } }, versions) : null,
    React.createElement('p', { role: 'status', style: { margin: 0 } }, text, s.error ? ' (' + s.error + ')' : ''),
    React.createElement('div', { style: { display: 'flex', gap: 8 } },
      s.phase === 'available' ? button(t('업데이트', 'Update'), () => updater.update(), busy) : null,
      s.phase === 'confirm' ? button(t('계속', 'Continue'), () => updater.confirm(), false) : null,
      s.phase === 'confirm' ? button(t('취소', 'Cancel'), () => updater.cancel(), false) : null,
      !['unavailable', 'updated', 'restart', 'confirm', 'updating'].includes(s.phase)
        ? button(t('다시 확인', 'Check again'), () => updater.check(), busy) : null))
}

function settingsPage(ctx, form, updater) {
  return function FeatureSettings({ view }) {
    const state = React.useSyncExternalStore((fn) => form.subscribe(fn), () => form.getSnapshot(), () => form.getSnapshot())
    const locale = React.useSyncExternalStore((fn) => ctx.locale.subscribe(fn), () => ctx.locale.getLocale(), () => ctx.locale.getLocale())
    React.useSyncExternalStore((fn) => updater.subscribe(fn), () => updater.getSnapshot(), () => updater.getSnapshot())
    const [error, setError] = React.useState('')
    const [pending, setPending] = React.useState(false)
    const ko = locale.active.toLowerCase().startsWith('ko')
    if (view === 'summary') return React.createElement('span', null, ko ? '캐릭터 · 테마 · 한국어' : 'Character · Theme · Korean')
    if (state.status !== 'ready') return React.createElement('p', { role: 'status' }, ko ? '설정을 불러오는 중입니다.' : 'Loading settings…')
    const fields = [
      ['character', ko ? '캐릭터와 말풍선' : 'Character and speech bubbles'],
      ['theme', ko ? '파스텔 테마' : 'Pastel theme'],
      ['translation', ko ? '한국어 언어팩' : 'Korean language pack'],
    ]
    const change = async (field, checked) => {
      const current = form.getSnapshot()
      if (current.status !== 'ready' || !current.writable) return
      setError(''); setPending(true)
      try {
        if (!await form.set(field, checked)) setError(ko ? '설정을 저장하지 못했습니다.' : 'Could not save settings.')
      } catch { setError(ko ? '설정을 저장하지 못했습니다.' : 'Could not save settings.') }
      finally { setPending(false) }
    }
    const row = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }
    const off = !state.writable || pending
    const outfitSwitch = ([field, label]) => React.createElement('label', { key: field, style: row },
      React.createElement('span', null, label),
      React.createElement('input', { type: 'checkbox', checked: state.value?.[field] === true, disabled: off, onChange: (event) => change(field, event.target.checked) }))
    const bodyType = state.value?.bodyType || 'default'
    return React.createElement('div', { style: { display: 'grid', gap: 16 } },
      ...fields.map(([field, label]) => React.createElement('label', { key: field, style: row },
        React.createElement('span', null, label),
        React.createElement('input', { type: 'checkbox', role: 'switch', checked: state.value?.[field] !== false, disabled: off, onChange: (event) => change(field, event.target.checked) }))),
      React.createElement('p', { style: { opacity: 0.7 } }, ko ? '변경 사항은 바로 적용되고 저장됩니다. 한국어는 Settings → General → Language에서 선택할 수 있습니다.' : 'Changes apply and save immediately. Select Korean under Settings → General → Language.'),
      React.createElement('section', { 'aria-label': ko ? '소품·옷' : 'Accessories and outfit', style: { display: 'grid', gap: 10, borderTop: '1px solid rgba(127,127,127,.25)', paddingTop: 14 } },
        React.createElement('strong', null, ko ? '소품·옷' : 'Accessories and outfit'),
        ...OUTFIT_FIELDS.map(([field, koLabel, enLabel]) => outfitSwitch([field, ko ? koLabel : enLabel]))),
      React.createElement('section', { 'aria-label': ko ? '체형' : 'Body type', style: { display: 'grid', gap: 10, borderTop: '1px solid rgba(127,127,127,.25)', paddingTop: 14 } },
        React.createElement('strong', null, ko ? '체형' : 'Body type'),
        ...BODY_TYPES.map(([value, koLabel, enLabel]) => React.createElement('label', { key: value, style: { display: 'flex', alignItems: 'center', gap: 10 } },
          React.createElement('input', { type: 'radio', name: 'deepseek-harness-kr-body', checked: bodyType === value, disabled: off, onChange: () => change('bodyType', value) }),
          React.createElement('span', null, ko ? koLabel : enLabel)))),
      React.createElement('section', { 'aria-label': ko ? '절전' : 'Power saving', style: { display: 'grid', gap: 10, borderTop: '1px solid rgba(127,127,127,.25)', paddingTop: 14 } },
        React.createElement('strong', null, ko ? '절전' : 'Power saving'),
        React.createElement('label', { style: row },
          React.createElement('span', null, ko ? '입력이 없으면 잠시 쉬기 (화면 밖으로 나가 렌더링을 멈춤)' : 'Rest when idle (leaves the screen and stops rendering)'),
          React.createElement('input', { type: 'checkbox', role: 'switch', checked: state.value?.idleSleep !== false, disabled: off, onChange: (event) => change('idleSleep', event.target.checked) })),
        React.createElement('label', { style: row },
          React.createElement('span', null, ko ? '쉬기 전 대기 시간 (분)' : 'Idle minutes before resting'),
          React.createElement('input', { type: 'number', min: 0.5, max: 60, step: 0.5, style: { width: 90 }, value: sleepMinutes(state.value?.idleSleepMinutes), disabled: off, onChange: (event) => change('idleSleepMinutes', sleepMinutes(event.target.value)) }))),
      React.createElement('section', { 'aria-label': ko ? '단축키' : 'Shortcut', style: { display: 'grid', gap: 10, borderTop: '1px solid rgba(127,127,127,.25)', paddingTop: 14 } },
        React.createElement('strong', null, ko ? '단축키' : 'Shortcut'),
        React.createElement('label', { style: row },
          React.createElement('span', null, ko ? '캐릭터 토글 단축키 (비우면 사용 안 함)' : 'Toggle character shortcut (empty to disable)'),
          React.createElement('input', { type: 'text', placeholder: 'Ctrl+Shift+D', style: { width: 150 }, value: state.value?.characterToggleKey ?? 'Ctrl+Shift+D', disabled: off,
            onChange: (event) => change('characterToggleKey', event.target.value) }))),
      error ? React.createElement('p', { role: 'alert' }, error) : null,
      updateSection(updater, ko))
  }
}

function apply(ctx) {
  window[SLOT]?.()
  const life = createLifetime()
  const features = new Map()
  const reconcile = (name, enabled, mount) => {
    if (enabled === features.has(name)) return
    if (!enabled) { features.get(name).dispose(); features.delete(name); return }
    const feature = createLifetime()
    features.set(name, feature)
    try { mount(feature) } catch (error) { feature.dispose(); features.delete(name); throw error }
  }
  life.add(() => { for (const feature of [...features.values()].reverse()) feature.dispose(); features.clear() })
  const dispose = () => {
    if (window[SLOT] !== dispose) return
    life.dispose()
    delete window[SLOT]
  }
  window[SLOT] = dispose
  ctx.effect(() => dispose, 'deepseek-harness-kr: client')
  try {
    const form = ctx.configForms.get(ENTRY_ID)
    const updater = createUpdater()
    // 플러그인 관리자는 선택적으로 연결: 없어도 캐릭터·테마·번역은 그대로 동작한다.
    if (typeof ctx.inject === 'function') {
      ctx.inject(['remote', 'remote.pluginManager'], (scope) => {
        updater.attach(scope.remote.pluginManager)
        scope.effect(() => () => updater.detach(), 'deepseek-harness-kr: updater')
      })
    }
    life.add(() => updater.detach())
    const sync = () => {
      const snapshot = form.getSnapshot()
      if (snapshot.status !== 'ready') return
      const value = snapshot.value ?? {}
      reconcile('translation', value.translation !== false, (feature) => mountTranslation(ctx, feature))
      reconcile('layout', value.character !== false || value.theme !== false, mountLayout)
      reconcile('theme', value.theme !== false, (feature) => mountTheme(ctx, feature))
      reconcile('character', value.character !== false, startCharacter)
      // 캐릭터는 매 프레임 이 값을 읽어 소품·옷·체형을 바로 바꾼다 (다시 띄우지 않음)
      window.__dscOutfit = Object.fromEntries([...OUTFIT_FIELDS.map(([field]) => [field, value[field] === true]), ['bodyType', value.bodyType || 'default']])
      // 절전 설정도 실시간으로 전달 (캐릭터의 상태 감시 인터벌이 읽음)
      window.__dscSleep = { enabled: value.idleSleep !== false, minutes: sleepMinutes(value.idleSleepMinutes) }
    }
    life.add(() => { delete window.__dscOutfit; delete window.__dscSleep })
    life.add(form.subscribe(sync))
    // 단축키로 캐릭터 토글: 설정의 character 스위치를 뒤집는다 (설정 화면과 같은 저장소·같은 마운트/정리 경로)
    let heldToggleKey = '', togglePending = false
    const toggleListener = async (event) => {
      if (event.repeat) return
      const snapshot = form.getSnapshot()
      const combo = String(snapshot.value?.characterToggleKey ?? 'Ctrl+Shift+D').trim()
      if (!combo) return
      const mods = { ctrl: false, shift: false, alt: false, meta: false }
      let key = null
      for (const p of combo.split('+').map((s) => s.trim()).filter(Boolean)) {
        const l = p.toLowerCase()
        if (l === 'ctrl' || l === 'control') mods.ctrl = true
        else if (l === 'shift') mods.shift = true
        else if (l === 'alt') mods.alt = true
        else if (l === 'meta' || l === 'cmd') mods.meta = true
        else key = l
      }
      if (!key) return
      // 텍스트 입력 중엔 발동하지 않게 (글자를 지우는 Shift+화살표 같은 조합 보호)
      const el = event.target
      if (el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName))) return
      const want = [mods.ctrl && 'ctrl', mods.alt && 'alt', mods.shift && 'shift', mods.meta && 'meta', key].filter(Boolean).join('+')
      const got = [event.ctrlKey && 'ctrl', event.altKey && 'alt', event.shiftKey && 'shift', event.metaKey && 'meta', event.key.toLowerCase()].filter(Boolean).join('+')
      if (got !== want) return
      event.preventDefault()
      if (heldToggleKey || togglePending || snapshot.status !== 'ready' || !snapshot.writable) return
      heldToggleKey = event.code || event.key.toLowerCase()
      togglePending = true
      try {
        if (!await form.set('character', snapshot.value?.character === false)) console.warn('캐릭터 설정 저장 실패')
      } catch { console.warn('캐릭터 설정 저장 실패') }
      finally { togglePending = false }
    }
    life.listen(window, 'keydown', toggleListener)
    life.listen(window, 'keyup', (event) => {
      if ((event.code || event.key.toLowerCase()) === heldToggleKey) heldToggleKey = ''
    })
    life.listen(window, 'blur', () => { heldToggleKey = '' })
    life.add(ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
      name: 'plugins.row.config', key: PLUGIN_ID + '#' + ENTRY_ID,
    }, settingsPage(ctx, form, updater))))
    sync()
  } catch (error) { dispose(); throw error }
}

exports.inject = ['locale', 'theme', 'configForms', 'slots']
exports.apply = apply
// 테스트용
exports.internals = { githubSource, compareVersions, createUpdater }
