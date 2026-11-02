// Packaging adapter only: the original dsc.js animation and DOM-based state detection stay intact.
const ROOT = '/deepseek-harness-kr/assets/'
const SLOT = '__deepseekHarnessKrDispose'

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
    const observer = new window.MutationObserver(fn)
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
  // These lexical wrappers capture only the original character's resources.
  // Browser globals and other plugins are never patched.
  const setTimeout = life.timeout, setInterval = life.interval, requestAnimationFrame = life.frame
  const addEventListener = (...args) => life.listen(window, ...args)
  function MutationObserver(fn) { return life.observe(fn) }
  /* ORIGINAL_CHARACTER */
}

function apply(ctx) {
  window[SLOT]?.()
  const life = createLifetime()
  const oldDsc = window.__dsc
  const wasDark = document.body.hasAttribute('data-ds-dark-theme')
  const darkValue = document.body.getAttribute('data-ds-dark-theme')
  const tagged = new Map(['dsc-composer', 'dsc-send', 'dsc-newsession'].map((name) => [name, new Set(document.getElementsByClassName(name))]))
  const dispose = () => {
    if (window[SLOT] !== dispose) return
    life.dispose()
    if (window.__dsc !== oldDsc) {
      if (oldDsc === undefined) delete window.__dsc
      else window.__dsc = oldDsc
    }
    document.documentElement.classList.remove('dsc-hover')
    for (const [name, previous] of tagged) {
      for (const node of [...document.getElementsByClassName(name)]) if (!previous.has(node)) node.classList.remove(name)
    }
    // Reapply the host's currently selected theme, including a choice made while enabled.
    if (ctx.theme?.getTheme) {
      if (ctx.theme.getTheme().active.colorScheme === 'dark') document.body.setAttribute('data-ds-dark-theme', '')
      else document.body.removeAttribute('data-ds-dark-theme')
    } else if (wasDark) document.body.setAttribute('data-ds-dark-theme', darkValue)
    delete window[SLOT]
  }
  window[SLOT] = dispose
  ctx.effect(() => dispose, 'deepseek-harness-kr: client')
  try {
    // The original patch stored Korean in zh. Give those dictionaries their own ID.
    if (!ctx.locale.getLocale().locales.some((locale) => locale.id.toLowerCase() === 'ko')) {
      life.add(ctx.locale.addLanguage({ id: 'ko', label: '한국어', fallback: 'en' }))
    }
    for (const [namespace, dictionary] of Object.entries(KOREAN_DICTIONARIES)) {
      life.add(ctx.locale.register(namespace, 'ko', dictionary))
    }
    // Language selection stays in the existing DSH Settings > Language control.
    const style = document.createElement('link')
    style.rel = 'stylesheet'; style.href = ROOT + 'dsc-theme.css'
    document.head.appendChild(style)
    life.add(() => style.remove())
    mountCharacter(life)
  } catch (error) { dispose(); throw error }
}

exports.inject = ['locale', 'theme']
exports.apply = apply
