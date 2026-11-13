// 한국어 혼잣말 샘플 서버 (로컬 확인용, 배포 대상 아님)
//   node tools/mutter-ko-demo/server.mjs [모델.gguf] [포트]
// 실제 호스트(plugin/host.js apply)를 가짜 DSH 컨텍스트에 붙이고, DSH 작업 화면을 흉내 낸 페이지를 띄운다.
// 페이지는 7초마다 영어 추론 요약 줄을 바꾸고, 캐릭터는 실제 혼잣말 코드로 그 줄을 한국어로 바꿔 중얼거린다.
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { apply } from '../../plugin/host.js'

const here = dirname(fileURLToPath(import.meta.url))
const MODEL = process.argv[2] || join(homedir(), '.dsh', 'models', 'kanana-1.5-2.1b-instruct-2505-q4_k_m.gguf')
const PORT = Number(process.argv[3] || process.env.PORT || 5179)

// 가짜 DSH 컨텍스트: 경로 등록만 모으고, 인증은 모두 통과
/** @type {{ kind: string, path: string, handler: Function }[]} */
const routes = []
const ctx = {
  effect: (fn) => { fn() },
  webServer: { register: (route) => { routes.push(route); return () => {} } },
  connection: { requestRejection: () => undefined },
}
apply(ctx, { mutterKo: true, mutterKoModel: MODEL, tts: { enabled: false }, appIcon: false },
  { applyIcon: async () => ({ skipped: 'platform' }), avatarCacheDir: mkdtempSync(join(tmpdir(), 'dsc-demo-ao-')) })

const bundle = (await build({ entryPoints: [join(here, 'entry.ts')], bundle: true, format: 'iife', platform: 'browser', target: 'es2022', charset: 'utf8', write: false, logLevel: 'warning' })).outputFiles[0].text

const PAGE = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>한국어 혼잣말 샘플</title>
<link rel="stylesheet" href="/deepseek-harness-kr/assets/character.css">
<style>
  body { margin: 0; font: 14px/1.5 system-ui, sans-serif; background: #fbf8ff; color: #2b2540; }
  main { max-width: 760px; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .muted { opacity: .65; margin: 0 0 16px; }
  .card { background: #fff; border: 1px solid #e6def5; border-radius: 12px; padding: 14px 16px; margin-bottom: 14px; }
  .label { font-size: 12px; opacity: .6; margin-bottom: 4px; }
  .VJlF5q_summary { font-family: ui-monospace, monospace; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-top: 1px solid #eee7f7; vertical-align: top; }
  th { font-weight: 600; opacity: .7; border-top: 0; }
  td.ms { white-space: nowrap; font-variant-numeric: tabular-nums; }
  button { font: inherit; padding: 4px 10px; border-radius: 8px; border: 1px solid #cfc3ea; background: #fff; }
</style></head><body><main>
  <h1>한국어 혼잣말 샘플</h1>
  <p class="muted">DSH 작업 화면을 흉내 낸 페이지입니다. 7초마다 영어 추론 요약이 바뀌고, 캐릭터가 로컬 Kanana(CPU)로 바꾼 한국어로 중얼거립니다.</p>
  <div class="card">
    <div class="label">작업 중 <button aria-label="Stop generating" id="stop">생성 중지</button></div>
    <div class="label">지금 추론 요약 (영어)</div>
    <div class="VJlF5q_summary" data-streaming id="thought">…</div>
  </div>
  <div class="card"><table><thead><tr><th>영어 추론</th><th>한국어 혼잣말</th><th>걸린 시간</th></tr></thead><tbody id="log"></tbody></table></div>
</main>
<script>
const LINES = [
  "The user wants me to add Korean mutters to the plugin.",
  "Let me check how the host registers routes first.",
  "Hmm, the test is failing because the mock returns undefined.",
  "I'll read package.json to see the dependencies.",
  "Now I should run npm test to make sure nothing broke.",
  "The user seems frustrated, so I should be careful here.",
  "Planning the implementation of the translator module.",
  "This error message suggests the path contains non-ASCII characters.",
  "I need to verify the build output matches the source.",
  "Wait, the timeout is too short for the first request.",
];
const thought = document.getElementById('thought'), log = document.getElementById('log');
let i = 0;
const next = () => { thought.textContent = LINES[i++ % LINES.length]; };
next(); setInterval(next, 7000);
// 캐릭터가 보내는 번역 요청을 가로채 표에 기록 (요청 내용·응답·걸린 시간)
const realFetch = window.fetch.bind(window);
window.fetch = async (url, init) => {
  if (String(url).includes('/mutter-ko')) {
    const english = JSON.parse(init.body).text, started = performance.now();
    const row = log.insertRow(0); row.insertCell().textContent = english; const ko = row.insertCell(); const ms = row.insertCell(); ms.className = 'ms';
    ko.textContent = '…';
    try {
      const response = await realFetch(url, init);
      const body = await response.clone().json().catch(() => ({}));
      ko.textContent = body.text || ('실패: ' + (body.message || body.error || response.status));
      ms.textContent = Math.round(performance.now() - started) + 'ms';
      return response;
    } catch (error) { ko.textContent = '시간 초과 → 영어로'; ms.textContent = Math.round(performance.now() - started) + 'ms'; throw error; }
  }
  return realFetch(url, init);
};
</script>
<script src="/demo.js"></script>
</body></html>`

createServer(async (req, res) => {
  const path = (req.url || '/').split('?')[0]
  if (path === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE); return }
  if (path === '/demo.js') { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); res.end(bundle); return }
  const route = routes.find((r) => r.kind === 'exact' ? r.path === path : path === r.path || path.startsWith(r.path + '/'))
  if (route) { await route.handler(req, res); return }
  res.writeHead(404); res.end()
}).listen(PORT, '127.0.0.1', () => console.log(`한국어 혼잣말 샘플: http://127.0.0.1:${PORT}  (모델: ${MODEL})`))
