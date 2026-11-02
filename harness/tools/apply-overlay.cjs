// DeepSeek Harness 0.2.1-rc.5 의 app.asar 에 overlay/ 와 공통 assets/ 를 적용한다.
// 사용: node apply-overlay.cjs <원본 app.asar> <출력 app.asar>
//   (먼저 이 폴더에서 `npm install` 로 @electron/asar 를 설치)
// 방식: 바뀐/추가된 파일 내용을 데이터 끝에 붙이고 헤더 항목만 고침. 나머지 파일과 unpacked 표시는 그대로.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const asar = require('@electron/asar');
const { Pickle } = require('@electron/asar/lib/pickle');

const [SRC, OUT] = process.argv.slice(2);
if (!SRC || !OUT) { console.error('사용: node apply-overlay.cjs <원본 app.asar> <출력 app.asar>'); process.exit(1); }
const OVERLAY = path.join(__dirname, '..', 'overlay');
const ASSETS = path.join(__dirname, '..', '..', 'assets');
const ASSET_DEST = 'dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/dsc/';

const pkg = JSON.parse(asar.extractFile(SRC, 'package.json').toString());
if (pkg.version !== '0.2.1-rc.5') console.warn(`주의: 이 패치는 0.2.1-rc.5 용입니다 (지금 ${pkg.version}). 계속 진행합니다.`);

const walk = (d, pre = '') => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(d, e.name), pre + e.name + '/') : [pre + e.name]);
const files = [
  ...walk(OVERLAY).map((rel) => ({ rel, source: path.join(OVERLAY, ...rel.split('/')) })),
  ...walk(ASSETS).map((rel) => ({ rel: ASSET_DEST + rel, source: path.join(ASSETS, ...rel.split('/')) })),
];

const raw = asar.getRawHeader(SRC);
const header = raw.header;
const fd = fs.openSync(SRC, 'r');
const total = fs.fstatSync(fd).size;
const dataStart = 8 + raw.headerSize;
let tail = total - dataStart;
const BLOCK = 4 * 1024 * 1024;
const blobs = [];
let added = 0, replaced = 0;
for (const { rel, source } of files) {
  const data = fs.readFileSync(source);
  const parts = rel.split('/');
  let node = header;
  for (const p of parts.slice(0, -1)) { node.files[p] = node.files[p] || { files: {} }; node = node.files[p]; }
  const name = parts[parts.length - 1];
  if (node.files[name]) replaced++; else added++;
  const blocks = [];
  for (let i = 0; i < data.length; i += BLOCK) blocks.push(crypto.createHash('sha256').update(data.subarray(i, i + BLOCK)).digest('hex'));
  node.files[name] = { size: data.length, offset: String(tail), integrity: { algorithm: 'SHA256', hash: crypto.createHash('sha256').update(data).digest('hex'), blockSize: BLOCK, blocks } };
  tail += data.length; blobs.push(data);
}
const hp = Pickle.createEmpty(); hp.writeString(JSON.stringify(header));
const hb = hp.toBuffer();
const sp = Pickle.createEmpty(); sp.writeUInt32(hb.length);
const out = fs.openSync(OUT, 'w');
fs.writeSync(out, sp.toBuffer()); fs.writeSync(out, hb);
const buf = Buffer.alloc(8 * 1024 * 1024);
for (let pos = dataStart; pos < total;) { const n = fs.readSync(fd, buf, 0, Math.min(buf.length, total - pos), pos); fs.writeSync(out, buf, 0, n); pos += n; }
for (const b of blobs) fs.writeSync(out, b);
fs.closeSync(out); fs.closeSync(fd);
console.log(`완료: 바꾼 파일 ${replaced}개, 추가한 파일 ${added}개 → ${OUT}`);
