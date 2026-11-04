/**
 * Host entry of dsh-tts: register the speech routes on the web server.
 *
 * Standalone, the plugin reads its Loader row once and registers nothing when
 * disabled. Embedded (deepseek-harness-kr), the routes stay registered and
 * read live settings per request; a disabled feature answers 404 exactly like
 * an absent route, so the browser half attaches nothing either way.
 * @module dsh-tts
 */
import { normalize } from './config.js'
import { createSpeakHandler, createStateHandler, SPEAK_ROUTE, STATE_ROUTE } from './host.js'

/** Stable Cordis plugin name; the Loader row id in cordis.patch.yml is 'tts'. */
export const name = 'dsh-tts'

/** The routes are unreadable without the web server. */
export const inject = ['webServer']

/**
 * Resolve a key reference through the optional credential store (a stored key
 * first, then the same-named environment variable), else the process env.
 * @param ctx - Cordis context that may carry `credentials`.
 * @returns resolveApiKey(name) for createSpeakHandler.
 */
export function credentialResolver(ctx) {
  return async (name) => {
    const credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : undefined
    if (credentials !== undefined && credentials !== null) return (await credentials.resolve(name))?.value
    return process.env[name]
  }
}

/** Hide a handler while the live config is disabled; disabled reads as absent. */
function whileEnabled(read, handler) {
  return (req, res) => {
    let enabled = false
    try {
      enabled = read().enabled === true
    } catch {
      // An invalid config still has to answer: the state route reports why.
      enabled = true
    }
    if (!enabled) {
      res.writeHead(404, { 'cache-control': 'no-store' })
      res.end()
      return
    }
    return handler(req, res)
  }
}

/**
 * Register both speech routes over a live config reader.
 * @param ctx - Cordis context carrying the web server service.
 * @param read - returns the current normalized config; may throw for an invalid one.
 * @param deps - createSpeakHandler dependencies (fetch, cache, resolveApiKey, now).
 */
export function registerSpeechRoutes(ctx, read, deps = {}) {
  ctx.effect(() => {
    const disposeState = ctx.webServer.register({
      kind: 'exact',
      path: STATE_ROUTE,
      handler: whileEnabled(read, createStateHandler(read)),
    })
    const disposeSpeak = ctx.webServer.register({
      kind: 'exact',
      path: SPEAK_ROUTE,
      handler: whileEnabled(read, createSpeakHandler(read, { resolveApiKey: credentialResolver(ctx), ...deps })),
    })
    return () => {
      disposeSpeak()
      disposeState()
    }
  }, 'dsh-tts: speech routes')
}

/**
 * Activate the standalone host half.
 * @param ctx - Cordis context carrying the web server service.
 * @param rawConfig - Loader-row config from cordis.patch.yml.
 */
export function apply(ctx, rawConfig) {
  const config = normalize(rawConfig)
  if (!config.enabled) return
  registerSpeechRoutes(ctx, () => config)
}
