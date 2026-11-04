import z from '@deepseek-ai/schemastery'
import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { normalize as normalizeTts } from '../plugins/dsh-tts/src/config.js'
import { registerSpeechRoutes } from '../plugins/dsh-tts/src/index.js'
import { createPetHandler, createPetManager, PET_PATH } from './pet-host.js'

export const name = 'deepseek-harness-kr'
export const inject = ['webServer', 'connection']

// 말풍선 음성(TTS). 설정 화면이 쓰는 값은 모두 volatile이어야 한다(Settings는 volatile 필드만 쓴다).
// 값의 범위·형식 검사는 요청마다 dsh-tts normalize가 맡고, 잘못된 값은 /dsh-tts/state가 이유를 알려 준다.
const live = (schema) => schema.volatile()
export const TtsConfig = z.object({
  enabled: live(z.boolean().default(false)),
  openai: z.object({
    baseUrl: live(z.string().default('')),
    model: live(z.string().default('')),
    voice: live(z.string().default('')),
    // API 키 자체가 아니라 credentials 참조 이름. 저장된 키가 먼저, 없으면 같은 이름의 환경변수.
    apiKeyEnv: live(z.string().role('credential-ref').default('DSH_TTS_API_KEY')),
    extraBody: live(z.dict(z.any()).default({})),
    headers: live(z.dict(z.string()).default({})),
    textPrefix: live(z.string().default('')),
    timeoutMs: live(z.number().default(30000)),
  }),
  stream: z.object({
    pcmSampleRate: live(z.number().default(24000)),
  }),
  voiceLines: z.object({
    reactions: live(z.boolean().default(true)),
    status: live(z.boolean().default(false)),
    mutters: live(z.boolean().default(false)),
    others: live(z.boolean().default(true)),
  }),
  cache: z.object({
    enabled: live(z.boolean().default(true)),
  }),
})

// volatile 참조(.get())가 섞인 설정을 그 시점의 평범한 값으로 바꾼다.
export function readLive(value) {
  if (value && typeof value.get === 'function') return structuredClone(value.get())
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, readLive(child)]))
}

export const Config = z.object({
  character: z.boolean().default(true).volatile(),
  theme: z.boolean().default(true).volatile(),
  translation: z.boolean().default(true).volatile(),
  // 소품·옷·체형 (데스크톱 펫의 "소품·옷" 메뉴와 같은 항목)
  glasses: z.boolean().default(false).volatile(),
  monocle: z.boolean().default(false).volatile(),
  skirt: z.boolean().default(false).volatile(),
  chestClothes: z.boolean().default(false).volatile(),
  shoesOff: z.boolean().default(false).volatile(),
  tailHide: z.boolean().default(false).volatile(),
  bodyType: z.union([z.const('default'), z.const('type1'), z.const('type2')]).default('default').volatile(),
  tts: TtsConfig,
})
export const ASSET_PATH = '/deepseek-harness-kr/assets'
const assets = fileURLToPath(new URL('../assets/', import.meta.url))
const types = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.moc3': 'application/octet-stream' }

export function createAssetHandler(root = assets) {
  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return
    }
    try {
      // Decode before resolving; both lexical traversal and symlink escapes fail closed.
      const path = decodeURIComponent((req.url || '').split('?')[0])
      if (!path.startsWith(ASSET_PATH + '/')) { res.writeHead(404); res.end(); return }
      const suffix = path.slice(ASSET_PATH.length + 1)
      if (!suffix || suffix.includes('\\') || suffix.includes('\0')) { res.writeHead(404); res.end(); return }
      const base = await realpath(root)
      const target = await realpath(resolve(base, suffix))
      const rel = relative(base, target)
      if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) { res.writeHead(404); res.end(); return }
      const type = types[extname(target)]
      const info = await stat(target)
      if (!type || !info.isFile()) { res.writeHead(404); res.end(); return }
      res.writeHead(200, { 'content-type': type, 'content-length': info.size, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' })
      if (req.method === 'HEAD') res.end()
      else await pipeline(createReadStream(target), res)
    } catch (error) {
      if (!res.headersSent) { res.writeHead(error instanceof URIError ? 400 : 404); res.end() }
      else if (!res.destroyed) res.destroy(error)
    }
  }
}

export function apply(ctx, config) {
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: ASSET_PATH, handler: createAssetHandler() }), 'deepseek-harness-kr: assets')
  // 말풍선 음성: 설정 화면에서 바꾼 값(volatile)을 요청마다 다시 읽는다. 꺼져 있으면 404.
  registerSpeechRoutes(ctx, () => normalizeTts(readLive(config?.tts)))
  ctx.effect(() => {
    const pet = createPetManager({ assets })
    const rejection = (req) => { const c = ctx.connection; return typeof c?.requestRejection === 'function' ? c.requestRejection(req) : 503 }
    const unregister = ctx.webServer.register({ kind: 'prefix', path: PET_PATH, handler: createPetHandler(pet, rejection) })
    return () => { unregister?.(); pet.dispose() }
  }, 'deepseek-harness-kr: pet')
}
