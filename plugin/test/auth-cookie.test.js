import test from 'node:test'
import assert from 'node:assert/strict'
import { shortenAuthCookies } from '../auth-cookie.js'

const DAY = 24 * 60 * 60 * 1000
// DSH dsh-client-connection BrowserAuth의 쿠키 만들기·검사 규칙만 옮긴 대역 (만들 때 수명 = maxAgeMilliseconds, 검사 상한도 같은 값)
class FakeBrowserAuth {
  maxAgeMilliseconds = 30 * DAY
  issue(now) { return { issuedAt: now, expiresAt: now + this.maxAgeMilliseconds, maxAge: Math.floor(this.maxAgeMilliseconds / 1000) } }
  authenticate(cookie, now) {
    if (cookie.expiresAt <= now || cookie.expiresAt - cookie.issuedAt > this.maxAgeMilliseconds) return undefined
    return cookie
  }
  isAuthenticated(cookie, now) { return this.authenticate(cookie, now) !== undefined }
}

test('켜면 새 쿠키는 3일짜리로 만들고, 이미 쓰던 30일짜리 쿠키도 그대로 통과한다', () => {
  const auth = new FakeBrowserAuth()
  const now = Date.now()
  const old = auth.issue(now)
  const restore = shortenAuthCookies({ browserAuth: auth })
  assert.ok(restore)
  const fresh = auth.issue(now)
  assert.equal(fresh.expiresAt - fresh.issuedAt, 3 * DAY)
  assert.equal(fresh.maxAge, 3 * 86400)
  assert.equal(auth.isAuthenticated(old, now + 1000), true, '기존 30일 쿠키는 계속 유효')
  assert.equal(auth.isAuthenticated(fresh, now + 1000), true)
  assert.equal(auth.maxAgeMilliseconds, 3 * DAY, '검사 뒤에는 다시 3일')
  restore()
  assert.equal(auth.maxAgeMilliseconds, 30 * DAY)
  assert.equal(Object.prototype.hasOwnProperty.call(auth, 'authenticate'), false, '감싼 함수 제거')
  assert.equal(auth.issue(now).expiresAt - now, 30 * DAY)
})

test('DSH 구조가 다르면 아무것도 하지 않는다', () => {
  assert.equal(shortenAuthCookies(undefined), null)
  assert.equal(shortenAuthCookies({}), null)
  assert.equal(shortenAuthCookies({ browserAuth: { maxAgeMilliseconds: '30' , authenticate() {} } }), null)
})
