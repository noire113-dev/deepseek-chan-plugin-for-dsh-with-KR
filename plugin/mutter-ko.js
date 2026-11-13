// @ts-check
// 한국어 혼잣말: 작업 중 영어 추론 요약 한 줄을 로컬 LLM(GGUF, CPU)으로 캐릭터 말투의 짧은 한국어로 바꾼다.
// 모델은 배포하지 않고 사용자가 지정한 파일만 읽는다. 실행 엔진 node-llama-cpp는 선택 설치라, 없으면 503으로 알리고
// 화면 쪽은 지금처럼 영어로 중얼거린다. 요청은 한 번에 하나씩 처리하고, 한동안 안 쓰면 모델을 메모리에서 내린다.

import { availableParallelism } from 'node:os'

/** 화면 쪽이 부르는 번역 경로 (인증된 POST만) */
export const MUTTER_KO_PATH = '/deepseek-harness-kr/mutter-ko'

/** 받는 영어 문장 최대 길이 (추론 요약 첫 문장이면 충분) */
const MAX_INPUT = 400
/** 돌려주는 한국어 최대 길이 (말풍선 한 줄) */
const MAX_OUTPUT = 40
/** 실행 엔진 패키지 (선택 설치라 이름을 변수로 둬서 타입 검사·묶기 도구가 찾으려 하지 않게) */
const ENGINE = 'node-llama-cpp'
/** 추론 스레드 수 (코어 절반, 2~6개) */
const THREADS = Math.max(2, Math.min(6, Math.floor(availableParallelism() / 2)))
/** 안 쓰면 모델을 내리는 시간 */
const IDLE_UNLOAD_MS = Infinity   // 켜 두는 동안은 내리지 않음 (끄면 내림). 시작 화면에서 한 번 불러오고 계속 씀

// 지시문 + 예시 대화. 앞부분이 매번 같아서 엔진이 계산 결과를 재사용한다(두 번째 줄부터 1초 안팎).
// 말투 기준은 docs/character-bible.md 5장 (해요체, 1인칭 "저", 짧게, 말줄임표 "…").
export const SYSTEM_PROMPT = `당신은 코딩을 돕는 캐릭터 "DeepSeek짱"입니다. 영어로 된 작업 생각 한 줄을 받으면, 그 뜻을 살려 캐릭터가 혼자 중얼거리는 한국어 한 문장으로 바꿉니다.
규칙:
- 반드시 해요체로 끝냅니다("~요", "~네요", "~게요"). 반말("~해", "~야", "~겠다")과 "-습니다"체는 절대 쓰지 않습니다.
- 1인칭은 "저". 원문에 user가 없으면 "주인님"을 넣지 않습니다.
- 25자 안팎으로 짧게. 설명이나 따옴표 없이 문장 하나만 씁니다.
- 파일 이름, 함수 이름, 명령어는 영어 그대로 둡니다.
- 말줄임표는 "…" 한 글자만 씁니다. 이모지는 쓰지 않습니다.`
export const EXAMPLES = [
  ['Let me look at the config file to find the port.', '설정 파일에서 포트부터 찾아볼게요'],
  ['The user asked for a dark mode toggle.', '주인님이 다크 모드 버튼을 원하시네요'],
  ['Wait, this function is never called.', '어라… 이 함수는 아무 데서도 안 부르네요'],
]

/**
 * 모델 출력 → 말풍선 한 줄. 첫 줄만, 따옴표·머리말 제거, "..."는 "…", 너무 길면 자름
 * @param {string} raw 모델이 낸 글
 * @returns {string} 정리된 문장 (쓸 게 없으면 빈 문자열)
 */
export function cleanMutter(raw) {
  let text = String(raw || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || ''
  text = text.replace(/^(?:답|번역|혼잣말|DeepSeek짱)\s*[:：]\s*/, '')
    .replace(/^["'“”‘’「」]+|["'“”‘’「」]+$/g, '')
    .replace(/\.{3,}/g, '…').replace(/\s+/g, ' ').trim()
  if (!/[가-힣]/.test(text)) return ''
  if (text.length > MAX_OUTPUT) text = text.slice(0, MAX_OUTPUT - 1).trim() + '…'
  return text
}

/**
 * @typedef {object} TranslatorDeps
 * @property {() => Promise<any>} [loadEngine] node-llama-cpp 불러오기 (시험용 대체)
 * @property {number} [idleMs] 안 쓰면 모델을 내리는 시간
 * @property {(message: string) => void} [log] 진단 로그
 */
/**
 * 번역기 생성. 모델은 처음 부를 때 불러오고, 경로가 바뀌면 다시 불러온다
 * @param {TranslatorDeps} [deps]
 */
export function createMutterTranslator({ loadEngine = () => import(ENGINE), idleMs = IDLE_UNLOAD_MS, log = () => {} } = {}) {
  /** @type {{ path: string, model: any, context: any, session: any, history: any[] } | null} */
  let loaded = null
  /** @type {Promise<any> | null} */
  let loading = null
  let loadingPath = ''
  /** 마지막 실패 사유 (상태 조회용) */
  let problem = /** @type {string | null} */ (null)
  /** 요청을 하나씩 처리하는 줄 */
  let queue = Promise.resolve()
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let idleTimer

  /** 불러온 모델 내리기 */
  const unload = async () => {
    const current = loaded
    loaded = null
    if (!current) return
    try { await current.context.dispose() } catch {}
    try { await current.model.dispose() } catch {}
    log('한국어 혼잣말 모델을 내렸습니다.')
  }
  /** 안 쓰는 시간 타이머 다시 걸기 */
  const touch = () => {
    clearTimeout(idleTimer)
    if (!Number.isFinite(idleMs)) return
    idleTimer = setTimeout(() => { queue = queue.then(unload, unload) }, idleMs)
    idleTimer.unref?.()
  }

  /**
   * 모델 불러오기 (같은 경로면 재사용). 불러온 뒤 한 번 미리 돌려 첫 요청도 빠르게
   * @param {string} path GGUF 파일 경로
   */
  const ensure = async (path) => {
    if (loaded?.path === path) return loaded
    if (loading && loadingPath === path) return loading
    loadingPath = path
    loading = (async () => {
      await unload()
      let engine
      try { engine = await loadEngine() } catch (error) {
        throw Object.assign(new Error('node-llama-cpp를 불러오지 못했습니다: ' + (/** @type {Error} */ (error)?.message ?? error)), { code: 'no-engine' })
      }
      const llama = await engine.getLlama({ gpu: false, build: 'never' })
      let model
      try { model = await llama.loadModel({ modelPath: path }) } catch (error) {
        throw Object.assign(new Error('모델 파일을 불러오지 못했습니다: ' + (/** @type {Error} */ (error)?.message ?? error)), { code: 'no-model' })
      }
      // 스레드는 몇 개만: 코어를 전부 쓰면 화면·다른 프로그램과 겹칠 때 서로 기다리느라 수십 배 느려진다 (2B 모델은 6개면 충분)
      const context = await model.createContext({ contextSize: 1024, threads: THREADS })
      // Kanana·Llama 3 계열 대화 형식. 모델 안 템플릿은 엔진 검사에 걸리는 경우가 있어 직접 지정
      const session = new engine.LlamaChatSession({ contextSequence: context.getSequence(), chatWrapper: new engine.Llama3ChatWrapper() })
      const history = [{ type: 'system', text: SYSTEM_PROMPT }, ...EXAMPLES.flatMap(([q, a]) => [{ type: 'user', text: q }, { type: 'model', response: [a] }])]
      loaded = { path, model, context, session, history }
      session.setChatHistory(history)
      await session.prompt('Let me read the file first.', { maxTokens: 8 }).catch(() => {})   // 미리 돌리기: 지시문 계산을 캐시에 올림
      log('한국어 혼잣말 모델을 불러왔습니다: ' + path)
      return loaded
    })()
    try { return await loading } finally { loading = null }
  }

  return {
    /**
     * 영어 한 줄 → 한국어 혼잣말
     * @param {string} modelPath GGUF 파일 경로
     * @param {string} text 영어 문장
     * @param {AbortSignal} [signal] 요청이 끊기면 생성 중단
     * @returns {Promise<string>}
     */
    translate(modelPath, text, signal) {
      const job = queue.then(async () => {
        if (signal?.aborted) return ''
        const current = await ensure(modelPath)
        touch()
        current.session.setChatHistory(current.history)
        const raw = await current.session.prompt(text.slice(0, MAX_INPUT), { maxTokens: 40, temperature: 0.5, signal, stopOnAbortSignal: true })
        problem = null
        // 작은 모델은 원문에 user가 없어도 "주인님,"을 앞에 붙이는 버릇이 있어 떼어 냄 (말투 기준: 호칭은 가끔만)
        const line = cleanMutter(raw)
        return /\buser\b/i.test(text) ? line : line.replace(/^주인님\s*[,，]\s*/, '')
      })
      queue = job.then(() => {}, (error) => { problem = String(error?.message ?? error) })
      return job
    },
    /**
     * 미리 불러오기: 기능을 켜면 첫 혼잣말도 바로 나오게 모델을 불러 둠 (이미 불러온 경로면 그대로)
     * @param {string} modelPath GGUF 파일 경로
     * @returns {Promise<void>} 불러오기가 끝나면(실패해도) 끝남. 실패 사유는 status().problem
     */
    warm(modelPath) {
      if (loaded?.path === modelPath) return Promise.resolve()
      queue = queue.then(() => ensure(modelPath)).then(() => { problem = null; touch() }, (error) => { problem = String(error?.message ?? error) })
      return queue
    },
    /** 상태 조회: 불러온 모델 경로·마지막 실패 */
    status() { return { loaded: loaded?.path ?? null, problem } },
    /** 정리: 타이머 해제, 모델 내리기 (다시 부르면 새로 불러옴) */
    dispose() { clearTimeout(idleTimer); queue = queue.then(unload, unload); return queue },
  }
}

/**
 * 요청 본문 JSON 읽기 (크기 제한)
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<any>}
 */
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    /** @type {Buffer[]} */
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 8192) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch { reject(Object.assign(new Error('bad json'), { status: 400 })) } })
    req.on('error', reject)
  })
}

/**
 * 번역 경로 처리기 생성. 꺼져 있으면 404, 아직 준비 중(모델 경로 없음)이거나 엔진·모델을 못 불러오면 503 + 사유
 * @param {{ translate(modelPath: string, text: string, signal?: AbortSignal): Promise<string>, warm(modelPath: string): unknown }} translator 번역기 (mutter-ko.js 또는 별도 프로세스 대리자)
 * @param {() => { enabled: boolean, modelPath: string }} read 지금 설정 읽기
 * @param {(req: import('node:http').IncomingMessage) => number | undefined} rejection 거절할 상태 코드 (통과면 undefined)
 * @param {() => void} [warmUp] warm 요청 때 부를 준비 시작 함수 (없으면 준비된 모델만 불러옴)
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}
 */
export function createMutterHandler(translator, read, rejection, warmUp) {
  /** @param {import('node:http').ServerResponse} res @param {number} status @param {object} body */
  const send = (res, status, body) => {
    if (res.headersSent || res.destroyed) return
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }
  return async (req, res) => {
    const denied = rejection(req)
    if (denied !== undefined) { res.writeHead(denied); res.end(); return }
    const { enabled, modelPath } = read()
    if (!enabled) { res.writeHead(404, { 'cache-control': 'no-store' }); res.end(); return }
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); res.end(); return }
    let body
    try { body = await readJson(req) } catch (error) { send(res, /** @type {any} */ (error).status ?? 400, { error: 'bad-request' }); return }
    // 준비 시작: 시작 화면이 뜨면 화면 쪽이 보냄. 준비를 시작만 하고 바로 답함
    if (body?.warm === true) {
      if (warmUp) warmUp()
      else if (modelPath) translator.warm(modelPath)
      send(res, 202, { warming: true }); return
    }
    if (!modelPath) { warmUp?.(); send(res, 503, { error: 'preparing' }); return }   // 아직 준비 전·준비 중: 준비를 시작(이미 하는 중이면 그대로)하고 이번은 영어로
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    if (!text) { send(res, 400, { error: 'empty' }); return }
    // 화면 쪽이 기다리기를 포기하고 연결을 끊으면 생성도 멈춤
    const controller = new AbortController()
    res.on('close', () => { if (!res.writableEnded) controller.abort() })
    const started = performance.now()
    try {
      const korean = await translator.translate(modelPath, text, controller.signal)
      send(res, 200, { text: korean, ms: Math.round(performance.now() - started) })
    } catch (error) {
      const code = /** @type {any} */ (error)?.code
      send(res, 503, { error: code ?? 'failed', message: String(/** @type {Error} */ (error)?.message ?? error) })
    }
  }
}
