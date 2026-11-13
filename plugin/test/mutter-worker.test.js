import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createMutterWorker, workerExecutable } from '../mutter-worker.js'

// 가짜 node-llama-cpp: 받은 문장 앞에 표시를 붙여 돌려준다. 'missing'이 든 모델 경로는 불러오기 실패
const FAKE_ENGINE = `
export const getLlama = async () => ({
  loadModel: async ({ modelPath }) => {
    if (modelPath.includes('missing')) throw new Error('no such file')
    return { createContext: async () => ({ getSequence: () => ({}), dispose: async () => {} }), dispose: async () => {} }
  },
})
export class Llama3ChatWrapper {}
export class LlamaChatSession {
  setChatHistory() {}
  async prompt(text) { return '프로세스 ' + process.pid + ': ' + text + '를 보고 있어요' }
}
`

test('별도 프로세스: 모델을 불러 두고 번역하며, 이 프로세스와 다른 pid에서 돈다. 끄면 프로세스가 끝난다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsc-worker-'))
  const engine = join(dir, 'engine.mjs')
  await writeFile(engine, FAKE_ENGINE)
  const worker = createMutterWorker({ engineEntry: async () => pathToFileURL(engine).href, execPath: process.execPath })
  try {
    await worker.warm('m.gguf')
    assert.deepEqual(worker.status(), { loaded: 'm.gguf', problem: null })
    const line = await worker.translate('m.gguf', 'the file')
    const pid = Number(line.match(/프로세스 (\d+)/)?.[1])
    assert.ok(pid > 0 && pid !== process.pid, '번역은 별도 프로세스에서')
    assert.match(line, /the file를 보고 있어요$/)
    // 모델을 못 불러오면 사유가 상태에 남고, 번역은 사유 코드와 함께 실패
    await worker.warm('missing.gguf')
    assert.match(String(worker.status().problem), /모델 파일/)
    await assert.rejects(worker.translate('missing.gguf', 'x y z'), { code: 'no-model' })
    await worker.dispose()
    assert.equal(worker.status().loaded, null)
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.throws(() => process.kill(pid, 0), '끈 뒤에는 프로세스가 없어야 함')
  } finally { await worker.dispose(); await rm(dir, { recursive: true, force: true }) }
})

test('실행 파일: DSH 데스크톱이 넘겨 준 실행 파일 우선, 없으면 지금 실행 파일', () => {
  assert.equal(workerExecutable({ DSH_DESKTOP_NODE_EXECUTABLE: 'C:\\DSH.exe' }, 'node.exe'), 'C:\\DSH.exe')
  assert.equal(workerExecutable({}, 'node.exe'), 'node.exe')
})
