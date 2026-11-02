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
  const keepLight = () => document.body.removeAttribute('data-ds-dark-theme')
  keepLight()
  life.observe(keepLight).observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
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

function settingsPage(ctx, form) {
  return function FeatureSettings({ view }) {
    const state = React.useSyncExternalStore((fn) => form.subscribe(fn), () => form.getSnapshot(), () => form.getSnapshot())
    const locale = React.useSyncExternalStore((fn) => ctx.locale.subscribe(fn), () => ctx.locale.getLocale(), () => ctx.locale.getLocale())
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
      error ? React.createElement('p', { role: 'alert' }, error) : null)
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
    }, settingsPage(ctx, form))))
    sync()
  } catch (error) { dispose(); throw error }
}

exports.inject = ['locale', 'theme', 'configForms', 'slots']
exports.apply = apply
