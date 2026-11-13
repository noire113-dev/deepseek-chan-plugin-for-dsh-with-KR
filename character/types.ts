// 캐릭터 모듈이 함께 쓰는 모양 (타입 검사 전용, 빌드 결과에는 없음)

/** 화면 사각형 (CSS px, 뷰포트 기준) */
export interface Rect {
  /** 왼쪽 끝 x */
  left: number;
  /** 위 끝 y */
  top: number;
  /** 오른쪽 끝 x */
  right: number;
  /** 아래 끝 y */
  bottom: number;
}
/** 배치에 쓰는 뷰포트 (모바일은 시각 뷰포트, 데스크톱은 창) */
export interface Viewport {
  /** 폭 (CSS px) */
  w: number;
  /** 높이 (CSS px) */
  h: number;
  /** 위 끝 y (CSS px, 시각 뷰포트가 밀려 있으면 0이 아님) */
  top: number;
  /** 왼쪽 끝 x (CSS px, 시각 뷰포트가 밀려 있으면 0이 아님) */
  left: number;
}
/** 캔버스 자리: 왼쪽 위 (x, y)와 배율 k */
export interface Pose {
  /** 배율 (캔버스 원래 크기에 곱하는 값) */
  k: number;
  /** 캔버스 왼쪽 끝 x (CSS px) */
  x: number;
  /** 캔버스 위 끝 y (CSS px) */
  y: number;
}
/** 스프링 상태 */
export interface Spring {
  /** 위치 */
  x: number;
  /** 속도 (초당) */
  v: number;
}

/** 플러그인 설정에서 온 값 (plugin/client.ts characterPrefs가 만든다) */
export interface CharacterPrefs {
  /** 소품·옷 (소품·옷은 boolean, bodyType은 문자열) */
  outfit?: Record<string, any>
  /** 절전: 켜짐 여부와 쉬기 시작할 때까지 분 (0.5~60, 기본 1) */
  sleep?: { enabled?: boolean; minutes?: number }
  /** 시작 인사 연출 켜짐 여부 (false일 때만 끔) */
  intro?: { enabled?: boolean }
  /** 모바일(터치 화면)에서 보이기 여부 (false일 때만 숨김) */
  mobile?: { enabled?: boolean }
  /** 끌어서 옮기는 보조 키 (기본 Alt, 빈 문자열은 이동 키 없음) */
  drag?: { key?: string }
  /** 플러그인·자동화 패널 때문에 창 안 캐릭터를 숨길지 여부 */
  pageHidden?: boolean
  /** 실험: 3D 모델 폴더를 쓸지 여부 (처음 뜰 때만 읽음), 눈썹 세기(배율)·부드럽게 따라가는 시간(초, 매 프레임 읽음), 구운 AO 켜기(처음 뜰 때만)·세기(0~1, 매 프레임) */
  avatar?: { enabled?: boolean; outline?: "smooth" | "model"; browScale?: number; browSmooth?: number; ao?: boolean; aoStrength?: number }
  /** '대사 ex' 설정: 켜면 assets/dsc-lines-ex.json의 대사를 덮어쓴다 */
  extra?: { enabled?: boolean }
  /** 한국어 혼잣말: 켜면 영어 추론 요약을 호스트의 로컬 LLM으로 한국어로 바꿔 중얼거림 (실패하면 영어 그대로) */
  mutterKo?: { enabled?: boolean }
}

/** 펫 창 preload가 넣어 주는 window.dscPet (메인 프로세스와의 통로) */
export interface PetBridge {
  /** 메인 프로세스 메시지 받기 (듣기 전에 온 메시지도 모아 두었다가 전달) */
  on(fn: (message: any) => void): void
  /** 메인 프로세스로 메시지 보내기 */
  send(message: unknown): void
  /** 펫 창 이동 (화면 좌표). walk = 산책 중 여부 (true면 메인 프로세스가 실제 창 bounds를 bounds 메시지로 회신) */
  move(x: number, y: number, walk?: boolean): void
  /** 누르는 중 표시. true면 커서가 몸 밖이어도 클릭을 계속 받음 */
  press(on: boolean): void
  /** 펫 창 우클릭 메뉴 열기 */
  menu(): void
  /** 페이지 시작 설정 (3D 모델 여부·외곽선, 메인 프로세스가 호스트 설정을 전달. 예전 펫 앱엔 없음) */
  config?(): Promise<{ avatar?: CharacterPrefs["avatar"] } | null>
}

/** 한 프레임 동안 단계 사이에 넘기는 고개·몸·표정 누적값 (character/index.ts 절차 애니메이션) */
export type Motion = Record<"yaw" | "pitch" | "roll" | "swayYaw" | "swayPitch" | "bodyX" | "bodyY" | "bodyZ" | "lean" | "smile" | "eyeSmileAdd" | "eyeClose" | "mouthAdd", number>

/** createCharacter가 돌려주는 API (플러그인 화면이 쓰는 유일한 통로) */
export interface CharacterApi {
  /** 설정 바꾸기 (바로 반영, 패널 숨김이 바뀌면 숨김/복구도 즉시 반영) */
  setPrefs(next: CharacterPrefs): void
  /** 펫 창으로 내보내기 / 돌아오기 (모델 준비 전이나 펫 창 안이면 null) */
  readonly togglePet: (() => void) | null
  /** 캔버스 숨김 토글, 바뀐 숨김 여부 반환 (모델 준비 전이나 펫 창 안이면 null) */
  readonly toggleCanvas: (() => boolean) | null
  /** 캔버스를 숨긴 상태인지 여부 */
  canvasHidden(): boolean
}
