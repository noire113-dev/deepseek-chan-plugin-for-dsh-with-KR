// The original animation stays in assets/dsc.js; each feature owns its lifecycle here.
const ROOT = '/deepseek-harness-kr/assets/'
const SLOT = '__deepseekHarnessKrDispose'
const ENTRY_ID = 'deepseek-harness-kr'
const React = require('react')

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

function createUpdater({ fetch: fetchImpl = (...args) => window.fetch(...args) } = {}) {
  const listeners = new Set()
  let manager = null, generation = 0
  let snapshot = { phase: 'unavailable' }
  const set = (patch) => { snapshot = { ...snapshot, ...patch }; for (const fn of [...listeners]) fn() }
  const message = (error) => (error && (error.message || error.code || String(error))) || ''
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
      set({ phase: compareVersions(latest, current) > 0 ? 'available' : 'current', current, latest, source })
    } catch (error) {
      if (mine === generation) set({ phase: 'check-failed', error: message(error) })
    }
  }
  const update = async () => {
    if (!manager || snapshot.phase !== 'available' || !snapshot.source) return
    const mine = ++generation
    set({ phase: 'updating', error: '' })
    try {
      const requestId = PLUGIN_ID + '-update-' + Date.now()
      const result = await manager.installBundle(snapshot.source, { enabled: true, requestId })
      if (mine !== generation) return
      if (!result?.ok) throw new Error(message(result?.error) || 'installBundle failed')
      const value = result.value
      if (value.application === 'applied' || value.application === 'overridden') set({ phase: 'updated' })
      else if (value.application === 'restart-required') set({ phase: 'restart' })
      else if (value.application === 'cancelled') set({ phase: 'available', error: 'cancelled' })
      else set({ phase: 'update-failed', error: [value.error?.code, value.error?.diagnostic].filter(Boolean).join(': ') || 'failed' })
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
    updating: t('업데이트하는 중입니다… 창을 닫지 마세요.', 'Updating… keep this window open.'),
    updated: t('업데이트했습니다. 화면을 새로 고치면 새 버전이 적용됩니다.', 'Updated. Reload the window to use the new version.'),
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
      s.phase !== 'unavailable' && s.phase !== 'updated' && s.phase !== 'restart'
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
      setError(''); setPending(true)
      try {
        if (!await form.set(field, checked)) setError(ko ? '설정을 저장하지 못했습니다.' : 'Could not save settings.')
      } catch { setError(ko ? '설정을 저장하지 못했습니다.' : 'Could not save settings.') }
      finally { setPending(false) }
    }
    return React.createElement('div', { style: { display: 'grid', gap: 16 } },
      ...fields.map(([field, label]) => React.createElement('label', { key: field, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 } },
        React.createElement('span', null, label),
        React.createElement('input', { type: 'checkbox', role: 'switch', checked: state.value?.[field] !== false, disabled: !state.writable || pending, onChange: (event) => change(field, event.target.checked) }))),
      React.createElement('p', { style: { opacity: 0.7 } }, ko ? '변경 사항은 바로 적용되고 저장됩니다. 한국어는 Settings → General → Language에서 선택할 수 있습니다.' : 'Changes apply and save immediately. Select Korean under Settings → General → Language.'),
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
      ctx.inject(['remote.pluginManager'], (scope) => {
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
    }
    life.add(form.subscribe(sync))
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
