# DeepSeek짱 for DeepSeek Harness

[DeepSeek Harness](https://github.com/deepseek-ai) 0.2.1-rc.5를 한국어로 쓰고, 화면 안에 살아 움직이는 Live2D 버튜버 **DeepSeek짱**을 더하는 패치와 도구입니다.

![DeepSeek짱 소개 영상](docs/preview.gif)

<details>
<summary><b>소개 영상</b></summary>

https://github.com/user-attachments/assets/7e7a96cc-efc8-416d-89a0-f574fdcda690

</details>

## 구성

| 폴더 | 내용 |
|---|---|
| `harness/overlay/` | 원본 Harness(app.asar)에서 바뀌거나 추가된 파일 314개 (한국어 문구, 파스텔 테마, 인앱 캐릭터, 업데이트 끔 등) |
| `harness/tools/` | 원본에 overlay를 덮어쓰는 스크립트(Windows `apply-overlay.cjs`, macOS `apply-macos.sh`), 포터블 빌드 스크립트, 분석 도구 |
| `infographic/` | 소개 영상 최종본과 제작 파일 |

## 인앱 캐릭터가 하는 일

- 얼굴 추적처럼 자연스러운 고개·몸 움직임 (눈이 먼저, 고개가 뒤따라 · 물리 엔진 몸 흔들림)
- 작업 상태 반응: 시작 → 생각 중(추론을 혼잣말로) → 도구 사용 → 승인 대기(식은땀) → 완료(하트 눈) / 실패(눈물)
- 말풍선 글자의 모음(한글 ㅏㅔㅣㅗㅜ, 영어 a·e·i·o·u)에 맞춘 입 모양
- 클릭 부위별 반응(머리 쓰다듬기 등), 마우스 시선 따라가기
- 한국어·영어 화면 모두 지원

## 적용 방법 (설치형 Harness)

1. DeepSeek Harness 0.2.1-rc.5를 설치하고 한 번 실행 후 종료
2. 원본 백업: `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\app.asar` → `app.asar.orig`
3. 패치 만들기
   ```
   cd harness\tools
   npm install
   node apply-overlay.cjs "%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\app.asar.orig" app.asar
   ```
4. 만든 `app.asar`를 `resources\` 에 덮어쓰기
5. 자동 업데이트를 끄려면 `harness\tools\app-update.yml`을 `resources\app-update.yml`에 덮어쓰기 (업데이트되면 패치가 지워짐)

되돌리기: 백업한 `app.asar.orig`를 `app.asar`로 되돌리면 됩니다.

## 적용 방법 (macOS, Apple silicon)

overlay는 Windows판과 macOS판에 공통으로 쓰입니다. 두 원본 asar에서 overlay가 덮어쓰는 파일들은 CSS 클래스 해시와 빌드 경로 주석만 다릅니다.

1. [공식 다운로드](https://www.deepseek.com/en/download/)에서 macOS용 DeepSeek Harness 0.2.1-rc.5를 받아 `/Applications`에 설치하고, 한 번 실행한 뒤 종료
2. 패치 적용
   ```
   cd harness/tools
   npm install
   sh apply-macos.sh                       # 기본 경로: /Applications/DeepSeek Harness.app
   sh apply-macos.sh "/경로/DeepSeek Harness.app"
   ```
   원본 백업(`app.asar.orig`, `Info.plist.orig`, 처음 한 번만) → overlay 적용 → `Info.plist`의 `ElectronAsarIntegrity` 해시 갱신 → 자동 업데이트 끔 → ad-hoc 재서명 순서로 진행합니다. 다시 실행해도 항상 원본에서 새로 만듭니다.

되돌리기: `Contents/Resources/app.asar.orig` → `app.asar`, `Contents/Info.plist.orig` → `Info.plist`로 되돌린 뒤 `codesign --force --deep -s - "/Applications/DeepSeek Harness.app"`를 실행합니다.

## 포터블(설치 없이 실행)

`harness/tools/build-portable.ps1`이 패치된 설치본을 복사해 `Start-DeepSeek-Harness.cmd`로 실행되는 포터블 폴더를 만듭니다. 설정·대화 기록은 폴더 안 `data\`에 저장됩니다(`DSH_HOME`, `--user-data-dir`). 완성본은 Releases에 올립니다.

## 라이선스

- 이 저장소의 코드: MIT (`LICENSE`)
- 포함된 제3자 구성 요소와 그림: `NOTICE.md`

## 만든 사람

- [@noire113-dev](https://github.com/noire113-dev) — 기획, 테스트, 배경 그림
- [Claude](https://claude.ai) (Anthropic, Claude Code) — 한국어화·인앱 캐릭터 코드, 패치·빌드 도구, 소개 영상 제작
- Live2D 모델 원작: Kamiya_Ryoko (VGen @KAMIYA) — `NOTICE.md` 참고
