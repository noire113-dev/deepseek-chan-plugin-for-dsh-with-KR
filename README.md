# DeepSeek짱 for DeepSeek Harness

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 0.2.1-rc.5를 한국어로 쓰고, 화면 안에 살아 움직이는 Live2D 버튜버 **DeepSeek짱**을 더하는 DSH 플러그인입니다.

![DeepSeek짱 소개 영상](docs/preview.gif)

<details>
<summary><b>소개 영상</b></summary>

https://github.com/user-attachments/assets/7e7a96cc-efc8-416d-89a0-f574fdcda690

</details>

## 구성

| 폴더 | 내용 |
|---|---|
| `plugin/` · `package.json` | DSH 플러그인: 한국어 UI, 파스텔 테마, Live2D 캐릭터 |
| `assets/` | 플러그인이 사용하는 캐릭터 코드·Live2D 모델·테마·배경 |
| `plugins/dsh-tts/` | 말풍선 음성(TTS) 원본 코드. 0.1.5부터 kr 플러그인에 포함되어 설정 창에서 켭니다 |
| `infographic/` | 소개 영상 최종본과 제작 파일 |

## 인앱 캐릭터가 하는 일

- 얼굴 추적처럼 자연스러운 고개·몸 움직임 (눈이 먼저, 고개가 뒤따라 · 물리 엔진 몸 흔들림)
  - 말할 때 고개를 천천히 좌우로 기울이고, 눈은 보는 사람을 봅니다. 가슴·머리카락은 몸 움직임을 늦게 따라 크게 출렁입니다.
  - 시작할 때는 화면 가운데에서 크게 인사하고, 빈 배경을 클릭하면 오른쪽 아래 제자리로 갑니다.
- 작업 상태 반응: 시작 → 생각 중(추론을 혼잣말로) → 도구 사용 → 승인 대기(식은땀) → 완료(하트 눈) / 실패(눈물)
- 말풍선 글자의 모음(한글 ㅏㅔㅣㅗㅜ, 영어 a·e·i·o·u)에 맞춘 입 모양
- 클릭 부위별 반응, 마우스 시선 따라가기
  - 머리를 만지면 정색하고, 계속 만지면 턱을 들고 고개를 홱 돌려 삐집니다. 삐진 15초 동안은 터치를 받지 않고, 가끔 몰래 쳐다봤다가 다시 외면합니다. 풀릴 때는 눈을 똑바로 맞추며 한마디 합니다.
  - 머리를 누른 채 아래로 빠르게 쓸어내리면 냄비가 떨어져 머리를 치고(효과음), 천천히 쓸어내리면 세숫대야를 씌웁니다. 세숫대야를 쓴 채 냄비를 맞으면 막아 냅니다.
  - 가슴을 계속 만지면 하트 눈으로 부끄러워하며 왼손으로 가슴을 가립니다.
- 가끔 쉴 때 꼬마 모습으로 산책을 다녀옴: 왼쪽 화면 밖으로 걸어 나갔다가 잠시 뒤 오른쪽에서 걸어 들어옵니다. 작업이 시작되면 바로 돌아옵니다.
- 소품(뿔테 안경·외눈 안경)·옷(치마 길이·가슴 옷·신발·꼬리)·체형(기본·체형 1·꼬마) 바꾸기
- 캐릭터를 끌어서 옮기기, 몸이 Harness 창 밖으로 나가면 바탕화면 위 투명한 펫 창으로 떼어 내기 (Desktop 앱의 Windows·macOS) — [바깥 펫 창](#바깥-펫-창) 참고
- 한국어·영어 화면 모두 지원
- (선택) 말풍선 대사를 음성으로 읽고, 소리 크기에 맞춰 입을 움직임 — [말풍선 음성](#말풍선-음성-tts-옵트인) 참고

## 플러그인으로 설치

DSH **0.2.1-rc.5** 이상의 Desktop 앱과 브라우저 Web UI에서 사용할 수 있습니다. 텍스트 CLI/TUI와 headless 환경은 지원하지 않습니다.

### Harness에서 설치

1. Harness의 **Plugins**에서 **+ Add plugin** 버튼을 클릭합니다.
2. **Add Plugin** 창에 아래 GitHub 주소를 입력해 설치·활성화합니다.

   ```text
   git+https://github.com/noire113-dev/deepseek-harness-kr.git
   ```

3. 한국어가 자동 선택되지 않으면 **Settings → General → Language**에서 **한국어**를 선택합니다.

앱에서 설치하면 현재 앱이 사용하는 프로필에 적용됩니다. 별도의 Node/npm 설치는 필요하지 않습니다.
플러그인은 DSH 사용자 프로필에 설치되므로 앱 업데이트가 설치 파일을 교체해도 유지됩니다. 비활성화하면 캐릭터·테마·번역 등록이 해제됩니다.

### 업데이트

플러그인 설정 화면에서 바로 업데이트할 수 있습니다(0.1.3부터).

1. **Plugins**에서 이 플러그인의 상세 페이지를 열고, **Components** 아래의 **deepseek-harness-kr**를 클릭해 설정 창을 엽니다.
2. 아래쪽 **업데이트** 칸이 설치한 GitHub 주소의 최신 버전을 확인합니다. 새 버전이 있으면 **업데이트**를 누르고 안내를 확인한 뒤 **계속**을 누릅니다.
3. 플러그인이 잠시 꺼졌다가 새 버전으로 다시 켜집니다. 캐릭터·테마·한국어 설정은 그대로 남습니다. 혹시 업데이트에 실패해 플러그인이 목록에서 사라졌다면 **+ Add plugin**에서 같은 GitHub 주소로 다시 추가하세요.

업데이트 칸은 GitHub 주소로 설치한 경우에만 동작합니다. 포크에서 설치했다면 그 포크의 최신 버전을 확인합니다.

**0.1.2 이하에서 처음 한 번:** 이 버전에는 업데이트 칸이 없습니다. **Plugins**에서 이 플러그인을 제거한 뒤 같은 GitHub 주소로 다시 추가하면 최신 버전이 설치되고, 설정은 유지됩니다. 또는 Harness를 종료하고 명령 프롬프트에서 아래 명령을 실행해도 됩니다(Web UI라면 `--profile web`). 
(이 안내는 0.2까지 유지될 예정입니다.)

```bat
"%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop update deepseek-harness-kr
```

### 지원 기능

- Live2D 캐릭터의 표정·시선·터치 반응과 모음에 맞춘 입 모양
- 작업 상태·추론 문구에 반응하는 말풍선
- 파스텔 테마 (Harness의 밝은 모드·다크 모드 설정을 그대로 따름)
- UI 번역 54개 네임스페이스를 제공하는 한국어 언어팩
- 말풍선 음성(TTS): 설정 창에서 켜기와 URL·API 키 등록 (0.1.5부터 포함)
- 설정 화면에서 소품·옷·체형 바꾸기
- 설정 화면에서 새 버전 확인과 업데이트

### 바깥 펫 창

캐릭터를 끌다가 몸이 Harness 창 밖으로 15% 넘게 나가면 다른 앱 위에 항상 떠 있는 투명한 펫 창이 캐릭터를 이어받습니다. 말풍선·몸짓·표정·음성 입 모양이 그대로 이어집니다.

- 펫 창은 캐릭터 몸 위에서만 클릭을 받고 나머지는 뒤 화면으로 통과합니다. 끌어서 옮기고, 제자리 근처에 놓거나 우클릭 메뉴의 **창으로 돌아가기**를 고르면 다시 Harness 창에 붙습니다. Harness를 끄면 펫 창도 함께 종료됩니다.
- **Desktop 앱의 Windows·macOS(Apple silicon)에서만 동작합니다.** 브라우저 Web UI와 그 외 환경에서는 창 안에서 끌어 옮기는 것까지만 됩니다.
- 별도 설치는 필요 없습니다. 처음 끌 때 Harness의 Electron을 다시 써서 펫 전용 런타임을 만들고, Harness가 업데이트되면 자동으로 다시 만듭니다. 폴더를 지워도 안전합니다.
  - Windows: `%LOCALAPPDATA%\deepseek-harness-kr\pet-runtime` (설치 폴더를 하드링크로 묶어 추가 용량이 거의 없고, 불가능하면 복사해 약 370MB)
  - macOS: `~/Library/Application Support/deepseek-harness-kr/pet-runtime` — 설치된 `DeepSeek Harness.app`의 일부를 APFS clone으로 복제한 작은 앱(추가 용량 거의 없음)을 만들고, **이 복사본에만** ad-hoc 서명을 합니다. 설치된 원본 앱은 읽기만 하고 수정하지 않으며, Dock·앱 전환기·메뉴 막대에는 나타나지 않습니다.

### 플러그인 설정

**Plugins**에서 이 플러그인의 상세 페이지를 연 뒤, **Components** 아래의 **deepseek-harness-kr**를 클릭하면 설정 창이 열립니다. 여기서 다음 기능을 각각 켜고 끌 수 있습니다.

| 설정 | 기능 |
|---|---|
| 캐릭터와 말풍선 | Live2D 캐릭터, 표정·터치 반응과 말풍선 |
| 파스텔 테마 | 배경·색상·입력창 스타일. 밝은 모드와 다크 모드 모두 지원 (모드는 Harness 설정 → 모양에서 선택) |
| 한국어 언어팩 | 한국어 UI 번역 등록 |
| 소품·옷 | 뿔테 안경, 외눈 안경, 치마 길이 바꾸기, 가슴 옷 바꾸기, 신발 벗기, 꼬리 숨기기 (기본값 꺼짐) |
| 체형 | 기본 체형, 체형 1, 체형 2(꼬마) 중 선택 (기본값 기본 체형) |
| 말풍선 음성 | 말풍선 대사를 TTS로 읽기 (기본값 꺼짐) — [말풍선 음성](#말풍선-음성-tts-옵트인) 참고 |

캐릭터·테마·한국어는 기본값이 활성화이며, 변경 사항은 즉시 적용되고 현재 프로필에 저장됩니다. 한국어 표시 언어는 **Settings → General → Language**에서 선택합니다.

### 호환성

- DSH 0.2.1-rc.5에서 패키지 설치, Host 활성화 및 클라이언트 주입을 검증했습니다.
- 작업 상태와 추론 문구는 화면의 DOM 구조로 감지합니다. DSH 업데이트가 DOM 구조나 플러그인 API를 바꾸면 호환성 수정이 필요할 수 있습니다.
- Electron 네이티브 메뉴·업데이트/복구 창, 패키지 메타데이터 설명과 일부 하드코딩 문구는 언어팩의 번역 대상이 아닙니다.

### 개발자 빌드

```powershell
npm ci
npm run locales:extract  # harness/overlay의 번역을 수정한 경우
npm run build
npm test
```

빌드는 `assets/`의 캐릭터 코드와 `plugin/locales.ko.json`으로 플러그인 클라이언트를 생성합니다. 설정 스키마는 DSH의 `@deepseek-ai/schemastery`를 사용합니다.
빌드된 `lib/client.js`와 `assets/`를 저장소에 포함하므로 Git 주소로 설치할 때 빌드 스크립트를 실행하지 않습니다.
캐릭터 코드·번역·자산을 수정한 뒤에는 `npm run build`를 실행하고 생성물도 함께 커밋하세요.
사용자에게 나가는 변경이면 `package.json`의 `version`도 올려 주세요. Plugins 화면의 버전 표시로 새 버전인지 구분할 수 있습니다.

## 말풍선 음성 (TTS, 옵트인)

0.1.5부터 말풍선 음성(`plugins/dsh-tts`)이 이 플러그인에 포함됩니다. 따로 설치할 것 없이 설정 창의 **말풍선 음성** 칸에서 켜고 설정합니다. YAML을 고칠 필요는 없습니다.

- OpenAI 호환 `/audio/speech` API로 음성을 스트리밍 재생하고, 소리 크기(RMS)에 맞춰 캐릭터 입을 움직입니다. 음소 단위 정밀 립싱크는 아직 지원하지 않습니다.
- 기본값은 **꺼짐**이고, 주소·모델·보이스도 미리 정해 두지 않습니다. 꺼져 있거나 URL이 비어 있으면 외부로 아무 요청도 보내지 않습니다.
- 설정 창에서 바꾼 값은 저장 즉시 다음 대사부터 적용됩니다. TTS가 꺼져 있거나 실패해도 말풍선은 평소대로 표시됩니다.

| 묶음 | 칸 | 설명 |
|---|---|---|
| (제목 줄) | 말풍선 음성 스위치 | 켜고 끄기 |
| 연결 | API 주소 | OpenAI 호환 주소(`/v1`까지). 예: `https://api.openai.com/v1`, Fish Audio `https://api.fish.audio/compat/v1`, 로컬 서버 `http://127.0.0.1:8000/v1` |
| 연결 | API 키 | Harness 자격 증명 저장소에 저장되며 화면에는 저장 여부만 보입니다. 키가 필요 없는 로컬 서버라면 비워 둡니다 |
| 목소리 | 모델 · 목소리 ID | 비우면 요청에서 빼고 서버 기본값을 씁니다. OpenAI처럼 모델이 필수인 서버는 채워야 합니다 |
| 목소리 | 샘플레이트 (Hz) | 서버가 보내는 오디오와 같아야 합니다. OpenAI 24000, Fish 44100(또는 추가 요청 값에 `"sample_rate": 24000`) |
| 읽을 대사 | 4종 | 반응·도구 상태·혼잣말·그 밖의 대사를 각각 켜고 끄기. 혼잣말은 모델 추론 요약이 섞일 수 있어 기본 꺼짐 |
| 고급 | 추가 요청 값 (JSON) | 요청 본문에 합쳐지는 값. 예: `{ "speed": 1.1 }`, `{ "instructions": "밝게" }`. `input`·`response_format`·`stream_format`은 플러그인이 정합니다 |
| 고급 | 그 밖의 항목 | 추가 헤더(JSON), 대사 앞 문구(예: Drama 3 연기 지시), 응답 대기 시간(초), 캐시, API 키 저장 이름 |

- API 키는 키 참조 이름(기본 `DSH_TTS_API_KEY`)으로 찾습니다. 저장된 키가 먼저이고, 없으면 같은 이름의 환경변수를 씁니다. 키는 브라우저로 넘어가지 않습니다.
- 켜면 말풍선 대사가 설정한 URL로 전송되고, 사용하는 서비스에 따라 요금이 나올 수 있습니다. AI가 만든 음성이라는 점을 듣는 사람에게 알려 주세요(OpenAI 이용 정책).
- OpenAI의 `gpt-4o-mini-tts`·`tts-1`·`tts-1-hd`는 2027-01-06에 종료될 예정입니다.

라우트 설명은 [`plugins/dsh-tts/README.md`](plugins/dsh-tts/README.md)를 참고하세요. 예전처럼 `dsh-tts`를 단독 row로 따로 넣었다면, kr 플러그인과 같은 라우트를 쓰므로 그 row를 지우고 설정 창으로 옮겨 주세요.

## ASAR 패치·포터블 (지원 종료)

예전에 쓰던 ASAR 패치(Windows·macOS 설치본에 직접 덮어쓰기)와 포터블 버전은 더 이상 지원하거나 새로 만들지 않습니다. 앞으로의 기능과 수정은 플러그인으로만 나옵니다. 지금 이 방식을 쓰고 있다면 아래처럼 플러그인으로 바꿔 주세요. 대화 기록과 설정은 사용자 폴더에 있어서 `app.asar`를 되돌려도 유지됩니다.

- **Windows 설치본:** Harness를 종료하고, 백업해 둔 `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\app.asar.orig`를 `app.asar`로 되돌립니다. 백업이 없으면 [공식 다운로드](https://www.deepseek.com/en/download/)에서 Harness를 다시 설치합니다.
- **macOS 설치본:** Harness를 종료하고 `Contents/Resources/app.asar.orig` → `app.asar`, `Contents/Resources/app-update.yml.orig` → `app-update.yml`, `Contents/Info.plist.orig` → `Info.plist`로 되돌린 뒤 `codesign --force --deep -s - "/Applications/DeepSeek Harness.app"`를 실행합니다. 또는 공식 dmg로 다시 설치합니다.
- **포터블:** 공식 Harness를 설치해서 씁니다. 포터블의 대화 기록과 설정은 포터블 폴더의 `data\`에 그대로 남습니다.

그다음 Harness를 켜고 [플러그인으로 설치](#플러그인으로-설치)를 따라 설치합니다. 패치를 그대로 둔 채 플러그인을 설치하면 캐릭터가 두 개 표시되니, 꼭 원본 `app.asar`를 되돌린 뒤 설치하세요.

저장소에 남아 있는 예전 방식용 폴더는 다음과 같습니다.

| 폴더 | 내용 |
|---|---|
| `harness/overlay/` | 예전 ASAR 패치용 한국어화·데스크톱 패치 파일. 번역 추출(`npm run locales:extract`)의 원본으로 남겨 둡니다 |
| `harness/tools/` | 예전 ASAR 패치·포터블 빌드 스크립트와 분석 도구 |

## 라이선스

- 이 저장소의 코드: MIT (`LICENSE`)
- 포함된 제3자 구성 요소와 그림: `NOTICE.md`

## 만든 사람

- [@noire113-dev](https://github.com/noire113-dev) — 기획, 테스트, 배경 그림
- [Claude](https://claude.ai) (Anthropic, Claude Code) — 한국어화·인앱 캐릭터 코드, 패치·빌드 도구, 소개 영상 제작
- Live2D 모델 원작: Kamiya_Ryoko (VGen @KAMIYA) — `NOTICE.md` 참고

### 기여해 주신 분

- [@conankun](https://github.com/conankun) — 말풍선 TTS와 오디오 기반 입 모양 플러그인 `plugins/dsh-tts` ([#2](https://github.com/noire113-dev/deepseek-harness-kr/pull/2))
- [@shortstories](https://github.com/shortstories) — Harness 플러그인 메뉴에서 바로 설치하는 방식, 캐릭터·테마·한국어 개별 설정 ([#3](https://github.com/noire113-dev/deepseek-harness-kr/pull/3))
- [@TraceofLight](https://github.com/TraceofLight) — macOS(Apple silicon) 적용 스크립트 ([#4](https://github.com/noire113-dev/deepseek-harness-kr/pull/4)), 승인·질문 카드가 캐릭터에 가려지던 문제 수정 ([#6](https://github.com/noire113-dev/deepseek-harness-kr/pull/6)), Live2D 렌더링 최적화와 시작 시 끊김 완화 ([#7](https://github.com/noire113-dev/deepseek-harness-kr/pull/7))
- [@iwannagit](https://github.com/iwannagit) — 파스텔 테마 다크 모드 지원 ([#5](https://github.com/noire113-dev/deepseek-harness-kr/pull/5))

좋은 기능을 보내 주신 분들께 감사드립니다!
