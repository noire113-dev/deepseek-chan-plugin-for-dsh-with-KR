// @ts-check
// 한국어 혼잣말 준비물 자동 설치: 기능을 켜면 엔진(node-llama-cpp)과 기본 모델을 사용자 폴더에 내려받는다. 따로 설치할 것이 없게.
// - 엔진: plugin/mutter-runtime.json에 고정해 둔 npm 패키지만 받아 무결성 값(sha512)을 확인하고, npm과 같은 배치로 푼다.
//   CPU용 실행 파일 패키지는 지금 운영체제·CPU에 맞는 것 하나만 받는다. 설치 스크립트는 돌리지 않는다.
// - 모델: Kanana 1.5 2.1B Instruct Q4_K_M(GGUF, Apache-2.0)을 커밋 고정 주소에서 받아 sha256을 확인한다.
//   설정에 모델 파일을 직접 지정하면 그 파일을 쓰고 받지 않는다.
// - 위치: Windows %LOCALAPPDATA%, macOS ~/Library/Application Support, 그 밖 ~/.cache 아래 deepseek-harness-kr/mutter
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'

/** 기본 모델 (허깅페이스 커밋 고정 주소, 크기·sha256 확인) */
export const DEFAULT_MODEL = {
  file: 'kanana-1.5-2.1b-instruct-2505-q4_k_m.gguf',
  url: 'https://huggingface.co/TaeyoungLeeJack/kanana-1.5-2.1b-instruct-2505-Q4_K_M-GGUF/resolve/9a6c4bf9e13fea91c3100a891e7312dd9911f098/kanana-1.5-2.1b-instruct-2505-q4_k_m.gguf',
  size: 1522796736,
  sha256: '62a63f912a0708d9a522f974997b5bbd4927e01d739b07fe4c55c1f545241561',
}

/** 준비물 기본 폴더 */
export function defaultBase(platform = process.platform, env = process.env) {
  if (platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'deepseek-harness-kr', 'mutter')
  return join((platform === 'win32' && env.LOCALAPPDATA) || join(homedir(), '.cache'), 'deepseek-harness-kr', 'mutter')
}

/**
 * npm 패키지 압축(.tgz) 풀기. 맨 앞 폴더(package/)는 떼고, 일반 파일·폴더만 dest 아래에 쓴다 (링크·장치 파일은 무시, 폴더 밖으로 나가는 경로는 거절)
 * @param {Buffer} tgz 압축 파일 내용
 * @param {string} dest 풀 폴더
 * @returns {Promise<number>} 쓴 파일 수
 */
export async function extractTgz(tgz, dest) {
  const tar = gunzipSync(tgz)
  const text = (/** @type {number} */ start, /** @type {number} */ length) => {
    const raw = tar.subarray(start, start + length), end = raw.indexOf(0)
    return raw.subarray(0, end < 0 ? length : end).toString('utf8')
  }
  const root = normalize(dest)
  let offset = 0, files = 0
  /** @type {string | null} */
  let longName = null
  while (offset + 512 <= tar.length) {
    if (tar[offset] === 0) break   // 끝 표시(빈 블록)
    const size = parseInt(text(offset + 124, 12).trim() || '0', 8)
    const type = String.fromCharCode(tar[offset + 156] || 48)
    const body = tar.subarray(offset + 512, offset + 512 + size)
    let name = longName ?? ((text(offset + 345, 155) ? text(offset + 345, 155) + '/' : '') + text(offset, 100))
    longName = null
    offset += 512 + Math.ceil(size / 512) * 512
    if (type === 'x') {   // pax 확장 머리: 다음 항목의 긴 경로
      const match = body.toString('utf8').match(/\d+ path=([^\n]*)\n/)
      if (match) longName = match[1]
      continue
    }
    if (type === 'L') { longName = body.toString('utf8').replace(/\0+$/, ''); continue }   // GNU 긴 이름
    if (type !== '0' && type !== '5') continue
    const rel = name.replace(/\\/g, '/').split('/').slice(1).filter(Boolean).join('/')
    if (!rel) continue
    const target = normalize(join(root, rel))
    if (!target.startsWith(root + sep)) throw new Error('압축 안 경로가 폴더 밖을 가리킵니다: ' + name)
    if (type === '5') { await mkdir(target, { recursive: true }); continue }
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, body)
    files++
  }
  return files
}

/** SRI 무결성 값(sha512-…) 확인 @param {Buffer} data @param {string} integrity */
function checkIntegrity(data, integrity) {
  const [algorithm, expected] = integrity.split('-', 2)
  const actual = createHash(algorithm).update(data).digest('base64')
  if (actual !== expected) throw new Error('무결성 값이 맞지 않습니다')
}

/**
 * @typedef {{ path: string, version: string, url: string, integrity: string }} PackageEntry
 * @typedef {{ engine: string, packages: PackageEntry[], binaries: Record<string, PackageEntry> }} Manifest
 * @typedef {{ phase: 'idle' | 'engine' | 'model' | 'ready' | 'error', done: number, total: number, problem: string | null }} RuntimeState
 */

/**
 * 준비물 관리자 생성
 * @param {object} [options]
 * @param {string} [options.base] 준비물 폴더
 * @param {Manifest} [options.manifest] 엔진 목록 (기본 plugin/mutter-runtime.json)
 * @param {typeof DEFAULT_MODEL} [options.model] 기본 모델
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.platform] @param {string} [options.arch]
 * @param {() => string} [options.resolveBare] 따로 설치된 node-llama-cpp 모듈 주소 찾기 (없으면 예외, 시험용 대체)
 * @param {(message: string) => void} [options.log]
 */
export function createMutterRuntime({ base = defaultBase(), manifest, model = DEFAULT_MODEL, fetchImpl = (...args) => fetch(...args),
  platform = process.platform, arch = process.arch, resolveBare = () => import.meta.resolve(BARE), log = () => {} } = {}) {
  /** @type {RuntimeState} */
  const state = { phase: 'idle', done: 0, total: 0, problem: null }
  /** @type {Promise<string> | null} */
  let preparing = null
  let preparingKey = ''
  /** 따로 설치된 엔진 모듈 주소 (한 번만 확인, 없으면 빈 문자열) @type {string | null} */
  let bare = null

  /** @returns {Promise<Manifest>} */
  const readManifest = async () => manifest ?? JSON.parse(await readFile(new URL('./mutter-runtime.json', import.meta.url), 'utf8'))
  const engineDir = async () => join(base, 'engine-' + (await readManifest()).engine)
  const stampOf = (/** @type {string} */ dir) => join(dir, '.installed')

  /** 받은 파일 내용 (상태 오류면 실패) @param {string} url */
  const download = async (url) => {
    const response = await fetchImpl(url)
    if (!response.ok) throw new Error(`내려받기 실패 (HTTP ${response.status}): ${url}`)
    return Buffer.from(await response.arrayBuffer())
  }

  /** 따로 설치된 node-llama-cpp의 주소 (불러오지는 않음, 없으면 빈 문자열) */
  const findBare = () => { if (bare === null) { try { bare = resolveBare() } catch { bare = '' } } return bare }
  /** 내려받은 엔진의 모듈 주소 */
  const installedEntry = async () => pathToFileURL(join(await engineDir(), 'node_modules', 'node-llama-cpp', 'dist', 'index.js')).href

  /** 엔진 설치 (이미 있으면 그대로). 임시 폴더에 다 푼 뒤 이름을 바꿔 반쯤 설치된 상태가 남지 않게 */
  const ensureEngine = async () => {
    if (findBare()) return
    const dir = await engineDir()
    if (await stat(stampOf(dir)).then(() => true, () => false)) return
    const list = await readManifest()
    const binary = list.binaries[`${platform}-${arch}`]
    if (!binary) throw Object.assign(new Error(`이 운영체제(${platform}-${arch})용 엔진이 없습니다`), { code: 'unsupported' })
    const entries = [...list.packages, binary]
    const partial = dir + '.partial'
    await rm(partial, { recursive: true, force: true })
    state.phase = 'engine'; state.done = 0; state.total = entries.length
    log(`한국어 혼잣말 엔진을 내려받습니다 (패키지 ${entries.length}개)`)
    let next = 0
    const worker = async () => {
      while (next < entries.length) {
        const entry = entries[next++]
        const data = await download(entry.url)
        checkIntegrity(data, entry.integrity)
        await extractTgz(data, join(partial, ...entry.path.split('/')))
        state.done++
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker))
    await writeFile(stampOf(partial), JSON.stringify({ engine: list.engine, platform, arch, at: new Date().toISOString() }))
    await rm(dir, { recursive: true, force: true })
    await rename(partial, dir)
    log('한국어 혼잣말 엔진 설치 완료: ' + dir)
  }

  /** 기본 모델 받기 (이미 있고 확인된 파일이면 그대로). 받으면서 sha256 계산, 맞으면 .part 이름을 바꿈 */
  const ensureModel = async () => {
    const file = join(base, 'models', model.file), verified = file + '.verified'
    if (await stat(verified).then(() => true, () => false) && (await stat(file).then((s) => s.size, () => -1)) === model.size) return file
    await mkdir(dirname(file), { recursive: true })
    // 같은 파일이 이미 있으면(직접 넣었거나 확인 표시만 지워진 경우) 해시만 확인
    if ((await stat(file).then((s) => s.size, () => -1)) === model.size) {
      state.phase = 'model'; state.done = 0; state.total = model.size
      if (await hashFile(file) === model.sha256) { await writeFile(verified, model.sha256); return file }
    }
    state.phase = 'model'; state.done = 0; state.total = model.size
    log('한국어 혼잣말 모델을 내려받습니다: ' + model.url)
    const response = await fetchImpl(model.url)
    if (!response.ok || !response.body) throw new Error(`모델 내려받기 실패 (HTTP ${response.status})`)
    const part = file + '.part', hash = createHash('sha256'), out = createWriteStream(part)
    try {
      for await (const chunk of /** @type {AsyncIterable<Uint8Array>} */ (/** @type {unknown} */ (response.body))) {
        hash.update(chunk)
        state.done += chunk.length
        if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', () => resolve(undefined)))
      }
      await new Promise((resolve, reject) => out.end((/** @type {Error | undefined} */ error) => error ? reject(error) : resolve(undefined)))
    } catch (error) { out.destroy(); await rm(part, { force: true }); throw error }
    if (hash.digest('hex') !== model.sha256) { await rm(part, { force: true }); throw new Error('모델 파일 sha256이 맞지 않습니다') }
    await rename(part, file)
    await writeFile(verified, model.sha256)
    log('한국어 혼잣말 모델 준비 완료: ' + file)
    return file
  }

  /** 파일 sha256 (진행률 반영) @param {string} file */
  const hashFile = async (file) => {
    const hash = createHash('sha256')
    const { createReadStream } = await import('node:fs')
    for await (const chunk of createReadStream(file, { highWaterMark: 1 << 22 })) { hash.update(chunk); state.done += chunk.length }
    return hash.digest('hex')
  }

  return {
    /**
     * 준비: 엔진 설치 → 모델 확보. 같은 설정으로 이미 준비 중이면 그 작업을 같이 기다림
     * @param {string} customModel 설정에 지정한 모델 파일 (비우면 기본 모델을 받음)
     * @returns {Promise<string>} 쓸 모델 파일 경로
     */
    prepare(customModel) {
      if (preparing && preparingKey === customModel) return preparing
      preparingKey = customModel
      preparing = (async () => {
        try {
          state.problem = null
          await ensureEngine()
          const file = customModel || await ensureModel()
          state.phase = 'ready'
          return file
        } catch (error) {
          state.phase = 'error'
          state.problem = String(/** @type {Error} */ (error)?.message ?? error)
          throw error
        } finally { preparing = null }
      })()
      return preparing
    },
    /** 엔진 모듈 주소: 따로 설치된 것이 있으면 그것, 없으면 내려받은 것 (불러오기는 별도 프로세스가 함) */
    async engineEntry() { return findBare() || installedEntry() },
    /** 엔진 모듈 불러오기 (이 프로세스 안에서. 시험·샘플용) */
    async loadEngine() { return import(await this.engineEntry()) },
    /** 진행 상태 (설정 화면 표시용) */
    status() { return { ...state } },
    /** 준비가 끝났는지 */
    ready() { return state.phase === 'ready' },
  }
}

/** 따로 설치된 엔진 패키지 이름 (변수로 둬서 타입 검사·묶기 도구가 찾으려 하지 않게) */
const BARE = 'node-llama-cpp'
