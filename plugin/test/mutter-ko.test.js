import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { cleanMutter, createMutterHandler, createMutterTranslator, MUTTER_KO_PATH } from '../mutter-ko.js'

// 가짜 node-llama-cpp: 불러온 횟수와 받은 문장을 기록하고, 정해 둔 답을 돌려준다
function fakeEngine({ reply = (text) => '"' + text + '를 보고 있어요"', failModel = false } = {}) {
  const calls = { loads: 0, prompts: /** @type {string[]} */ ([]), disposed: 0 }
  const engine = {
    getLlama: async () => ({
      loadModel: async ({ modelPath }) => {
        if (failModel) throw new Error('no such file: ' + modelPath)
        calls.loads++
        return { createContext: async () => ({ getSequence: () => ({}), dispose: async () => { calls.disposed++ } }), dispose: async () => {} }
      },
    }),
    Llama3ChatWrapper: class {},
    LlamaChatSession: class {
      setChatHistory() {}
      async prompt(text) { calls.prompts.push(text); return reply(text) }
    },
  }
  return { engine, calls }
}

test('출력 정리: 첫 줄만, 따옴표·머리말 제거, "..."는 "…", 한글이 없으면 버림, 길면 자름', () => {
  assert.equal(cleanMutter('"파일부터 볼게요..."\n두 번째 줄'), '파일부터 볼게요…')
  assert.equal(cleanMutter('번역: 테스트를 돌려 볼게요'), '테스트를 돌려 볼게요')
  assert.equal(cleanMutter('Let me check.'), '')
  assert.equal(cleanMutter('가'.repeat(60)).length, 40)
})

test('번역기: 모델은 한 번만 불러오고(미리 돌리기 포함) 요청은 차례로 처리한다', async () => {
  const { engine, calls } = fakeEngine()
  const translator = createMutterTranslator({ loadEngine: async () => engine })
  const [a, b] = await Promise.all([translator.translate('m.gguf', 'first'), translator.translate('m.gguf', 'second')])
  assert.equal(a, 'first를 보고 있어요')
  assert.equal(b, 'second를 보고 있어요')
  assert.equal(calls.loads, 1)
  assert.deepEqual(calls.prompts.slice(1), ['first', 'second'])   // 0번은 미리 돌리기
  assert.deepEqual(translator.status(), { loaded: 'm.gguf', problem: null })
  await translator.dispose()
  assert.equal(calls.disposed, 1)
  assert.equal(translator.status().loaded, null)
})

test('미리 불러오기: 켜면 모델을 불러 두고, 같은 경로로 다시 불러도 한 번만 불러온다', async () => {
  const { engine, calls } = fakeEngine()
  const translator = createMutterTranslator({ loadEngine: async () => engine })
  translator.warm('m.gguf')
  translator.warm('m.gguf')
  assert.equal(await translator.translate('m.gguf', 'warm path'), 'warm path를 보고 있어요')
  assert.equal(calls.loads, 1)
  await translator.dispose()
})

test('번역기: 엔진이 없거나 모델을 못 불러오면 사유 코드와 함께 실패한다', async () => {
  const missing = createMutterTranslator({ loadEngine: async () => { throw new Error('Cannot find package') } })
  await assert.rejects(missing.translate('m.gguf', 'hello there'), { code: 'no-engine' })
  const { engine } = fakeEngine({ failModel: true })
  const broken = createMutterTranslator({ loadEngine: async () => engine })
  await assert.rejects(broken.translate('x.gguf', 'hello there'), { code: 'no-model' })
  assert.match(String(broken.status().problem), /모델 파일/)
})

/** 처리기를 실제 HTTP 서버에 붙여 요청 하나 보내기 */
async function request(handler, init) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = /** @type {import('node:net').AddressInfo} */ (server.address())
    const response = await fetch(`http://127.0.0.1:${port}${MUTTER_KO_PATH}`, init)
    return { status: response.status, body: await response.text() }
  } finally { server.close() }
}

test('경로: 인증 실패는 거절, 꺼져 있으면 404, 준비 중이면 503, 정상이면 한국어 문장', async () => {
  const { engine } = fakeEngine()
  const translator = createMutterTranslator({ loadEngine: async () => engine })
  const post = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'reading the file' }) }
  let config = { enabled: true, modelPath: 'm.gguf' }
  const handler = (rejection) => createMutterHandler(translator, () => config, rejection)
  assert.equal((await request(handler(() => 401), post)).status, 401)
  const ok = await request(handler(() => undefined), post)
  assert.equal(ok.status, 200)
  assert.equal(JSON.parse(ok.body).text, 'reading the file를 보고 있어요')
  assert.equal((await request(handler(() => undefined), { method: 'GET' })).status, 405)
  assert.equal((await request(handler(() => undefined), { ...post, body: '{"warm":true}' })).status, 202)
  assert.equal((await request(handler(() => undefined), { ...post, body: '{"text":""}' })).status, 400)
  config = { enabled: true, modelPath: '' }
  assert.deepEqual(JSON.parse((await request(handler(() => undefined), post)).body), { error: 'preparing' })
  // 준비 전이라도 warm 요청은 준비 시작 함수를 부르고 바로 202
  let warmed = 0
  const warming = createMutterHandler(translator, () => config, () => undefined, () => { warmed++ })
  assert.equal((await request(warming, { ...post, body: '{"warm":true}' })).status, 202)
  assert.equal(warmed, 1)
  config = { enabled: false, modelPath: 'm.gguf' }
  assert.equal((await request(handler(() => undefined), post)).status, 404)
  await translator.dispose()
})
