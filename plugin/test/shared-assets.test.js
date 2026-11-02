import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import asar from '@electron/asar'

const root = fileURLToPath(new URL('../../', import.meta.url))
const shared = join(root, 'assets')
const destination = 'dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/dsc/'

async function files(dir, prefix = '') {
  const result = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) result.push(...await files(join(dir, entry.name), prefix + entry.name + '/'))
    else result.push(prefix + entry.name)
  }
  return result
}

test('legacy ASAR patch maps every shared asset to its existing URL and preserves other files', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'dsh-shared-assets-'))
  try {
    const source = join(temp, 'source')
    await mkdir(join(source, ...destination.split('/')), { recursive: true })
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.2.1-rc.5' }))
    await writeFile(join(source, 'untouched.txt'), 'keep original bytes')
    await writeFile(join(source, 'native.node'), 'unpacked fixture')
    await writeFile(join(source, ...destination.split('/'), 'dsc.js'), 'old character')
    const original = join(temp, 'original.asar'), patched = join(temp, 'patched.asar')
    await asar.createPackageWithOptions(source, original, { unpack: '*.node' })
    const result = spawnSync(process.execPath, [join(root, 'harness/tools/apply-overlay.cjs'), original, patched], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    for (const file of await files(shared)) {
      assert.deepEqual(asar.extractFile(patched, join(...(destination + file).split('/'))), await readFile(join(shared, file)), file)
    }
    assert.equal(asar.extractFile(patched, 'untouched.txt').toString(), 'keep original bytes')
    assert.equal(asar.statFile(patched, 'native.node').unpacked, true)
    const index = join('dsh', 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html')
    assert.match(asar.extractFile(patched, index).toString(), /assets\/dsc\/dsc\.js/)
    assert.match(asar.extractFile(patched, index).toString(), /assets\/dsc\/dsc-theme\.css/)
  } finally {
    assert(resolve(temp).startsWith(resolve(tmpdir()) + sep))
    await rm(temp, { recursive: true, force: true })
  }
})
