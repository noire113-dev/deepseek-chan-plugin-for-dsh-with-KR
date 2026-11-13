import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { createMutterRuntime, defaultBase, extractTgz } from '../mutter-runtime.js'

/** 시험용 .tgz 만들기 (ustar 머리 + 내용, npm처럼 package/ 아래) @param {Record<string, string>} files */
function tgz(files) {
  const blocks = []
  for (const [name, content] of Object.entries(files)) {
    const body = Buffer.from(content)
    const header = Buffer.alloc(512)
    header.write('package/' + name, 0, 100)
    header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116)
    header.write(body.length.toString(8).padStart(11, '0') + '\0', 124)
    header.write('00000000000\0', 136); header.write('        ', 148); header.write('0', 156); header.write('ustar\0' + '00', 257)
    let sum = 0
    for (const byte of header) sum += byte
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512))
  }
  blocks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(blocks))
}
const sri = (data) => 'sha512-' + createHash('sha512').update(data).digest('base64')

/** URL별 응답을 정해 둔 가짜 fetch (받은 주소 기록) */
function fakeFetch(routes) {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    const data = routes[url]
    if (!data) return new Response('missing', { status: 404 })
    return new Response(data)
  }
  return { fetchImpl, calls }
}

test('압축 풀기: package/ 를 떼고 하위 폴더까지 쓰며, 폴더 밖 경로는 거절한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsc-tgz-'))
  try {
    assert.equal(await extractTgz(tgz({ 'package.json': '{"name":"a"}', 'dist/index.js': 'export default 1' }), join(dir, 'a')), 2)
    assert.equal(await readFile(join(dir, 'a', 'dist', 'index.js'), 'utf8'), 'export default 1')
    await assert.rejects(extractTgz(tgz({ '../../evil.txt': 'x' }), join(dir, 'b')), /폴더 밖/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('기본 폴더: Windows는 LOCALAPPDATA, macOS는 Application Support 아래', () => {
  assert.equal(defaultBase('win32', { LOCALAPPDATA: 'C:\\L' }), join('C:\\L', 'deepseek-harness-kr', 'mutter'))
  assert.match(defaultBase('darwin', {}), /Application Support[\\/]deepseek-harness-kr[\\/]mutter$/)
})

test('준비: 목록의 패키지와 이 운영체제용 실행 파일만 받아 확인 후 풀고, 기본 모델을 sha256 확인 후 저장한다. 두 번째는 받지 않는다', async () => {
  const base = await mkdtemp(join(tmpdir(), 'dsc-mutter-'))
  try {
    const engine = tgz({ 'package.json': '{"name":"node-llama-cpp"}', 'dist/index.js': 'export const marker = "engine"' })
    const dep = tgz({ 'package.json': '{"name":"dep"}' })
    const bin = tgz({ 'package.json': '{"name":"@node-llama-cpp/test-x64"}' })
    const modelData = Buffer.from('gguf-model-bytes')
    const manifest = {
      engine: '9.9.9',
      packages: [
        { path: 'node_modules/node-llama-cpp', version: '9.9.9', url: 'https://r/engine.tgz', integrity: sri(engine) },
        { path: 'node_modules/node-llama-cpp/node_modules/dep', version: '1.0.0', url: 'https://r/dep.tgz', integrity: sri(dep) },
      ],
      binaries: { 'testos-x64': { path: 'node_modules/@node-llama-cpp/test-x64', version: '9.9.9', url: 'https://r/bin.tgz', integrity: sri(bin) },
        'otheros-x64': { path: 'node_modules/@node-llama-cpp/other', version: '9.9.9', url: 'https://r/other.tgz', integrity: 'sha512-x' } },
    }
    const model = { file: 'm.gguf', url: 'https://hf/m.gguf', size: modelData.length, sha256: createHash('sha256').update(modelData).digest('hex') }
    const { fetchImpl, calls } = fakeFetch({ 'https://r/engine.tgz': engine, 'https://r/dep.tgz': dep, 'https://r/bin.tgz': bin, 'https://hf/m.gguf': modelData })
    const options = { base, manifest, model, fetchImpl, platform: 'testos', arch: 'x64', resolveBare: () => { throw new Error('none') } }
    const runtime = createMutterRuntime(options)
    const file = await runtime.prepare('')
    assert.equal(file, join(base, 'models', 'm.gguf'))
    assert.deepEqual((await readFile(file)), modelData)
    assert.deepEqual(calls.sort(), ['https://hf/m.gguf', 'https://r/bin.tgz', 'https://r/dep.tgz', 'https://r/engine.tgz'])
    assert.equal(runtime.status().phase, 'ready')
    await stat(join(base, 'engine-9.9.9', 'node_modules', 'node-llama-cpp', 'node_modules', 'dep', 'package.json'))
    assert.equal((await runtime.loadEngine()).marker, 'engine')
    // 다시 준비해도(새로 띄운 경우 포함) 받지 않는다
    calls.length = 0
    await createMutterRuntime(options).prepare('')
    assert.deepEqual(calls, [])
    // 모델 파일을 직접 지정하면 모델은 받지 않는다
    assert.equal(await createMutterRuntime(options).prepare('D:\\my.gguf'), 'D:\\my.gguf')
    assert.deepEqual(calls, [])
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('준비 실패: 무결성 값이 다르면 설치하지 않고 오류 상태, 모델 해시가 다르면 받은 파일을 지운다', async () => {
  const base = await mkdtemp(join(tmpdir(), 'dsc-mutter-'))
  try {
    const engine = tgz({ 'package.json': '{}' })
    const manifest = { engine: '1.0.0', packages: [{ path: 'node_modules/node-llama-cpp', version: '1.0.0', url: 'https://r/e.tgz', integrity: sri(Buffer.from('other')) }], binaries: { 'testos-x64': { path: 'node_modules/b', version: '1', url: 'https://r/e.tgz', integrity: sri(engine) } } }
    const { fetchImpl } = fakeFetch({ 'https://r/e.tgz': engine, 'https://hf/m.gguf': Buffer.from('broken') })
    const runtime = createMutterRuntime({ base, manifest, fetchImpl, platform: 'testos', arch: 'x64', resolveBare: () => { throw new Error('none') } })
    await assert.rejects(runtime.prepare(''), /무결성/)
    assert.equal(runtime.status().phase, 'error')
    await assert.rejects(stat(join(base, 'engine-1.0.0')))
    // 엔진은 따로 설치된 것으로 치고 모델만 확인
    const model = { file: 'm.gguf', url: 'https://hf/m.gguf', size: 6, sha256: '0'.repeat(64) }
    const onlyModel = createMutterRuntime({ base, model, fetchImpl, resolveBare: () => 'file:///bare-engine.js' })
    await assert.rejects(onlyModel.prepare(''), /sha256/)
    await assert.rejects(stat(join(base, 'models', 'm.gguf.part')))
    await assert.rejects(stat(join(base, 'models', 'm.gguf')))
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('모델 파일이 이미 있으면 해시만 확인하고 받지 않는다', async () => {
  const base = await mkdtemp(join(tmpdir(), 'dsc-mutter-'))
  try {
    const data = Buffer.from('already-here')
    await mkdir(join(base, 'models'), { recursive: true })
    await writeFile(join(base, 'models', 'm.gguf'), data)
    const model = { file: 'm.gguf', url: 'https://hf/m.gguf', size: data.length, sha256: createHash('sha256').update(data).digest('hex') }
    const { fetchImpl, calls } = fakeFetch({})
    const file = await createMutterRuntime({ base, model, fetchImpl, resolveBare: () => 'file:///bare-engine.js' }).prepare('')
    assert.equal(file, join(base, 'models', 'm.gguf'))
    assert.deepEqual(calls, [])
  } finally { await rm(base, { recursive: true, force: true }) }
})
