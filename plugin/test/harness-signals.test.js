import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { readStatus, scanAddedNode, readThought, thoughtLine, thoughtSentence, vtuberize, TOOLS } from '../../character/harness-signals.ts'

// DSH 화면(DOM)을 읽는 부분만 모은 모듈을 실제 DOM으로 확인한다
const page = (html) => new JSDOM(`<!doctype html><body>${html}</body>`).window.document

test('작업 상태: 생성 중지 버튼이면 실행 중, 승인·질문 카드는 종류를 돌려준다', () => {
  assert.deepEqual(readStatus(page('')), { running: false, waiting: null })
  assert.deepEqual(readStatus(page('<button aria-label="생성 중지"></button>')), { running: true, waiting: null })
  assert.deepEqual(readStatus(page('<button aria-label="Stop generating"></button><div aria-label="Approval details"></div>')), { running: true, waiting: 'approval' })
  assert.deepEqual(readStatus(page('<div class="Zf6DNq_card"></div>')).waiting, 'approval')
  assert.deepEqual(readStatus(page('<div data-question-reply></div>')).waiting, 'question')
  assert.deepEqual(readStatus(page('<div class="x wnLwla_card"></div>')).waiting, 'question')
})

test('새 노드: 턴 실패 문구는 늘 찾고, 도구 이름은 작업 중일 때만 말풍선 문구로 바꾼다', () => {
  const doc = page('')
  const node = (html) => { const div = doc.createElement('div'); div.innerHTML = html; return div }
  assert.deepEqual(scanAddedNode(node('<span>이번 턴 실행 실패</span>'), { running: false }), { error: true, tool: null })
  assert.deepEqual(scanAddedNode(node('<span>읽기</span><span>a.txt</span>'), { running: true }), { error: false, tool: TOOLS['읽기'] })
  assert.deepEqual(scanAddedNode(node('<span>Grep</span>'), { running: false }), { error: false, tool: null })
  assert.deepEqual(scanAddedNode(doc.createTextNode('읽기'), { running: true }), { error: false, tool: null })
})

test('추론 요약: 글자가 있는 마지막 요약 줄, 접힌 묶음 제목, 펼친 본문의 끝난 문단 순서로 읽는다', () => {
  assert.equal(readThought(page('<div class="VJlF5q_summary" data-streaming>첫 줄</div><div class="VJlF5q_summary" data-streaming> </div>')), '첫 줄')
  assert.equal(readThought(page('<button data-process-activity="thinking" aria-expanded="false"><span data-shimmer><span>요청 분석 중 · 파일을 읽어 봅니다</span><span>사본</span></span></button>')), '파일을 읽어 봅니다')
  assert.equal(readThought(page('')), '')
})

test('중얼거림: 한국어 문장은 첫 문장을 줄이고, 영어는 버튜버 말투로, 코드 같은 줄은 버린다', () => {
  const never = () => 1   // "Hmm…" 붙이지 않음
  assert.equal(thoughtLine('- 사용자가 요청한 파일을 먼저 읽어 보겠습니다. 그다음 고칩니다.', never), '사용자가 요청한 파일을 먼저 읽어 보겠습니다.')
  assert.equal(thoughtLine('The user wants a quick summary of the repo.', never), 'You want a quick summary of the repo.')
  assert.equal(thoughtLine('const x = require("a/b/c"); foo(x)', never), null)
  assert.equal(thoughtLine('The user asks for help.', () => 0), 'Hmm… You ask for help.')
  assert.equal(vtuberize("This user's file"), 'Your file')
})

test('첫 문장: 한국어 문장은 korean, 영어는 다듬지 않은 첫 문장, 코드 같은 줄은 빈 문자열', () => {
  assert.deepEqual(thoughtSentence('사용자가 요청한 파일을 먼저 읽어 보겠습니다. 그다음 고칩니다.'), { first: '사용자가 요청한 파일을 먼저 읽어 보겠습니다.', korean: true })
  assert.deepEqual(thoughtSentence('1. The user wants a quick summary of the repo. Then more.'), { first: 'The user wants a quick summary of the repo.', korean: false })
  assert.deepEqual(thoughtSentence('const x = require("a/b/c"); foo(x)'), { first: '', korean: false })
})
