# DeepSeek짱 for DeepSeek Harness

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 0.2.1-rc.5를 한국어로 쓰고, 화면 안에 살아 움직이는 Live2D 버튜버 **DeepSeek짱**을 더하는 DSH 플러그인과 ASAR 패치를 제공합니다.

![DeepSeek짱 소개 영상](docs/preview.gif)

<details>
<summary><b>소개 영상</b></summary>

https://github.com/user-attachments/assets/7e7a96cc-efc8-416d-89a0-f574fdcda690

</details>

## 구성

| 폴더 | 내용 |
|---|---|
| `plugin/` · `package.json` | DSH 플러그인: 한국어 UI, 파스텔 테마, Live2D 캐릭터 |
| `assets/` | 플러그인과 ASAR 패치가 함께 사용하는 캐릭터 코드·Live2D 모델·테마·배경 |
| `harness/overlay/` | 원본 Harness(app.asar)에 적용하는 한국어화·데스크톱 패치 파일 |
| `harness/tools/` | 원본에 overlay를 덮어쓰는 스크립트, 포터블 빌드 스크립트, 분석 도구 |
| `infographic/` | 소개 영상 최종본과 제작 파일 |

## 인앱 캐릭터가 하는 일

- 얼굴 추적처럼 자연스러운 고개·몸 움직임 (눈이 먼저, 고개가 뒤따라 · 물리 엔진 몸 흔들림)
- 작업 상태 반응: 시작 → 생각 중(추론을 혼잣말로) → 도구 사용 → 승인 대기(식은땀) → 완료(하트 눈) / 실패(눈물)
- 말풍선 글자의 모음(한글 ㅏㅔㅣㅗㅜ, 영어 a·e·i·o·u)에 맞춘 입 모양
- 클릭 부위별 반응(머리 쓰다듬기 등), 마우스 시선 따라가기
- 한국어·영어 화면 모두 지원

## 플러그인으로 설치 (권장)

DSH **0.2.1-rc.5** 이상의 Desktop 앱과 브라우저 Web UI에서 사용할 수 있습니다. 텍스트 CLI/TUI와 headless 환경은 지원하지 않습니다.

### Harness에서 설치

1. Harness의 **Plugins**에서 **+ Add plugin** 버튼을 클릭합니다.
2. **Add Plugin** 창에 아래 GitHub 주소를 입력해 설치·활성화합니다.

   ```text
   git+https://github.com/noire113-dev/deepseek-harness-kr.git
   ```

3. 한국어가 자동 선택되지 않으면 **Settings → General → Language**에서 **한국어**를 선택합니다.

앱에서 설치하면 현재 앱이 사용하는 프로필에 적용됩니다. 별도의 Node/npm 설치나 전용 패치 스크립트 실행, `app.asar` 교체는 필요하지 않습니다.
플러그인은 DSH 사용자 프로필에 설치되므로 앱 업데이트가 설치 파일을 교체해도 유지됩니다. 비활성화하면 캐릭터·테마·번역 등록이 해제됩니다.

### 지원 기능

- Live2D 캐릭터의 표정·시선·터치 반응과 모음에 맞춘 입 모양
- 작업 상태·추론 문구에 반응하는 말풍선
- 파스텔 테마와 밝은 모드
- UI 번역 54개 네임스페이스를 제공하는 한국어 언어팩
- 별도 옵트인 플러그인 `dsh-tts`와의 음성·입 모양 연동

### 호환성

- DSH 0.2.1-rc.5에서 패키지 설치, Host 활성화 및 클라이언트 주입을 검증했습니다.
- 작업 상태와 추론 문구는 화면의 DOM 구조로 감지합니다. DSH 업데이트가 DOM 구조나 플러그인 API를 바꾸면 호환성 수정이 필요할 수 있습니다.
- Electron 네이티브 메뉴·업데이트/복구 창, 패키지 메타데이터 설명과 일부 하드코딩 문구는 언어팩의 번역 대상이 아닙니다.
- 기존 ASAR 패치를 사용 중이라면 원본 `app.asar`를 복원한 뒤 설치하세요. 두 설치 방식을 동시에 사용하면 캐릭터가 중복 표시될 수 있습니다.

### 개발자 빌드

```powershell
npm ci
npm run locales:extract  # overlay의 번역을 수정한 경우
npm run build
npm test
```

빌드는 `assets/`의 캐릭터 코드와 `plugin/locales.ko.json`으로 플러그인 클라이언트를 생성합니다. 런타임 의존성은 없습니다.
빌드된 `lib/client.js`와 `assets/`를 저장소에 포함하므로 Git 주소로 설치할 때 빌드 스크립트를 실행하지 않습니다.
캐릭터 코드·번역·자산을 수정한 뒤에는 `npm run build`를 실행하고 생성물도 함께 커밋하세요.

## 기존 적용 방법 (ASAR 패치, 이전 방식)

`apply-overlay.cjs`는 `harness/overlay/`의 패치 파일과 공통 `assets/`를 함께 적용합니다.

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

## 포터블(설치 없이 실행)

`harness/tools/build-portable.ps1`이 패치된 설치본을 복사해 `Start-DeepSeek-Harness.cmd`로 실행되는 포터블 폴더를 만듭니다. 설정·대화 기록은 폴더 안 `data\`에 저장됩니다(`DSH_HOME`, `--user-data-dir`). 완성본은 Releases에 올립니다.

## 라이선스

- 이 저장소의 코드: MIT (`LICENSE`)
- 포함된 제3자 구성 요소와 그림: `NOTICE.md`

## 만든 사람

- [@noire113-dev](https://github.com/noire113-dev) — 기획, 테스트, 배경 그림
- [Claude](https://claude.ai) (Anthropic, Claude Code) — 한국어화·인앱 캐릭터 코드, 패치·빌드 도구, 소개 영상 제작
- Live2D 모델 원작: Kamiya_Ryoko (VGen @KAMIYA) — `NOTICE.md` 참고
