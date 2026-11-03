import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const packageName = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).name
const original = join(root, 'assets')
let character = (await readFile(join(original, 'dsc.js'), 'utf8')).replaceAll('\r\n', '\n')
const replace = (from, to) => {
  if (!character.includes(from)) throw new Error('Original character changed; adapter requires review: ' + from.slice(0, 100))
  character = character.replace(from, to)
}
replace('const BASE = new URL("./", document.currentScript.src).href;', 'const BASE = ROOT;')
// Theme enforcement and layout tags have independent lifecycles in the adapter.
const themeStart = character.indexOf('    // ---------- 밝은 모드 고정 + 테마용 표시 ----------')
const stateStart = character.indexOf('    // ---------- 상태 감시 ----------')
if (themeStart < 0 || stateStart < themeStart) throw new Error('Character theme/layout boundary changed')
character = character.slice(0, themeStart) + character.slice(stateStart)
replace('      if (!tagQueued) { tagQueued = true; requestAnimationFrame(tag); }\n', '')
// Keep original behavior; add only ownership/cancellation boundaries for plugin unload.
character = character.replaceAll('document.addEventListener(', 'life.listen(document, ')
character = character.replaceAll('document.createElement(', 'life.own(document.createElement(')
// The source creates elements with a single literal tag name.
character = character.replace(/life\.own\(document\.createElement\(("[a-z]+")\)/g, 'life.own(document.createElement($1), (node) => node.remove())')
replace('app.stage.addChild(model);', 'if (life.stopped) { model.destroy(); return; }\n      app.stage.addChild(model);')
replace('const model = await', 'life.add(() => app.destroy(true, { children: true }));\n      const model = await')
replace('if (!window.PIXI.live2d) await load("vendor/cubism4.patched.js");', 'if (!window.PIXI.live2d) await load("vendor/cubism4.patched.js");\n      if (life.stopped) return;')
// The Core worker is not tied to the PIXI app, so terminate it explicitly when the plugin unloads.
replace('try { w = new Worker(BASE + "dsc-core-worker.js"); } catch { return; }', 'try { w = new Worker(BASE + "dsc-core-worker.js"); } catch { return; }\n        life.add(() => { try { w.terminate() } catch {} })')
replace('window.__dsc = {', 'if (life.stopped) return;\n      window.__dsc = {')
// Stop async initialization even if a fetch finishes after disable.
replace('const weight = {}, hold = {}, until = {};', 'if (life.stopped) return;\n      const weight = {}, hold = {}, until = {};')
const dictionaries = JSON.parse(await readFile(join(here, 'locales.ko.json'), 'utf8'))
const adapter = await readFile(join(here, 'client.js'), 'utf8')
const result = `window.__ModuleLoader__.load({ id: ${JSON.stringify(packageName)}, factory: (require) => {\nconst module = { exports: {} }; const exports = module.exports;\nconst PLUGIN_ID = ${JSON.stringify(packageName)};\nconst KOREAN_DICTIONARIES = ${JSON.stringify(dictionaries)};\n${adapter.replace('/* ORIGINAL_CHARACTER */', character)}\nreturn module.exports;\n} });\n`
await writeFile(join(root, 'cordis.patch.yml'), `- insert:\n    - id: deepseek-harness-kr\n      name: ${JSON.stringify(packageName)}\n`)
await mkdir(join(root, 'lib'), { recursive: true })
await writeFile(join(root, 'lib/client.js'), result)
console.error(`Built independent DSH bundle: ${Object.keys(dictionaries).length} Korean namespaces; original character/assets preserved.`)
