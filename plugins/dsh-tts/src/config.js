/**
 * Config defaults and validation for dsh-tts.
 *
 * A bad value is refused when the plugin activates, naming the exact field:
 * a broken baseUrl or model id cannot be repaired at request time. Unknown
 * keys are ignored so a profile written for a newer version still boots.
 * @module dsh-tts/config
 */

/**
 * Defaults, exactly as documented in cordis.patch.yml. No endpoint, model or
 * voice is assumed: an empty model or voice is left out of the request so the
 * server's own default applies, and an empty baseUrl keeps the feature off.
 */
export const DEFAULTS = {
  enabled: false,
  openai: { baseUrl: '', model: '', voice: '', speed: 1, apiKeyEnv: 'DSH_TTS_API_KEY', headers: {}, timeoutMs: 30000, extraBody: {}, textPrefix: '' },
  stream: { enabled: true, pcmSampleRate: 24000 },
  voiceLines: { reactions: true, status: false, mutters: false, others: true },
  cache: { enabled: true, maxEntries: 200, ttlMs: 604800000, maxCacheBytes: 33554432 },
  limits: { maxCharsPerLine: 300, maxBytes: 16777216 },
}

/** Throw one error naming the config path, the expectation and the value. */
function fail(path, expected, value) {
  throw new Error('dsh-tts: config.' + path + ' must be ' + expected + ', got ' + JSON.stringify(value ?? null))
}

/** Read an optional nested config section; null and arrays are refused. */
function section(source, key) {
  const value = source[key]
  if (value === undefined) return {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(key, 'an object', value)
  return value
}

function bool(source, key, path, fallback) {
  const value = source[key]
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') fail(path, 'a boolean', value)
  return value
}

function text(source, key, path, fallback, { url = false } = {}) {
  const value = source[key]
  const resolved = value === undefined ? fallback : value
  if (typeof resolved !== 'string' || resolved.trim().length === 0) fail(path, 'a non-empty string', resolved)
  const trimmed = resolved.trim()
  if (url) {
    let parsed
    try {
      parsed = new URL(trimmed)
    } catch {
      fail(path, 'an absolute http(s) URL', trimmed)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') fail(path, 'an http(s) URL', trimmed)
  }
  return url ? trimmed.replace(/\/+$/, '') : trimmed
}

function num(source, key, path, fallback, min, max, { integer = false, exclusiveMin = false } = {}) {
  const value = source[key]
  const resolved = value === undefined ? fallback : value
  if (typeof resolved !== 'number' || !Number.isFinite(resolved) || resolved > max
    || (exclusiveMin ? resolved <= min : resolved < min) || (integer && !Number.isInteger(resolved))) {
    fail(path, 'a number in ' + (exclusiveMin ? '(' : '[') + min + ', ' + max + ']', resolved)
  }
  return resolved
}

/** Model-specific request fields (not portable): shallow-copied JSON object. */
function jsonObject(source, key, path, fallback) {
  const value = source[key]
  if (value === undefined) return fallback
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path, 'an object', value)
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    fail(path, 'a JSON-serializable object', value)
  }
}

/** Optional string that may be empty (model-specific text prefix). */
function optionalText(source, key, path, fallback) {
  const value = source[key]
  const resolved = value === undefined ? fallback : value
  if (typeof resolved !== 'string') fail(path, 'a string', resolved)
  return resolved
}

/** Optional http(s) URL: '' means "not configured yet"; trailing slashes are dropped. */
function optionalUrl(source, key, path, fallback) {
  const trimmed = optionalText(source, key, path, fallback).trim()
  if (trimmed.length === 0) return ''
  return text({ [key]: trimmed }, key, path, '', { url: true })
}

/** Credential reference names double as environment variable names. */
const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Optional credential reference: '' opts out of auth, anything else is a POSIX identifier. */
function credentialName(source, key, path, fallback) {
  const trimmed = optionalText(source, key, path, fallback).trim()
  if (trimmed.length > 0 && !CREDENTIAL_REF.test(trimmed)) fail(path, 'empty or a name like DSH_TTS_API_KEY', trimmed)
  return trimmed
}

function stringMap(source, key, path) {
  const value = source[key]
  if (value === undefined) return {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path, 'an object of string values', value)
  const out = {}
  for (const [name, entry] of Object.entries(value)) {
    if (name.trim().length === 0) fail(path, 'an object with non-empty keys', value)
    if (typeof entry !== 'string') fail(path + '.' + name, 'a string', entry)
    out[name] = entry
  }
  return out
}

/**
 * Validate and normalize the Loader-row config.
 * @param raw - raw config from cordis.patch.yml, possibly undefined.
 * @returns the normalized config: every field present, unknown keys dropped.
 */
export function normalize(raw) {
  const source = raw ?? {}
  if (typeof source !== 'object' || Array.isArray(source)) fail('config', 'an object', source)
  const openai = section(source, 'openai')
  const stream = section(source, 'stream')
  const lines = section(source, 'voiceLines')
  const cache = section(source, 'cache')
  const limits = section(source, 'limits')
  return {
    enabled: bool(source, 'enabled', 'enabled', DEFAULTS.enabled),
    openai: {
      baseUrl: optionalUrl(openai, 'baseUrl', 'openai.baseUrl', DEFAULTS.openai.baseUrl),
      // '' leaves the field out of the request; the server's default applies.
      model: optionalText(openai, 'model', 'openai.model', DEFAULTS.openai.model).trim(),
      voice: optionalText(openai, 'voice', 'openai.voice', DEFAULTS.openai.voice).trim(),
      speed: num(openai, 'speed', 'openai.speed', DEFAULTS.openai.speed, 0.25, 4),
      // A credential reference (stored key first, then the same-named env var);
      // '' opts out of auth entirely (local/self-hosted servers without a key).
      apiKeyEnv: credentialName(openai, 'apiKeyEnv', 'openai.apiKeyEnv', DEFAULTS.openai.apiKeyEnv),
      headers: stringMap(openai, 'headers', 'openai.headers'),
      timeoutMs: num(openai, 'timeoutMs', 'openai.timeoutMs', DEFAULTS.openai.timeoutMs, 1000, 600000, { integer: true }),
      extraBody: jsonObject(openai, 'extraBody', 'openai.extraBody', DEFAULTS.openai.extraBody),
      textPrefix: optionalText(openai, 'textPrefix', 'openai.textPrefix', DEFAULTS.openai.textPrefix),
    },
    stream: {
      enabled: bool(stream, 'enabled', 'stream.enabled', DEFAULTS.stream.enabled),
      pcmSampleRate: num(stream, 'pcmSampleRate', 'stream.pcmSampleRate', DEFAULTS.stream.pcmSampleRate, 8000, 48000, { integer: true }),
    },
    voiceLines: {
      reactions: bool(lines, 'reactions', 'voiceLines.reactions', DEFAULTS.voiceLines.reactions),
      status: bool(lines, 'status', 'voiceLines.status', DEFAULTS.voiceLines.status),
      mutters: bool(lines, 'mutters', 'voiceLines.mutters', DEFAULTS.voiceLines.mutters),
      others: bool(lines, 'others', 'voiceLines.others', DEFAULTS.voiceLines.others),
    },
    cache: {
      enabled: bool(cache, 'enabled', 'cache.enabled', DEFAULTS.cache.enabled),
      maxEntries: num(cache, 'maxEntries', 'cache.maxEntries', DEFAULTS.cache.maxEntries, 0, 100000, { integer: true }),
      ttlMs: num(cache, 'ttlMs', 'cache.ttlMs', DEFAULTS.cache.ttlMs, 0, 31536000000),
      maxCacheBytes: num(cache, 'maxCacheBytes', 'cache.maxCacheBytes', DEFAULTS.cache.maxCacheBytes, 0, Number.MAX_SAFE_INTEGER, { integer: true }),
    },
    limits: {
      maxCharsPerLine: num(limits, 'maxCharsPerLine', 'limits.maxCharsPerLine', DEFAULTS.limits.maxCharsPerLine, 1, 100000, { integer: true }),
      maxBytes: num(limits, 'maxBytes', 'limits.maxBytes', DEFAULTS.limits.maxBytes, 1024, Number.MAX_SAFE_INTEGER, { integer: true }),
    },
  }
}
