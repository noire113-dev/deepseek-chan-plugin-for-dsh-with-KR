// @ts-check
// 인증 쿠키 수명 줄이기: DSH는 켤 때마다 포트가 바뀌어 인증 쿠키(dsh-auth-<주소:포트 해시>)를 새 이름으로 하나씩 만들고 30일 동안 남긴다.
// 쿠키는 포트를 가리지 않고 127.0.0.1로 가는 요청에 모두 실려, 70개쯤 쌓이면 요청 헤더 한도(16KB)를 넘어
// DSH가 "desktop welcome: Web authentication failed"로 시작하지 못한다.
// 이 기능은 DSH 연결 서비스의 인증 객체(connection.browserAuth)를 감싸 새로 만드는 쿠키의 수명만 줄인다(기본 3일).
// 쿠키 검사(authenticate)는 원래 상한(30일)으로 하므로 이미 쓰고 있는 쿠키는 그대로 유효하다.
// DSH 구조가 달라 감쌀 수 없으면 아무것도 하지 않는다.

const DAY_MS = 24 * 60 * 60 * 1000
/** 새 인증 쿠키 수명(일): 하루에 여러 번 켜도 30개를 넘기 어렵고, 브라우저로 DSH 웹 화면을 쓰는 경우 3일마다 다시 인증 */
export const AUTH_COOKIE_DAYS = 3

/**
 * 인증 객체를 감싸 새 쿠키 수명을 줄임
 * @param {any} connection DSH 연결 서비스 (ctx.connection)
 * @param {number} [days] 새 쿠키 수명(일, 기본 AUTH_COOKIE_DAYS)
 * @returns {(() => void) | null} 되돌리는 함수, 감쌀 수 없으면 null
 */
export function shortenAuthCookies(connection, days = AUTH_COOKIE_DAYS) {
  const auth = connection?.browserAuth
  if (!auth || typeof auth.maxAgeMilliseconds !== 'number' || typeof auth.authenticate !== 'function') return null
  const original = auth.maxAgeMilliseconds
  const short = Math.min(original, days * DAY_MS)
  if (short === original) return () => {}
  const hadOwn = Object.prototype.hasOwnProperty.call(auth, 'authenticate')
  const authenticate = auth.authenticate
  // 검사할 때만 원래 상한으로 (동기 함수라 잠깐 바꿨다가 바로 되돌림)
  auth.authenticate = function (/** @type {unknown[]} */ ...args) {
    const issuing = this.maxAgeMilliseconds
    this.maxAgeMilliseconds = original
    try { return authenticate.apply(this, args) } finally { this.maxAgeMilliseconds = issuing }
  }
  auth.maxAgeMilliseconds = short
  return () => {
    auth.maxAgeMilliseconds = original
    if (hadOwn) auth.authenticate = authenticate
    else delete auth.authenticate
  }
}
