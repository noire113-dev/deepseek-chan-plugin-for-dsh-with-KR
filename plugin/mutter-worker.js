// @ts-check
// 한국어 혼잣말 엔진을 DSH 호스트 밖 별도 프로세스에서 돌린다.
// - 호스트 쪽(createMutterWorker): 처음 필요할 때 이 파일을 Node 모드로 띄우고(DSH 데스크톱이면 DSH 실행 파일, ELECTRON_RUN_AS_NODE)
//   CPU 우선순위를 낮춘다. 엔진 불러오기(수백 ms 동안 멈춤)·모델 로딩·추론이 모두 이 프로세스에서 일어나 DSH 화면·호스트가 느려지지 않는다.
//   끄거나 플러그인이 내려가면 프로세스를 끝내고, 호스트가 사라지면(IPC 끊김) 프로세스도 스스로 끝난다.
// - 프로세스 쪽(DSC_MUTTER_WORKER=1로 실행됐을 때): mutter-ko.js 번역기를 IPC 메시지(load·translate·abort)로 움직인다.
import { fork } from 'node:child_process'
import { constants, setPriority } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createMutterTranslator } from './mutter-ko.js'

const WORKER_FILE = fileURLToPath(import.meta.url)

/**
 * 별도 프로세스에 쓸 Node 실행 파일: DSH 데스크톱이 넘겨 주는 실행 파일, 없으면 지금 실행 파일(Electron이면 Node 모드로 띄움)
 * @returns {string}
 */
export function workerExecutable(env = process.env, execPath = process.execPath) {
  return env.DSH_DESKTOP_NODE_EXECUTABLE || execPath
}

/**
 * 호스트 쪽 번역기 대리자 (mutter-ko.js 번역기와 같은 모양: translate·warm·status·dispose)
 * @param {object} options
 * @param {() => Promise<string>} options.engineEntry 엔진 모듈 주소 (file:// 또는 패키지 이름)
 * @param {typeof fork} [options.forkImpl]
 * @param {string} [options.execPath]
 * @param {(message: string) => void} [options.log]
 */
export function createMutterWorker({ engineEntry, forkImpl = fork, execPath = workerExecutable(), log = () => {} }) {
  /** @type {import('node:child_process').ChildProcess | null} */
  let child = null
  let nextId = 1
  /** @type {Map<number, { resolve: (value: any) => void, reject: (error: Error) => void }>} */
  const pending = new Map()
  let loadedPath = /** @type {string | null} */ (null)
  let loadingPath = ''
  let problem = /** @type {string | null} */ (null)

  /** 프로세스 띄우기 (이미 있으면 그대로) */
  const spawn = () => {
    if (child) return child
    // windowsHide: 콘솔 창이 뜨지 않게 (fork가 spawn에 그대로 넘기지만 형식 정의에는 없음)
    const proc = forkImpl(WORKER_FILE, [], /** @type {import('node:child_process').ForkOptions} */ ({
      execPath,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSC_MUTTER_WORKER: '1' },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      windowsHide: true,
    }))
    child = proc
    try { if (proc.pid) setPriority(proc.pid, constants.priority.PRIORITY_BELOW_NORMAL) } catch {}
    proc.stderr?.on('data', () => {})   // 엔진 로그는 버림 (파이프가 차서 멈추지 않게 읽기만)
    proc.on('message', (/** @type {any} */ message) => {
      const waiter = pending.get(message?.id)
      if (!waiter) return
      pending.delete(message.id)
      if (message.error) waiter.reject(Object.assign(new Error(message.error), { code: message.code }))
      else waiter.resolve(message)
    })
    const gone = () => {
      if (child !== proc) return
      child = null; loadedPath = null; loadingPath = ''
      for (const waiter of pending.values()) waiter.reject(Object.assign(new Error('혼잣말 엔진 프로세스가 끝났습니다'), { code: 'worker-exit' }))
      pending.clear()
    }
    proc.once('exit', gone)
    proc.once('error', (error) => { problem = String(error?.message ?? error); gone() })
    log('한국어 혼잣말 엔진 프로세스를 띄웠습니다 (pid ' + proc.pid + ')')
    return proc
  }
  /** 메시지 보내고 답 기다리기 @param {object} message @returns {Promise<any>} */
  const call = (message) => new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    spawn().send({ ...message, id })
  })

  return {
    /**
     * 모델 불러 두기 (이미 불러왔거나 불러오는 중이면 그대로)
     * @param {string} modelPath
     */
    async warm(modelPath) {
      if (loadedPath === modelPath || loadingPath === modelPath) return
      loadingPath = modelPath
      try {
        const reply = await call({ type: 'load', modelPath, entry: await engineEntry() })
        if (loadingPath !== modelPath) return
        problem = reply.problem ?? null
        loadedPath = reply.problem ? null : modelPath
      } catch (error) { problem = String(/** @type {Error} */ (error)?.message ?? error) }
      finally { if (loadingPath === modelPath) loadingPath = '' }
    },
    /**
     * 영어 한 줄 → 한국어 혼잣말 (요청이 끊기면 프로세스 쪽 생성도 멈춤)
     * @param {string} modelPath @param {string} text @param {AbortSignal} [signal]
     * @returns {Promise<string>}
     */
    async translate(modelPath, text, signal) {
      const entry = await engineEntry()
      const id = nextId   // 바로 아래 call이 이 번호를 씀 (사이에 await 없음)
      const onAbort = () => child?.send({ type: 'abort', target: id })
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        const reply = await call({ type: 'translate', modelPath, text, entry })
        loadedPath = modelPath; problem = null
        return reply.text ?? ''
      } catch (error) {
        problem = String(/** @type {Error} */ (error)?.message ?? error)
        throw error
      } finally { signal?.removeEventListener('abort', onAbort) }
    },
    /** 상태 조회: 불러온 모델 경로·마지막 실패 */
    status() { return { loaded: loadedPath, problem } },
    /** 정리: 프로세스를 끝내 메모리를 돌려줌 (다시 부르면 새로 띄움) */
    async dispose() {
      const proc = child
      child = null; loadedPath = null; loadingPath = ''
      for (const waiter of pending.values()) waiter.reject(Object.assign(new Error('혼잣말 엔진을 껐습니다'), { code: 'disposed' }))
      pending.clear()
      if (proc && proc.exitCode === null) { proc.kill(); log('한국어 혼잣말 엔진 프로세스를 끝냈습니다') }
    },
  }
}

// ---------- 프로세스 쪽 ----------
if (process.env.DSC_MUTTER_WORKER === '1' && typeof process.send === 'function') {
  let entry = ''
  const translator = createMutterTranslator({ loadEngine: () => import(entry) })
  /** @type {Map<number, AbortController>} */
  const running = new Map()
  /** @param {object} message */
  const reply = (message) => { try { process.send?.(message) } catch {} }
  process.on('message', async (/** @type {any} */ message) => {
    if (!message || typeof message !== 'object') return
    if (message.entry) entry = message.entry
    if (message.type === 'abort') { running.get(message.target)?.abort(); return }
    if (message.type === 'load') {
      await translator.warm(message.modelPath)
      reply({ id: message.id, problem: translator.status().problem })
      return
    }
    if (message.type === 'translate') {
      const controller = new AbortController()
      running.set(message.id, controller)
      try { reply({ id: message.id, text: await translator.translate(message.modelPath, message.text, controller.signal) }) }
      catch (error) { reply({ id: message.id, error: String(/** @type {any} */ (error)?.message ?? error), code: /** @type {any} */ (error)?.code }) }
      finally { running.delete(message.id) }
    }
  })
  // 호스트가 사라지면(IPC 끊김) 함께 끝남
  process.on('disconnect', () => process.exit(0))
}
