// 한국어 혼잣말 샘플 화면의 캐릭터 진입점: 실제 플러그인과 같은 createCharacter를 한국어 혼잣말 켬 상태로 띄운다
import { createCharacter } from '../../character/index.ts'
import { createLifetime } from '../../character/lifetime.ts'

createCharacter({
  base: '/deepseek-harness-kr/assets/',
  life: createLifetime(),
  prefs: { intro: { enabled: false }, sleep: { enabled: false }, mutterKo: { enabled: true } },
})
