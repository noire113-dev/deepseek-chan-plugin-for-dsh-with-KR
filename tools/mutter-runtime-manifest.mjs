// 한국어 혼잣말 엔진(node-llama-cpp) 내려받기 목록 생성 → plugin/mutter-runtime.json
//   npm install --no-save --omit=optional --ignore-scripts node-llama-cpp@<버전> @node-llama-cpp/win-x64@<버전> 로 설치해 둔 상태에서 실행
//   node tools/mutter-runtime-manifest.mjs
// 설치된 트리(node_modules/.package-lock.json)에서 node-llama-cpp 의존성 전체를 경로·버전·주소·무결성 값 그대로 뽑고,
// 운영체제별 실행 파일 패키지는 npm 저장소에서 같은 버전의 주소·무결성 값을 받아 붙인다.
// 플러그인은 이 목록에 적힌 파일만 받아 무결성 값을 확인한 뒤 같은 경로에 푼다(패키지 관리자 없이 npm과 같은 배치).
import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const lock = JSON.parse(await readFile(join(root, 'node_modules/.package-lock.json'), 'utf8')).packages
const ENGINE = 'node_modules/node-llama-cpp'
const engine = lock[ENGINE]
if (!engine) throw new Error('node-llama-cpp가 설치되어 있지 않습니다')

/** npm 규칙대로 from 위치에서 가장 가까운 name 패키지 경로 찾기 */
const find = (from, name) => {
  let base = from
  for (;;) {
    const path = (base ? base + '/' : '') + 'node_modules/' + name
    if (lock[path]) return path
    if (!base) return null
    const i = base.lastIndexOf('/node_modules/')
    base = i < 0 ? '' : base.slice(0, i)
  }
}
const seen = new Set()
const walk = (path) => {
  if (seen.has(path)) return
  seen.add(path)
  for (const dep of Object.keys(lock[path].dependencies || {})) {
    const found = find(path, dep)
    if (!found) throw new Error(`${path}의 의존성 ${dep}를 찾지 못했습니다`)
    walk(found)
  }
}
walk(ENGINE)

const packages = [...seen].sort().map((path) => {
  const { version, resolved, integrity } = lock[path]
  if (!resolved || !integrity) throw new Error(`${path}에 주소·무결성 값이 없습니다`)
  return { path, version, url: resolved, integrity }
})

// 운영체제·CPU별 실행 파일 패키지 (CPU 추론만 쓰므로 CUDA·Vulkan 변형은 뺌)
const PLATFORMS = { 'win32-x64': 'win-x64', 'win32-arm64': 'win-arm64', 'darwin-arm64': 'mac-arm64-metal', 'darwin-x64': 'mac-x64', 'linux-x64': 'linux-x64', 'linux-arm64': 'linux-arm64' }
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const binaries = {}
for (const [key, name] of Object.entries(PLATFORMS)) {
  const spec = `@node-llama-cpp/${name}@${engine.version}`
  const dist = JSON.parse(execFileSync(npm, ['view', spec, 'dist', '--json'], { encoding: 'utf8', shell: process.platform === 'win32' }))
  binaries[key] = { path: `node_modules/@node-llama-cpp/${name}`, version: engine.version, url: dist.tarball, integrity: dist.integrity }
}

const manifest = { engine: engine.version, packages, binaries }
await writeFile(join(root, 'plugin/mutter-runtime.json'), JSON.stringify(manifest, null, 1) + '\n')
console.error(`plugin/mutter-runtime.json: node-llama-cpp ${engine.version}, 패키지 ${packages.length}개, 실행 파일 ${Object.keys(binaries).length}종`)
