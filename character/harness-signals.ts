// DSH 화면(DOM)에서 작업 상태를 읽는 곳을 한데 모은다. 캐릭터 반응(말풍선·표정)은 character/index.js가 정한다.
// DSH가 해시 클래스·화면 문구를 바꾸면 이 파일만 고친다. 공식 세션 신호로 바꿀 때도 교체 지점은 여기 하나다.

// 도구 줄 제목(한국어·영어 화면) → 말풍선
export const TOOLS: Record<string, string> = {
  "명령 실행": "명령 실행 중…", "코드": "코드 돌리는 중…", "읽기": "파일 읽는 중…", "이미지 읽기": "그림 보는 중…",
  "편집": "코드 고치는 중…", "쓰기": "파일 쓰는 중…", "검색": "찾아보는 중…", "파일 내용 검색": "찾아보는 중…",
  "파일 찾기": "파일 찾는 중…", "웹 검색": "검색하는 중…", "웹페이지 가져오기": "웹페이지 보는 중…",
  "하위 에이전트 만들기": "도우미 부르는 중…", "팀원 만들기": "도우미 부르는 중…", "워크플로 실행": "워크플로 돌리는 중…",
  // 영어 화면
  "Bash": "명령 실행 중…", "Pwsh": "명령 실행 중…", "Code": "코드 돌리는 중…", "Read": "파일 읽는 중…", "Read image": "그림 보는 중…",
  "Edit": "코드 고치는 중…", "Write": "파일 쓰는 중…", "Search": "찾아보는 중…", "Grep": "찾아보는 중…", "Glob": "파일 찾는 중…",
  "Fetch": "웹페이지 보는 중…", "Create subagent": "도우미 부르는 중…", "Create teammate": "도우미 부르는 중…", "Run workflow": "워크플로 돌리는 중…",
};

// Harness 화면 문구 (한국어 화면 / 영어 화면)
export const UI = {
  stop: 'button[aria-label="생성 중지"], button[aria-label="Stop generating"]',
  approval: '[aria-label="승인 상세"], [aria-label="Approval details"]',
  turnError: ["이번 턴 실행 실패", "This turn failed"],
};

/**
 * 지금 화면의 작업 상태
 * @returns running: 생성 중지 버튼이 있음, waiting: 승인·질문 카드 종류 (없으면 null)
 */
export function readStatus(doc: ParentNode): { running: boolean; waiting: "approval" | "question" | null } {
  const running = !!doc.querySelector(UI.stop);
  const waiting = doc.querySelector(UI.approval + ', [class*="Zf6DNq_card"]') ? "approval"
    // 질문 카드 클래스명은 셸 빌드마다 해시가 바뀌어 곧 죽은 셀렉터가 된다. 셸이 안정적으로 내보내는
    // data 속성을 먼저 보고, 구버전 셸을 위해 기존 해시도 함께 남긴다.
    : doc.querySelector('[data-question-reply], [data-question-key], [class*="Nksazq_card"], [class*="wnLwla_card"]') ? "question" : null;
  return { running, waiting };
}

/**
 * 새로 붙은 노드에서 턴 실패 문구와(작업 중일 때만) 도구 이름 찾기
 * @returns error: 턴 실패 문구 여부, tool: 도구 말풍선 문구 (없으면 null)
 */
export function scanAddedNode(node: Node, { running }: { running: boolean }) {
  const found: { error: boolean; tool: string | null } = { error: false, tool: null };
  if (node.nodeType !== 1) return found;
  const element = node as Element;
  const t = element.textContent || "";
  if (t.length < 400 && UI.turnError.some((phrase) => t.includes(phrase))) found.error = true;
  if (running && t.length < 200) {
    const leaves = element.children.length === 0 ? [element] : element.querySelectorAll("span, div");
    for (const el of leaves) {
      if (el.children.length) continue;
      const label = (el.textContent || "").trim();
      if (TOOLS[label]) { found.tool = TOOLS[label]; break; }
    }
  }
  return found;
}

/** 작업 중 화면의 추론 요약 줄 (방금 끝난 문단의 첫 줄, 없으면 빈 문자열) */
export function readThought(doc: ParentNode): string {
  // 요약 줄은 진짜 줄 + 늘 비어 있는 숨은 사본이 함께 있어서, 글자가 있는 마지막 줄을 고름
  const live = [...doc.querySelectorAll('[class*="VJlF5q_summary"][data-streaming]')].map((e) => (e.textContent || "").trim()).filter(Boolean).pop();
  if (live) return live;
  // 추론이 진행 묶음 안에 접혀 있으면 요약 줄이 안 그려짐 → 묶음 제목("요청 분석 중 · <지금 문단 첫 줄>")의 뒷부분을 읽음
  //   진행 중인 묶음만 data-shimmer 가 붙고, 그 안의 두 번째 span 은 반짝이 효과용 사본이라 첫 span 만 읽음
  const groupTitle = [...doc.querySelectorAll('button[data-process-activity="thinking"][aria-expanded="false"] [data-shimmer] > span:first-child')].pop();
  if (groupTitle) {
    const t = groupTitle.textContent || "", i = t.indexOf(" · ");
    if (i >= 0 && t.slice(i + 3).trim()) return t.slice(i + 3).trim();
  }
  const body = [...doc.querySelectorAll<HTMLElement>('[class*="VJlF5q_thinkBody"]')].pop();   // 펼쳐 둔 경우: 마지막으로 끝난 문단
  if (!body) return "";
  const paragraphs = (body.innerText || "").split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  return paragraphs.length > 1 ? paragraphs[paragraphs.length - 2].split("\n")[0] : "";
}

// 버튜버 말투: 추론 속 "the user"를 시청자에게 말하듯 "you"로 (동사도 맞춤)
const VERB: Record<string, string> = { is: "are", was: "were", has: "have", wants: "want", needs: "need", asks: "ask", asked: "asked",
  said: "said", says: "say", likes: "like", prefers: "prefer", seems: "seem", mentioned: "mentioned", requested: "requested" };
/** 추론 문장 속 "the user"·"this user"를 "you"로 바꾸고 뒤 동사도 맞춤 */
export const vtuberize = (text: string) => text
  .replace(/\b(the|this) user's\b/gi, (match: string) => (match[0] === "T" ? "Your" : "your"))
  .replace(/\b(the|this) user (\w+)/gi, (_match: string, article: string, word: string) => {
    const you = article[0] === article[0].toUpperCase() ? "You" : "you";
    return you + " " + (VERB[word.toLowerCase()] || word);
  })
  .replace(/\b(the|this) user\b/gi, (match: string) => (match[0] === match[0].toUpperCase() ? "You" : "you"));

/**
 * 추론 요약 한 줄의 첫 문장 고르기 (목록 기호·머리말 제거)
 * @returns first: 첫 문장 (중얼거릴 만한 한국어·영어 문장이 아니면 빈 문자열), korean: 한국어가 대부분인 문장 여부
 */
export function thoughtSentence(summary: string): { first: string; korean: boolean } {
  const t = summary.replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim()
    .replace(/^(?:[-•]|\d+[.)])\s+/, "")            // 목록 기호 (- • 1. 1))
    .replace(/^\([^)]{1,30}\):?\s*/, "");          // (Self-Correction): 같은 머리말
  const hangul = (t.match(/[가-힣]/g) || []).length;
  const latin = (t.match(/[A-Za-z]/g) || []).length;
  const first = (t.match(/^.{4,}?[.!?。…](\s|$)/) || [t])[0].trim();   // 첫 문장
  if (hangul >= 4 && latin <= hangul * 0.35) return { first, korean: true };   // 한국어가 대부분인 문장
  // 영어 문장: 낱말 3개 이상, 한글은 거의 없고, 코드·경로처럼 기호가 많은 줄은 뺌
  const words = first.split(" ").filter((word) => /[A-Za-z]{2,}/.test(word)).length;
  const symbols = (first.match(/[{}()\[\];=<>\/\\|$@]/g) || []).length;
  if (latin < 12 || words < 3 || hangul > latin * 0.1 || symbols > first.length * 0.04 || first.includes("://")) return { first: "", korean: false };
  return { first, korean: false };
}

/**
 * 추론 요약 한 줄을 중얼거릴 말로 변환. 한국어·영어 문장만
 * @param random 0~1 난수 함수 (가끔 "Hmm… " 머리말)
 * @returns 중얼거릴 말 (코드·경로처럼 기호가 많은 줄은 null)
 */
export function thoughtLine(summary: string, random = Math.random): string | null {
  const { first, korean } = thoughtSentence(summary);
  if (korean) return first.length > 42 ? first.slice(0, 40).trim() + "…" : first;
  if (!first) return null;
  let line = vtuberize(first);
  const hmm = random() < 0.3 ? "Hmm… " : "";                    // 가끔 생각하는 소리
  const max = 64 - hmm.length;
  if (line.length > max) {
    const cut = line.slice(0, max - 2), lastSpace = cut.lastIndexOf(" ");    // 낱말 중간에서 자르지 않음
    line = (lastSpace > 30 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:]+$/, "") + "…";
  }
  if ((line.match(/"/g) || []).length % 2) line = line.slice(0, line.lastIndexOf('"')).replace(/[\s,;:]+$/, "") + "…";   // 따옴표 짝 맞추기
  return hmm + line;
}
